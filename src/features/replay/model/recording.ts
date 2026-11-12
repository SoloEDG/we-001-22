import type {
  ActionDelta,
  Battle,
  EventKind,
  EventMeta,
  Point,
} from "../../../shared/types";
import { clone } from "../../../shared/document";
import { diffBattle } from "../lib/delta";

/**
 * 录制一个动作增量。
 * id 由历史库按原始逻辑步骤递增分配，分块、迁移、回放全流程保持不变，
 * 不做压缩后重新编号，保证下载记录与历史引用始终可对照。
 */
export function buildDelta(
  id: number,
  before: Battle,
  after: Battle,
  kind: EventKind,
  actor: string,
  label: string,
  path: Point[] = [],
): ActionDelta {
  return {
    id,
    kind,
    actor,
    label,
    path: clone(path),
    delta: diffBattle(before, after),
  };
}

export function toMeta(d: ActionDelta): EventMeta {
  return {
    id: d.id,
    kind: d.kind,
    actor: d.actor,
    label: d.label,
    path: clone(d.path),
  };
}
