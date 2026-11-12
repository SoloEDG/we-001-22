import type {
  ActionDelta,
  ArchiveChunk,
  ArchiveManifest,
  EventMeta,
  OpenTail,
  Session,
} from "../../../shared/types";
import { clone } from "../../../shared/document";
import { diffBattle } from "./delta";
import {
  computeChunkChecksum,
  readLegacy,
  removeLegacy,
  storageActiveKeys,
  writeChunk,
  writeManifest,
  writeTail,
  gcStorage,
} from "./storage";
import { buildManifestBase, newArchiveId } from "./manifest";

export const CHUNK_SIZE = 12;

function toMeta(s: Session): EventMeta[] {
  return s.events.map((e) => ({
    id: e.id, // 保留原始逻辑步骤编号，不重新编号
    kind: e.kind,
    actor: e.actor,
    label: e.label,
    path: clone(e.path),
  }));
}

function toDeltas(s: Session): ActionDelta[] {
  return s.events.map((e) => ({
    id: e.id,
    kind: e.kind,
    actor: e.actor,
    label: e.label,
    path: clone(e.path),
    delta: diffBattle(e.before, e.after),
  }));
}

/**
 * 将旧版完整快照 Session 压缩为检查点 + 增量分块。
 * 纯计算，不触碰存储。
 */
export function buildMigratedManifest(
  s: Session,
  chunkSize = CHUNK_SIZE,
): { manifest: ArchiveManifest; chunks: ArchiveChunk[]; tail: OpenTail | null } {
  const archiveId = newArchiveId();
  const deltas = toDeltas(s);
  const chunks: ArchiveChunk[] = [];
  let tail: OpenTail | null = null;
  const fullCount = Math.floor(deltas.length / chunkSize);

  for (let c = 0; c < fullCount; c++) {
    const fromStep = c * chunkSize;
    const part = deltas.slice(fromStep, fromStep + chunkSize);
    const checkpoint =
      fromStep === 0 ? clone(s.initial) : clone(s.events[fromStep - 1].after);
    const body = {
      index: c,
      fromStep,
      toStep: fromStep + part.length,
      checkpoint,
      deltas: part,
    };
    chunks.push({ ...body, checksum: computeChunkChecksum(body) });
  }

  const rest = deltas.slice(fullCount * chunkSize);
  if (rest.length) {
    const fromStep = fullCount * chunkSize;
    tail = {
      index: fullCount,
      fromStep,
      checkpoint:
        fromStep === 0 ? clone(s.initial) : clone(s.events[fromStep - 1].after),
      deltas: rest,
    };
  }

  const manifest: ArchiveManifest = {
    ...buildManifestBase({
      archiveId,
      chunkSize,
      initial: s.initial,
      live: s.live,
      events: toMeta(s),
    }),
    chunks: chunks.map((c) => ({
      id: `${archiveId}-c${c.index}`,
      index: c.index,
      fromStep: c.fromStep,
      toStep: c.toStep,
      status: "ok",
      checksum: c.checksum,
    })),
    tail,
    corruptedRanges: [],
  };
  return { manifest, chunks, tail };
}

export type MigrationResult =
  | { kind: "none" }
  | { kind: "migrated"; steps: number; chunks: number }
  | { kind: "failed"; reason: string };

/**
 * 迁移旧完整快照档。
 *
 * 顺序保证：所有块、尾块、清单都经安全写入并回读验证成功之后，
 * 才删除旧档；任何一步抛错都立即中止，旧 we001-session 原样保留，
 * 下次启动可再次尝试。
 */
export async function migrateLegacyArchive(): Promise<MigrationResult> {
  let legacy: Session | null;
  try {
    legacy = await readLegacy();
  } catch {
    return { kind: "failed", reason: "旧档无法解析，未做改动" };
  }
  if (!legacy) return { kind: "none" };

  try {
    const { manifest, chunks, tail } = buildMigratedManifest(legacy);
    for (const c of chunks) {
      await writeChunk(`${manifest.archiveId}-c${c.index}`, c);
    }
    if (tail) {
      await writeTail(manifest.archiveId, JSON.stringify(tail));
    }
    await writeManifest(manifest); // 最后一步：清单落盘成功前，新档都不会被启用
    // 至此新档完整可用，才允许删除旧档
    await removeLegacy();
    await gcStorage(storageActiveKeys(manifest)).catch(() => undefined);
    return {
      kind: "migrated",
      steps: legacy.events.length,
      chunks: chunks.length + (tail ? 1 : 0),
    };
  } catch (e) {
    // 压缩或写入失败：旧档保留，已写的半成品键等下次成功迁移后由 gc 清理
    return {
      kind: "failed",
      reason: e instanceof Error ? e.message : "迁移过程中发生未知错误",
    };
  }
}
