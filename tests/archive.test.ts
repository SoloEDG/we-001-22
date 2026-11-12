import assert from "node:assert/strict";
import type {
  ArchiveManifest,
  Battle,
  Session,
} from "../src/shared/types";
import { clone, key } from "../src/shared/document";
import { newSession } from "../src/app/session";
import { moveUnit, castSkill } from "../src/features/tactics/model/actions";
import { finishTurn } from "../src/features/initiative/model/turns";
import { getSkill } from "../src/features/tactics/model/skills";
import {
  armorValue,
  moveBudget,
  tickStatuses,
} from "../src/features/roster/lib/status";
import { terrainRules } from "../src/features/terrain/lib/cost";
import { reachable } from "../src/features/terrain/lib/paths";
import {
  buildMigratedManifest,
  migrateLegacyArchive,
} from "../src/features/replay/lib/migration";
import { useHistoryStore } from "../src/features/replay/model/history";
import { chunkKey, tailKey } from "../src/features/replay/lib/storage";
import {
  diffBattle,
  patchBattle,
  rebuildFromCheckpoint,
} from "../src/features/replay/lib/delta";
import { MemoryStorage, install, wait } from "./storage-shim";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}
const group = (name: string) => console.log(`\n[${name}]`);

function freshStorage(): MemoryStorage {
  const mem = new MemoryStorage();
  install(mem);
  return mem;
}

function clearHooks() {
  (globalThis as Record<string, unknown>).__WE001_IO_HOOK__ = undefined;
}

/* 用真实游戏逻辑构造一个含 N 步完整快照的旧版 Session */
function buildLegacySession(steps: number): Session {
  const s = newSession();
  let guard = 0;
  while (s.events.length < steps && guard++ < steps * 8) {
    if (s.live.ended) break;
    const before = clone(s.live);
    const actorId = s.live.active;
    const actor = s.live.units.find((u) => u.id === actorId)!;
    const roll = s.events.length % 4;
    if (roll === 0) {
      const routes = reachable(s.live, actor, moveBudget(actor));
      const pick = [...routes.values()].filter((r) => r.path.length).at(-1);
      if (pick) {
        moveUnit(s.live, actor.id, pick.path);
        s.events.push({
          id: s.events.length + 1,
          kind: "move",
          actor: actorId,
          label: `${actor.name}移动`,
          path: clone(pick.path),
          before,
          after: clone(s.live),
        });
        continue;
      }
    } else if (roll === 1) {
      const skill = getSkill(
        actor.job,
        actor.job === "ranger"
          ? "shot"
          : actor.job === "mage"
            ? "flame"
            : actor.job === "guard"
              ? "strike"
              : "heal",
      )!;
      const target = s.live.units.find((t) => {
        if (t.hp <= 0) return false;
        const d = Math.abs(t.x - actor.x) + Math.abs(t.y - actor.y);
        if (d > skill.range) return false;
        if (skill.target === "enemy") return t.team !== actor.team;
        if (skill.target === "ally")
          return t.team === actor.team && t.hp < t.maxHp;
        return t.id === actor.id;
      });
      if (target) {
        const ground = s.live.tiles.find((v) => key(v) === key(target))!;
        const high =
          s.live.tiles.find((v) => key(v) === key(actor))!.terrain === "ridge";
        castSkill(
          s.live,
          actor.id,
          target.id,
          skill,
          armorValue(target),
          terrainRules[ground.terrain].cover,
          high,
        );
        s.events.push({
          id: s.events.length + 1,
          kind: "skill",
          actor: actorId,
          label: `${actor.name}施放${skill.name}`,
          path: [],
          before,
          after: clone(s.live),
        });
        continue;
      }
    } else if (roll === 2) {
      const tile = s.live.tiles.find(
        (t) => !s.live.units.some((u) => u.hp > 0 && key(u) === key(t)),
      )!;
      tile.terrain = tile.terrain === "forest" ? "plain" : "forest";
      s.events.push({
        id: s.events.length + 1,
        kind: "terrain",
        actor: actorId,
        label: "地形调整",
        path: [],
        before,
        after: clone(s.live),
      });
      continue;
    }
    finishTurn(s.live, tickStatuses);
    s.events.push({
      id: s.events.length + 1,
      kind: "wait",
      actor: actorId,
      label: `${actor.name}结束行动`,
      path: [],
      before,
      after: clone(s.live),
    });
  }
  return s;
}

function assertBattleEqual(a: Battle, b: Battle, where: string) {
  assert.equal(
    JSON.stringify(a),
    JSON.stringify(b),
    `战斗状态不一致 @ ${where}`,
  );
}

/** 录制 n 个“结束行动”动作并逐步落盘 */
async function recordWaits(
  s: ReturnType<typeof useHistoryStore>,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const before = clone(s.live.value);
    const actor = s.live.value.units.find(
      (u) => u.id === s.live.value.active,
    )!;
    finishTurn(s.live.value, tickStatuses);
    s.record(before, "wait", `${actor.name}结束行动`);
    await s.persist();
  }
}

async function main() {
  const legacy = buildLegacySession(30);
  const legacySize = JSON.stringify(legacy).length;

  /* ---------------- 1. 增量正确性 ---------------- */
  group("增量 diff / patch");
  freshStorage();
  await test("任意一步的 before+delta 重建结果等于原始 after 快照", () => {
    for (const e of legacy.events) {
      const delta = diffBattle(e.before, e.after);
      assertBattleEqual(patchBattle(e.before, delta), e.after, `步骤 ${e.id}`);
    }
  });

  /* ---------------- 2. 迁移 ---------------- */
  group("旧完整快照迁移");
  const mem2 = freshStorage();
  localStorage.setItem("we001-session", JSON.stringify(legacy));
  const planned = buildMigratedManifest(legacy, 12);

  await test("分块数量与边界正确（30 步 / 块大小 12 → 2 块 + 尾块 6 步）", () => {
    assert.equal(planned.chunks.length, 2);
    assert.equal(planned.chunks[0].fromStep, 0);
    assert.equal(planned.chunks[0].toStep, 12);
    assert.equal(planned.chunks[1].toStep, 24);
    assert.ok(planned.tail && planned.tail.deltas.length === 6);
  });

  await test("保留原始逻辑步骤编号（1..30，不重新编号）", () => {
    const ids = planned.manifest.events.map((e) => e.id);
    assert.deepEqual(ids, Array.from({ length: 30 }, (_, i) => i + 1));
    const allDeltas = [
      ...planned.chunks.flatMap((c) => c.deltas),
      ...(planned.tail?.deltas ?? []),
    ];
    assert.deepEqual(
      allDeltas.map((d) => d.id),
      ids,
    );
  });

  await test("每个检查点+增量逐帧重建与旧快照完全一致", () => {
    for (const chunk of planned.chunks) {
      for (let k = 1; k <= chunk.deltas.length; k++) {
        const step = chunk.fromStep + k;
        assertBattleEqual(
          rebuildFromCheckpoint(chunk.checkpoint, chunk.deltas, k),
          legacy.events[step - 1].after,
          `块${chunk.index} 步骤${step}`,
        );
      }
    }
    const tail = planned.tail!;
    for (let k = 1; k <= tail.deltas.length; k++) {
      const step = tail.fromStep + k;
      assertBattleEqual(
        rebuildFromCheckpoint(tail.checkpoint, tail.deltas, k),
        legacy.events[step - 1].after,
        `尾块 步骤${step}`,
      );
    }
  });

  await test("分块档案体积显著小于完整快照档", () => {
    const newSize =
      JSON.stringify(planned.manifest).length +
      planned.chunks.reduce((n, c) => n + JSON.stringify(c).length, 0) +
      (planned.tail ? JSON.stringify(planned.tail).length : 0);
    const ratio = newSize / legacySize;
    console.log(
      `    旧档 ${legacySize} 字符 → 新档 ${newSize} 字符（${(ratio * 100).toFixed(1)}%）`,
    );
    assert.ok(ratio < 0.55, `压缩后应小于 55%，实际 ${(ratio * 100).toFixed(1)}%`);
  });

  const migration = await migrateLegacyArchive();
  await test("迁移成功后旧档被删除，新清单/块/尾块全部落盘", () => {
    assert.equal(migration.kind, "migrated");
    assert.equal(localStorage.getItem("we001-session"), null);
    const manifest = JSON.parse(
      localStorage.getItem("we001-archive:v2:manifest")!,
    ) as ArchiveManifest;
    assert.equal(manifest.chunks.length, 2);
    for (const d of manifest.chunks) {
      assert.ok(localStorage.getItem(chunkKey(d.id)), `块 ${d.id} 应存在`);
    }
    assert.ok(
      localStorage.getItem(tailKey(manifest.archiveId)),
      "尾块应存在",
    );
  });

  /* ---------------- 3. 运行时：按需读取、取消、损坏 ---------------- */
  group("历史库运行时");
  const store = useHistoryStore();
  await store.bootstrap();

  await test("启动后时间轴长度与元数据编号正确", () => {
    assert.equal(store.length.value, 30);
    assert.deepEqual(
      store.manifest.events.map((e) => e.id),
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  await test("未访问的块标记为 unloaded，尾块标记为 pending", () => {
    assert.equal(store.stepState(1), "unloaded");
    assert.equal(store.stepState(24), "unloaded");
    assert.equal(store.stepState(25), "pending");
    assert.equal(store.stepState(30), "pending");
  });

  await test("异步定位到远处步骤，重建帧与旧快照一致", async () => {
    const ok = await store.locate(18);
    assert.ok(ok);
    assert.equal(store.cursor.value, 18);
    assertBattleEqual(store.displayed.value, legacy.events[17].after, "locate(18)");
    assert.equal(store.stepState(18), "loaded");
  });
  await test("快速连续拖动：旧定位被令牌取消，仅最后一次生效", async () => {
    let resolveIo: () => void = () => undefined;
    const gate = new Promise<void>((r) => (resolveIo = r));
    let calls = 0;
    (globalThis as Record<string, unknown>).__WE001_IO_HOOK__ = async () => {
      calls++;
      await gate;
    };
    const first = store.locate(5);
    await wait(0);
    const second = store.locate(20);
    resolveIo();
    const r1 = await first;
    const r2 = await second;
    clearHooks();
    assert.equal(r1, false, "被取消的定位应返回 false");
    assert.equal(r2, true);
    assert.equal(store.cursor.value, 20, "画面只切换到最后请求的步骤");
    assert.ok(calls >= 1);
    assertBattleEqual(store.displayed.value, legacy.events[19].after, "locate(20)");
  });

  await test("损坏块只标记受影响区间，其他区间与实战仍可用", async () => {
    const manifest = JSON.parse(
      localStorage.getItem("we001-archive:v2:manifest")!,
    ) as ArchiveManifest;
    const targetId = manifest.chunks[0].id;
    const corrupted = JSON.parse(localStorage.getItem(chunkKey(targetId))!);
    corrupted.deltas[3].delta.units = { hacked: { hp: 1 } };
    localStorage.setItem(chunkKey(targetId), JSON.stringify(corrupted));

    const fresh = useHistoryStore();
    await fresh.bootstrap();
    const ok = await fresh.locate(4);
    assert.equal(ok, false);
    assert.equal(fresh.stepState(4), "corrupt");
    assert.equal(fresh.stepState(13), "unloaded", "块 1 不受影响");
    const range = fresh.corruptedRanges.value[0];
    assert.equal(range.fromStep, 1);
    assert.equal(range.toStep, 12);
    const ok2 = await fresh.locate(15);
    assert.ok(ok2);
    assertBattleEqual(
      fresh.displayed.value,
      legacy.events[14].after,
      "未损坏块正常重建",
    );
    fresh.backToLive();
    assert.equal(fresh.cursor.value, -1);
    assert.equal(fresh.locked.value, false);
    assertBattleEqual(fresh.displayed.value, fresh.live.value, "返回实战");
  });

  /* ---------------- 4. 安全写入 ---------------- */
  group("安全写入语义");
  const mem4 = freshStorage();
  await test("写入故障时绝不先删旧档：正式键内容保持不变，且可重试", async () => {
    const s2 = useHistoryStore();
    await s2.bootstrap(); // 空档案
    await recordWaits(s2, 2);
    const manifestKey = "we001-archive:v2:manifest";
    const tKey = tailKey(s2.manifest.archiveId);
    const manifestBefore = localStorage.getItem(manifestKey);
    const tailBefore = localStorage.getItem(tKey);
    mem4.failWritesTo = [manifestKey, tKey]; // 仅正式键故障，:tmp 放行
    const before = clone(s2.live.value);
    s2.record(before, "wait", "测试动作");
    await assert.rejects(() => s2.persist(), /旧档|写入故障/);
    mem4.failWritesTo = [];
    assert.equal(
      localStorage.getItem(manifestKey),
      manifestBefore,
      "清单旧档必须原样保留",
    );
    assert.equal(
      localStorage.getItem(tKey),
      tailBefore,
      "尾块旧档必须原样保留",
    );
    assert.ok(
      !mem4.keys().some((k) => k.endsWith(":tmp")),
      "临时键应被清理",
    );
    await s2.persist();
    const after = JSON.parse(
      localStorage.getItem(manifestKey)!,
    ) as ArchiveManifest;
    assert.equal(after.events.length, 3, "重试后新动作成功落盘");
  });

  await test("事件顺序中正式键不存在先删后写", () => {
    for (const ev of mem4.events) {
      if (ev.type === "remove" && !ev.key.endsWith(":tmp")) {
        const laterSet = mem4.events.some(
          (e) => e.type === "set" && e.at > ev.at && !e.key.endsWith(":tmp"),
        );
        assert.ok(!laterSet, `不应先删后写: ${ev.key}`);
      }
    }
  });

  /* ---------------- 5. 录制与跨块定稿 ---------------- */
  group("录制 / 分块定稿");
  freshStorage();
  await test("新战斗录制跨过块大小时定稿不可变块并开启新尾块", async () => {
    const s3 = useHistoryStore();
    await s3.reset();
    assert.equal(s3.manifest.events.length, 0);
    await recordWaits(s3, 13);
    assert.equal(s3.manifest.chunks.length, 1, "满 12 步定稿一个块");
    assert.equal(s3.manifest.chunks[0].toStep, 12);
    assert.equal(s3.manifest.tail?.deltas.length, 1);
    assert.equal(
      s3.manifest.events.map((e) => e.id).at(-1),
      13,
      "编号连续不重排",
    );
    const chunkRaw = JSON.parse(
      localStorage.getItem(chunkKey(s3.manifest.chunks[0].id))!,
    );
    assert.equal(chunkRaw.checksum, s3.manifest.chunks[0].checksum);
  });

  /* ---------------- 6. 跨块播放不跳步 ---------------- */
  group("播放语义");
  freshStorage();
  await test("跨块按需读取时每一步都产生定位而不跳过", async () => {
    const s4 = useHistoryStore();
    await s4.reset();
    await recordWaits(s4, 25); // 2 个满块 + 尾块 1 步

    const viewer = useHistoryStore();
    await viewer.bootstrap();
    const seen: number[] = [];
    const originalLocate = viewer.locate.bind(viewer);
    viewer.locate = async (step: number) => {
      const ok = await originalLocate(step);
      if (ok) seen.push(step);
      return ok;
    };
    (globalThis as Record<string, unknown>).__WE001_IO_HOOK__ = async () => {
      await wait(5); // 模拟块读取 IO 延迟
    };
    for (let step = 0; step <= 25; step++) {
      await viewer.locate(step);
    }
    clearHooks();
    assert.deepEqual(
      seen,
      Array.from({ length: 26 }, (_, i) => i),
      "0..25 每一步都被定位，无跳过",
    );
  });

  /* ---------------- 7. 尾块损坏启动恢复 ---------------- */
  group("启动健壮性");
  freshStorage();
  await test("尾块损坏时只标记尾块区间，清单与已定稿块仍可读", async () => {
    const s5 = useHistoryStore();
    await s5.reset();
    await recordWaits(s5, 14); // 1 满块 + 尾块 2 步
    const id = s5.manifest.archiveId;
    // 破坏尾块结构（删除检查点），启动校验必须识别为损坏
    const tailRaw = JSON.parse(localStorage.getItem(tailKey(id))!);
    delete tailRaw.checkpoint;
    localStorage.setItem(tailKey(id), JSON.stringify(tailRaw));

    const recovered = useHistoryStore();
    await recovered.bootstrap();
    assert.equal(recovered.manifest.chunks.length, 1, "定稿块保留");
    const range = recovered.corruptedRanges.value[0];
    assert.ok(range, "应产生损坏区间");
    assert.equal(range.fromStep, 13);
    assert.equal(range.toStep, 14, "尾块两步均被标记");
    assert.equal(recovered.stepState(6), "unloaded", "块内步骤不受尾块损坏影响");
    const ok = await recovered.locate(10);
    assert.ok(ok, "未损坏历史仍可回放");
  });

  /* ---------------- 8. 导出 ---------------- */
  group("导出");
  freshStorage();
  await test("导出为自包含 v2 JSON，编号与清单一致", async () => {
    const s6 = useHistoryStore();
    await s6.reset();
    await recordWaits(s6, 15);
    const { filename, json } = await s6.exportArchive();
    assert.equal(filename, "灰烬渡口-战斗记录.json");
    const payload = JSON.parse(json);
    assert.equal(payload.format, "we001-battle-archive/v2");
    assert.deepEqual(
      payload.manifest.events.map((e: { id: number }) => e.id),
      Array.from({ length: payload.manifest.events.length }, (_, i) => i + 1),
    );
    assert.ok(payload.chunks.length >= 1);
    assert.ok(payload.tail !== undefined);
  });

  await test("存在损坏块时导出被拒绝，避免产出残缺记录", async () => {
    const s7 = useHistoryStore();
    await s7.reset();
    await recordWaits(s7, 13);
    const id = s7.manifest.chunks[0].id;
    const raw = JSON.parse(localStorage.getItem(chunkKey(id))!);
    raw.checksum = "00000000";
    localStorage.setItem(chunkKey(id), JSON.stringify(raw));
    const viewer = useHistoryStore();
    await viewer.bootstrap();
    await assert.rejects(() => viewer.exportArchive(), /已损坏/);
  });

  /* ---------------- 9. 迁移失败保留旧档 ---------------- */
  group("迁移失败安全");
  await test("配额不足导致迁移失败时，旧完整快照档原样保留且可再次迁移", async () => {
    const mem9 = freshStorage();
    localStorage.setItem("we001-session", JSON.stringify(legacy));
    const legacyRaw = localStorage.getItem("we001-session");
    // 极小配额：新键全部写入失败
    mem9.quota = (legacyRaw?.length ?? 0) + 10;
    const failed = await migrateLegacyArchive();
    assert.equal(failed.kind, "failed");
    assert.equal(
      localStorage.getItem("we001-session"),
      legacyRaw,
      "压缩失败必须继续保留旧档",
    );
    // 放开配额后再次迁移成功
    mem9.quota = Number.POSITIVE_INFINITY;
    const retry = await migrateLegacyArchive();
    assert.equal(retry.kind, "migrated");
    assert.equal(localStorage.getItem("we001-session"), null);
  });

  await test("旧档 JSON 损坏时返回 failed 且不写入任何新键", async () => {
    const mem10 = freshStorage();
    localStorage.setItem("we001-session", "{不是合法 JSON");
    const beforeKeys = mem10.keys();
    const r = await migrateLegacyArchive();
    assert.equal(r.kind, "failed");
    assert.deepEqual(mem10.keys(), beforeKeys, "失败迁移不得留下半成品键");
  });

  console.log(
    `\n${process.exitCode ? "存在失败用例" : `全部通过 · ${passed} 个用例`}`,
  );
}

void main();
