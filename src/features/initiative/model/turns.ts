import type { Battle } from "../../../shared/types";
import { findUnit } from "../../../shared/document";
import { order, outcome } from "../lib/order";
export function finishTurn(
  b: Battle,
  tick: (u: ReturnType<typeof findUnit>) => void,
) {
  tick(findUnit(b, b.active));
  b.queue = b.queue.filter((id) => id !== b.active && findUnit(b, id).hp > 0);
  b.ended = outcome(b);
  if (b.ended) return;
  if (!b.queue.length) {
    b.round++;
    b.queue = order(b);
    for (const u of b.units) {
      u.moved = false;
      u.acted = false;
    }
  }
  b.active = b.queue[0];
}
