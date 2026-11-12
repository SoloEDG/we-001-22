import type { Battle } from "../../../shared/types";
export function order(b: Battle) {
  return b.units
    .filter((u) => u.hp > 0)
    .sort((a, c) => c.speed - a.speed || a.id.localeCompare(c.id))
    .map((u) => u.id);
}
export function outcome(b: Battle) {
  const teams = new Set(b.units.filter((u) => u.hp > 0).map((u) => u.team));
  return teams.size <= 1 ? (teams.values().next().value ?? "draw") : null;
}
