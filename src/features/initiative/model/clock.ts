import type { Battle } from "../../../shared/types";
export function turnProgress(b: Battle) {
  const alive = b.units.filter((u) => u.hp > 0).length;
  return alive ? Math.round(((alive - b.queue.length) / alive) * 100) : 100;
}
export function turnLabel(b: Battle) {
  return b.ended
    ? `${b.ended === "azure" ? "苍蓝军" : "余烬军"}获胜`
    : `第 ${b.round} 回合 · ${b.queue.length} 人待行动`;
}
