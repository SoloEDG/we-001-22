import type { Skill, Unit } from "../../../shared/types";
export function previewDamage(
  a: Unit,
  t: Unit,
  s: Skill,
  armor: number,
  cover: number,
  elevated: boolean,
) {
  return s.target === "ally"
    ? Math.min(s.power, t.maxHp - t.hp)
    : s.target === "self"
      ? 0
      : Math.max(1, a.power + s.power - armor - cover + (elevated ? 2 : 0));
}
