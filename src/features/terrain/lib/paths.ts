import type { Battle, Point, Unit } from "../../../shared/types";
import { key } from "../../../shared/document";
import { movementCost } from "./cost";
export interface Route {
  cost: number;
  path: Point[];
}
export function reachable(
  b: Battle,
  u: Unit,
  budget: number,
): Map<string, Route> {
  const result = new Map<string, Route>([[key(u), { cost: 0, path: [] }]]);
  const pending: Point[] = [u];
  while (pending.length) {
    pending.sort((a, c) => result.get(key(a))!.cost - result.get(key(c))!.cost);
    const pos = pending.shift()!;
    const route = result.get(key(pos))!;
    for (const d of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { x: pos.x + d[0], y: pos.y + d[1] };
      const tile = b.tiles.find((t) => key(t) === key(n));
      if (
        !tile ||
        b.units.some((v) => v.hp > 0 && v.id !== u.id && key(v) === key(n))
      )
        continue;
      const cost = route.cost + movementCost(tile.terrain, u);
      if (cost > budget || cost >= (result.get(key(n))?.cost ?? Infinity))
        continue;
      result.set(key(n), { cost, path: [...route.path, n] });
      pending.push(n);
    }
  }
  return result;
}
