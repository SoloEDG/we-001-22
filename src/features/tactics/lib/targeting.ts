import type { Battle, Skill, Unit } from "../../../shared/types";
import { distance } from "../../../shared/document";
export function hasSight(b: Battle, a: Unit, t: Unit) {
  const steps = Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y));
  for (let i = 1; i < steps; i++) {
    const x = Math.round(a.x + ((t.x - a.x) * i) / steps),
      y = Math.round(a.y + ((t.y - a.y) * i) / steps);
    if (b.tiles.some((v) => v.x === x && v.y === y && v.terrain === "wall"))
      return false;
  }
  return true;
}
export function legalTargets(b: Battle, a: Unit, s: Skill) {
  return b.units.filter(
    (t) =>
      t.hp > 0 &&
      distance(a, t) <= s.range &&
      (s.target === "self"
        ? a.id === t.id
        : s.target === "ally"
          ? a.team === t.team
          : a.team !== t.team) &&
      hasSight(b, a, t),
  );
}
