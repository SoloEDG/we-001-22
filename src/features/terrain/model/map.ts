import type { Battle, Point, Terrain, Tile } from "../../../shared/types";
import { key } from "../../../shared/document";
export function createMap(): Tile[] {
  return Array.from({ length: 96 }, (_, i) => {
    const x = i % 12,
      y = Math.floor(i / 12);
    const terrain: Terrain =
      x === 6 && y !== 3 && y !== 4
        ? "water"
        : (x === 4 && y < 3) || (x === 8 && y > 3)
          ? "forest"
          : x === 9 && y < 3
            ? "ridge"
            : x === 5 && y === 6
              ? "wall"
              : "plain";
    return { x, y, terrain };
  });
}
export function paintTile(b: Battle, p: Point, terrain: Terrain) {
  if (b.units.some((u) => u.hp > 0 && key(u) === key(p)))
    throw new Error("角色脚下不可编辑地形");
  const tile = b.tiles.find((t) => key(t) === key(p));
  if (!tile) throw new Error("地图外坐标");
  tile.terrain = terrain;
}
