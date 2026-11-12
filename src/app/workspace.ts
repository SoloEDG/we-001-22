import { computed, ref } from "vue";
import type { Point, Terrain } from "../shared/types";
import { clone, findUnit, key } from "../shared/document";
import { reachable, terrainRules, paintTile } from "../features/terrain";
import { moveBudget, armorValue, tickStatuses } from "../features/roster";
import {
  getSkill,
  legalTargets,
  moveUnit,
  castSkill,
} from "../features/tactics";
import { finishTurn } from "../features/initiative";
import { useHistoryStore } from "../features/replay";

export function useWorkspace() {
  const history = useHistoryStore();
  const { manifest } = history;

  const selected = ref(""),
    skill = ref(""),
    brush = ref<Terrain | null>(null);
  const notice = ref("档案启动中…");
  const cursor = history.cursor;
  const live = history.live;

  const battle = computed(() => history.displayed.value);
  const actor = computed(() => findUnit(battle.value, battle.value.active));
  const locked = history.locked;

  const routes = computed(() =>
    locked.value || actor.value.moved || actor.value.acted
      ? new Map()
      : reachable(live.value, actor.value, moveBudget(actor.value)),
  );
  const targets = computed(() => {
    const s = getSkill(actor.value.job, skill.value);
    return s ? legalTargets(battle.value, actor.value, s) : [];
  });
  const path = computed(() => history.currentPath.value);

  function fail(message: string) {
    notice.value = message;
  }

  async function cell(p: Point) {
    try {
      if (locked.value) throw new Error("回放只读，请返回实战");
      const before = clone(live.value);
      const u = actor.value;
      if (brush.value) {
        paintTile(live.value, p, brush.value);
        history.record(
          before,
          "terrain",
          `地形调整为${terrainRules[brush.value].name}`,
        );
      } else if (skill.value) {
        const s = getSkill(u.job, skill.value)!;
        const t = live.value.units.find(
          (t) => t.hp > 0 && key(t) === key(p),
        );
        if (!t) throw new Error("请点击合法角色");
        const ground = live.value.tiles.find((v) => key(v) === key(t))!;
        const high =
          live.value.tiles.find((v) => key(v) === key(u))!.terrain === "ridge";
        const value = castSkill(
          live.value,
          u.id,
          t.id,
          s,
          armorValue(t),
          terrainRules[ground.terrain].cover,
          high,
        );
        history.record(
          before,
          "skill",
          `${u.name} → ${t.name} · ${s.name} ${value}`,
        );
        skill.value = "";
      } else {
        const route = routes.value.get(key(p));
        if (!route?.path.length)
          throw new Error("此格不可达，请检查地形与占位");
        moveUnit(live.value, u.id, route.path);
        history.record(
          before,
          "move",
          `${u.name}移动 · 消耗${route.cost}`,
          route.path,
        );
      }
      // 先在内存完成动作与增量，再安全落盘；失败保留旧档且不回滚内存，下次重试
      await history.persist();
      notice.value = manifest.events.at(-1)?.label ?? "行动已记录";
    } catch (e) {
      fail((e as Error).message);
    }
  }

  async function wait() {
    if (locked.value) return;
    try {
      const before = clone(live.value);
      finishTurn(live.value, tickStatuses);
      history.record(
        before,
        "wait",
        `${findUnit(before, before.active).name}结束行动`,
      );
      selected.value = live.value.active;
      skill.value = "";
      await history.persist();
      notice.value = manifest.events.at(-1)?.label ?? "行动已记录";
    } catch (e) {
      fail((e as Error).message);
    }
  }

  async function seek(n: number) {
    history.stop();
    skill.value = "";
    brush.value = null;
    const ok = await history.locate(n);
    if (!ok && history.notice.value.text) {
      // 损坏或被更新的定位取消：保持原画面，透出历史库提示
      notice.value = history.notice.value.text;
    }
  }

  async function reset() {
    history.stop();
    try {
      await history.reset();
      selected.value = live.value.active;
      skill.value = "";
      brush.value = null;
      notice.value = "新战斗已就绪";
    } catch (e) {
      fail((e as Error).message);
    }
  }

  async function bootstrap() {
    await history.bootstrap((text) => {
      notice.value = text;
    });
    selected.value = live.value.active;
    if (!history.notice.value.text) {
      notice.value = "选择蓝色格移动，或选择技能指定目标。";
    } else {
      notice.value = history.notice.value.text;
    }
  }

  return {
    // 兼容模板既有结构
    session: manifest,
    history,
    cursor,
    selected,
    skill,
    brush,
    notice,
    battle,
    actor,
    locked,
    routes,
    targets,
    path,
    playback: {
      playing: history.playing,
      waiting: history.playbackWaiting,
      play: () => history.play(),
      stop: history.stop,
    },
    locating: history.locating,
    locateTarget: history.locateTarget,
    saveState: history.saveState,
    cell,
    wait,
    seek,
    reset,
    bootstrap,
  };
}
