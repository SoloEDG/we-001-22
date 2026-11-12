import type { Battle, Status, Tile, Unit } from "../../../shared/types";
import { key } from "../../../shared/document";

/**
 * 动作增量：仅记录相邻两个 Battle 之间的结构差异。
 * 缺失字段表示未变化，回放时按字段合并还原。
 */

export interface UnitPatch {
  x?: number;
  y?: number;
  hp?: number;
  armor?: number;
  moved?: boolean;
  acted?: boolean;
  statuses?: Status[];
}

export interface TilePatch {
  terrain: Tile["terrain"];
}

export interface BattleDelta {
  tiles?: Record<string, TilePatch>;
  units?: Record<string, UnitPatch>;
  round?: number;
  queue?: string[];
  active?: string;
  ended?: string | null;
}

const UNIT_FIELDS: (keyof UnitPatch)[] = [
  "x",
  "y",
  "hp",
  "armor",
  "moved",
  "acted",
  "statuses",
];

function diffUnits(before: Unit[], after: Unit[]): BattleDelta["units"] {
  const map: Record<string, UnitPatch> = {};
  const beforeMap = new Map(before.map((u) => [u.id, u]));
  for (const next of after) {
    const prev = beforeMap.get(next.id);
    if (!prev) continue; // 本战斗单位集合恒定（死亡仅 hp 归 0），无新增
    const patch: UnitPatch = {};
    for (const f of UNIT_FIELDS) {
      const a = prev[f as keyof Unit];
      const b = next[f as keyof Unit];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        (patch as Record<string, unknown>)[f] = b;
      }
    }
    if (Object.keys(patch).length) map[next.id] = patch;
  }
  return Object.keys(map).length ? map : undefined;
}

function diffTiles(before: Tile[], after: Tile[]): BattleDelta["tiles"] {
  const map: Record<string, TilePatch> = {};
  const beforeMap = new Map(before.map((t) => [key(t), t]));
  for (const next of after) {
    const prev = beforeMap.get(key(next));
    if (prev && prev.terrain !== next.terrain) {
      map[key(next)] = { terrain: next.terrain };
    }
  }
  return Object.keys(map).length ? map : undefined;
}

/** 计算 after 相对 before 的增量（before/after 均为深拷贝后的值） */
export function diffBattle(before: Battle, after: Battle): BattleDelta {
  const delta: BattleDelta = {};
  const tiles = diffTiles(before.tiles, after.tiles);
  if (tiles) delta.tiles = tiles;
  const units = diffUnits(before.units, after.units);
  if (units) delta.units = units;
  if (before.round !== after.round) delta.round = after.round;
  if (JSON.stringify(before.queue) !== JSON.stringify(after.queue))
    delta.queue = [...after.queue];
  if (before.active !== after.active) delta.active = after.active;
  if (before.ended !== after.ended) delta.ended = after.ended;
  return delta;
}

/** 在基准 Battle 上应用增量，返回新的 Battle（不修改入参） */
export function patchBattle(base: Battle, delta: BattleDelta): Battle {
  const next: Battle = JSON.parse(JSON.stringify(base)) as Battle;
  if (delta.tiles) {
    const tileMap = new Map(next.tiles.map((t) => [key(t), t]));
    for (const [k, p] of Object.entries(delta.tiles)) {
      const tile = tileMap.get(k);
      if (tile) tile.terrain = p.terrain;
    }
  }
  if (delta.units) {
    for (const u of next.units) {
      const p = delta.units[u.id];
      if (!p) continue;
      if (p.x !== undefined) u.x = p.x;
      if (p.y !== undefined) u.y = p.y;
      if (p.hp !== undefined) u.hp = p.hp;
      if (p.armor !== undefined) u.armor = p.armor;
      if (p.moved !== undefined) u.moved = p.moved;
      if (p.acted !== undefined) u.acted = p.acted;
      if (p.statuses !== undefined) u.statuses = JSON.parse(JSON.stringify(p.statuses));
    }
  }
  if (delta.round !== undefined) next.round = delta.round;
  if (delta.queue !== undefined) next.queue = [...delta.queue];
  if (delta.active !== undefined) next.active = delta.active;
  if (delta.ended !== undefined) next.ended = delta.ended;
  return next;
}

/** 从检查点连续应用增量，重建 toStep 对应的战斗状态 */
export function rebuildFromCheckpoint(
  checkpoint: Battle,
  deltas: { delta: BattleDelta }[],
  count: number,
): Battle {
  let battle = checkpoint;
  for (let i = 0; i < Math.min(count, deltas.length); i++) {
    battle = patchBattle(battle, deltas[i].delta);
  }
  return battle;
}
