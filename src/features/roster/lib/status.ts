import type { Unit } from "../../../shared/types";
export function moveBudget(u: Unit) {
  return Math.max(
    1,
    u.move - (u.statuses.some((s) => s.kind === "slow") ? 2 : 0),
  );
}
export function armorValue(u: Unit) {
  return u.armor + (u.statuses.some((s) => s.kind === "guard") ? 4 : 0);
}
export function tickStatuses(u: Unit) {
  for (const s of u.statuses)
    if (s.kind === "burn") u.hp = Math.max(0, u.hp - 3);
  u.statuses = u.statuses
    .map((s) => ({ ...s, turns: s.turns - 1 }))
    .filter((s) => s.turns > 0);
}
export const statusNames = { slow: "迟缓", burn: "灼烧", guard: "防御" };
