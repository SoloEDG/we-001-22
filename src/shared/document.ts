import type { Battle, Point, Unit } from "./types";
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const key = (p: Point) => `${p.x},${p.y}`;
export const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const living = (b: Battle) => b.units.filter((u) => u.hp > 0);
export const findUnit = (b: Battle, id: string): Unit => {
  const u = b.units.find((u) => u.id === id);
  if (!u) throw new Error("角色不存在");
  return u;
};
export function assertBattle(b: Battle) {
  if (b.tiles.length !== 96 || new Set(b.tiles.map(key)).size !== 96)
    throw new Error("地图数据不完整");
  if (
    !b.units.length ||
    new Set(b.units.map((u) => u.id)).size !== b.units.length
  )
    throw new Error("角色数据不完整");
}
