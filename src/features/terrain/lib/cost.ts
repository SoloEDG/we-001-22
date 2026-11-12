import type { Terrain, Unit } from "../../../shared/types";
export const terrainRules: Record<
  Terrain,
  { name: string; cost: number; cover: number; glyph: string }
> = {
  plain: { name: "草原", cost: 1, cover: 0, glyph: "·" },
  forest: { name: "密林", cost: 2, cover: 3, glyph: "♠" },
  water: { name: "浅滩", cost: 3, cover: 0, glyph: "≈" },
  ridge: { name: "高地", cost: 2, cover: 1, glyph: "△" },
  wall: { name: "断崖", cost: Infinity, cover: 0, glyph: "▰" },
};
export function movementCost(t: Terrain, u: Unit) {
  return t === "water" && u.job === "ranger" ? 2 : terrainRules[t].cost;
}
