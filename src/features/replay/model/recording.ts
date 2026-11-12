import type { Battle, EventKind, Point, Session } from "../../../shared/types";
import { clone } from "../../../shared/document";
export function record(
  s: Session,
  before: Battle,
  kind: EventKind,
  label: string,
  path: Point[] = [],
) {
  s.events.push({
    id: s.events.length + 1,
    kind,
    actor: before.active,
    label,
    path: clone(path),
    before: clone(before),
    after: clone(s.live),
  });
}
export function frame(s: Session, cursor: number) {
  return cursor < 0
    ? s.live
    : cursor === 0
      ? s.initial
      : s.events[Math.min(cursor, s.events.length) - 1].after;
}
