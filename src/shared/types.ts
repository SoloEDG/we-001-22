export type Terrain = "plain" | "forest" | "water" | "ridge" | "wall";
export type Profession = "guard" | "ranger" | "mage" | "medic";
export interface Point {
  x: number;
  y: number;
}
export interface Tile extends Point {
  terrain: Terrain;
}
export interface Status {
  kind: "slow" | "burn" | "guard";
  turns: number;
}
export interface Unit extends Point {
  id: string;
  name: string;
  job: Profession;
  team: "azure" | "ember";
  hp: number;
  maxHp: number;
  power: number;
  armor: number;
  speed: number;
  move: number;
  statuses: Status[];
  moved: boolean;
  acted: boolean;
}
export interface Battle {
  tiles: Tile[];
  units: Unit[];
  round: number;
  queue: string[];
  active: string;
  ended: string | null;
}
export type EventKind = "move" | "skill" | "wait" | "terrain";
export interface BattleEvent {
  id: number;
  kind: EventKind;
  actor: string;
  label: string;
  path: Point[];
  before: Battle;
  after: Battle;
}
export interface Session {
  initial: Battle;
  live: Battle;
  events: BattleEvent[];
}
export interface Skill {
  id: string;
  name: string;
  range: number;
  power: number;
  target: "enemy" | "ally" | "self";
  status?: Status["kind"];
  description: string;
}

/* ------------------------------------------------------------------ */
/* 分块档案 v2：检查点 + 动作增量                                       */
/* ------------------------------------------------------------------ */

export type ChunkStatus = "ok" | "corrupt";

/** 步骤的轻量元数据，时间轴无需加载块即可展示，id 为原始逻辑步骤编号 */
export interface EventMeta {
  id: number;
  kind: EventKind;
  actor: string;
  label: string;
  path: Point[];
}

/** 单步动作 = 元数据 + 相对检查点/上一步的结构化增量 */
export interface ActionDelta extends EventMeta {
  delta: import("../features/replay/lib/delta").BattleDelta;
}

/** 已定稿的不可变块：检查点快照 + 块内动作增量 */
export interface ArchiveChunk {
  index: number;
  fromStep: number;
  toStep: number;
  checkpoint: Battle;
  deltas: ActionDelta[];
  checksum: string;
}

export interface ChunkDescriptor {
  id: string;
  index: number;
  fromStep: number;
  toStep: number;
  status: ChunkStatus;
  checksum: string;
}

/** 写入中的开放尾块，每次落盘走 temp 键验证后替换 */
export interface OpenTail {
  index: number;
  fromStep: number;
  checkpoint: Battle;
  deltas: ActionDelta[];
}

export interface CorruptedRange {
  fromStep: number;
  toStep: number;
  reason: string;
}

export interface ArchiveManifest {
  version: 2;
  archiveId: string;
  chunkSize: number;
  createdAt: string;
  updatedAt: string;
  initial: Battle;
  live: Battle;
  /** 已定稿不可变块描述 */
  chunks: ChunkDescriptor[];
  /** 开放尾块（含检查点与未填满的增量） */
  tail: OpenTail | null;
  /** 全部步骤的轻量元数据，保留原始编号 */
  events: EventMeta[];
  /** 损坏块影响的步骤区间，仅标记不破坏其余档案 */
  corruptedRanges: CorruptedRange[];
}

export type StepLoadState = "loaded" | "unloaded" | "corrupt" | "pending";
