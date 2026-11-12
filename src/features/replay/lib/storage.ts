import type {
  ArchiveChunk,
  ArchiveManifest,
  Session,
} from "../../../shared/types";
import { assertBattle } from "../../../shared/document";
import { checksum } from "./checksum";

/**
 * 分块档案存储层。
 *
 * 安全写入约定（适用于清单与每一个块）：
 * 1. 先写入 `<key>:tmp` 临时键；
 * 2. 回读临时键并解析、校验完整性；
 * 3. 校验通过后才替换正式键，再清理临时键；
 * 4. 任一步失败都抛出异常，正式键上的原记录保持不动 ——
 *    绝不先删除原记录再开始写入。
 *
 * 所有接口均为异步，回放按需读取时不会阻塞主线程交互。
 */

const PREFIX = "we001-archive:v2:";
const MANIFEST_KEY = `${PREFIX}manifest`;
const LEGACY_KEY = "we001-session";

export const chunkKey = (id: string) => `${PREFIX}chunk:${id}`;
export const tailKey = (archiveId: string) => `${PREFIX}tail:${archiveId}`;

export class StorageWriteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageWriteError";
  }
}

export class ChunkCorruptError extends Error {
  constructor(
    message: string,
    readonly chunkId: string,
  ) {
    super(message);
    this.name = "ChunkCorruptError";
  }
}

function rawGet(key: string): Promise<string | null> {
  return ioGate("get", key).then(() => localStorage.getItem(key));
}

function rawSet(key: string, value: string): Promise<void> {
  return ioGate("set", key).then(() => localStorage.setItem(key, value));
}

function rawRemove(key: string): Promise<void> {
  return ioGate("remove", key).then(() => localStorage.removeItem(key));
}

/**
 * 测试钩子：可注入异步 IO 延迟/故障来模拟按需读取。
 * 生产环境不存在该全局量，仅多一次微任务跳转，行为不变。
 */
type IoHook = (op: "get" | "set" | "remove", key: string) => Promise<void>;
function ioGate(op: "get" | "set" | "remove", key: string): Promise<void> {
  const hook = (globalThis as { __WE001_IO_HOOK__?: IoHook }).__WE001_IO_HOOK__;
  return hook ? hook(op, key) : Promise.resolve();
}

/** temp 写入 → 回读校验 → 替换正式键，失败时正式键原样保留 */
async function safeWrite(key: string, json: string): Promise<void> {
  const tmp = `${key}:tmp`;
  try {
    await rawSet(tmp, json);
  } catch (e) {
    // 临时键都写不进（常见为配额不足），正式键完全未动
    throw new StorageWriteError("存储空间不足，旧档案已完整保留", e);
  }
  const readback = await rawGet(tmp);
  if (readback !== json) {
    await rawRemove(tmp).catch(() => undefined);
    throw new StorageWriteError("临时数据回读校验失败，已放弃写入");
  }
  try {
    await rawSet(key, json);
  } catch (e) {
    await rawRemove(tmp).catch(() => undefined);
    throw new StorageWriteError("正式档案替换失败，旧档案已完整保留", e);
  }
  const finalCheck = await rawGet(key);
  if (finalCheck !== json) {
    await rawRemove(tmp).catch(() => undefined);
    throw new StorageWriteError("正式档案回读不一致，本次写入未生效");
  }
  await rawRemove(tmp).catch(() => undefined);
}

export async function readManifest(): Promise<ArchiveManifest | null> {
  const raw = await rawGet(MANIFEST_KEY);
  if (!raw) return null;
  const manifest = JSON.parse(raw) as ArchiveManifest;
  if (manifest.version !== 2 || !Array.isArray(manifest.chunks))
    throw new Error("档案清单版本无法识别");
  assertBattle(manifest.initial);
  assertBattle(manifest.live);
  return manifest;
}

export async function writeManifest(m: ArchiveManifest): Promise<void> {
  await safeWrite(MANIFEST_KEY, JSON.stringify(m));
}

/** 计算块内容校验和（不含 checksum 字段本身） */
export function computeChunkChecksum(chunk: Omit<ArchiveChunk, "checksum">): string {
  return checksum(
    JSON.stringify({
      index: chunk.index,
      fromStep: chunk.fromStep,
      toStep: chunk.toStep,
      checkpoint: chunk.checkpoint,
      deltas: chunk.deltas,
    }),
  );
}

export async function writeChunk(id: string, chunk: ArchiveChunk): Promise<void> {
  await safeWrite(chunkKey(id), JSON.stringify(chunk));
}

/**
 * 按需读取一个块，缺失 / 解析失败 / 校验和不符都抛 ChunkCorruptError，
 * 由上层标记受影响区间而不是吞掉错误。
 */
export async function readChunk(
  id: string,
  expectedChecksum: string,
): Promise<ArchiveChunk> {
  const key = chunkKey(id);
  const raw = await rawGet(key);
  if (!raw) throw new ChunkCorruptError("块数据缺失", id);
  let chunk: ArchiveChunk;
  try {
    chunk = JSON.parse(raw) as ArchiveChunk;
  } catch {
    throw new ChunkCorruptError("块数据无法解析", id);
  }
  const actual = computeChunkChecksum(chunk);
  if (actual !== expectedChecksum || actual !== chunk.checksum) {
    throw new ChunkCorruptError("块校验和不匹配，数据可能已损坏", id);
  }
  assertBattle(chunk.checkpoint);
  return chunk;
}

export async function writeTail(archiveId: string, json: string): Promise<void> {
  await safeWrite(tailKey(archiveId), json);
}

export async function readTailRaw(archiveId: string): Promise<string | null> {
  return rawGet(tailKey(archiveId));
}

export async function readLegacy(): Promise<Session | null> {
  const raw = await rawGet(LEGACY_KEY);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  assertBattle(s.live);
  assertBattle(s.initial);
  if (!Array.isArray(s.events)) return null;
  return s;
}

export async function removeLegacy(): Promise<void> {
  await rawRemove(LEGACY_KEY);
}

/** 重新部署后清理不再被清单引用的本应用键（清单已成功替换之后才调用） */
export async function gcStorage(activeKeys: Set<string>): Promise<void> {
  const all: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith(PREFIX) || k === LEGACY_KEY)) all.push(k);
  }
  for (const k of all) {
    if (!activeKeys.has(k) && !k.endsWith(":tmp")) await rawRemove(k);
  }
}

export function storageActiveKeys(manifest: ArchiveManifest): Set<string> {
  const keys = new Set<string>([MANIFEST_KEY]);
  for (const c of manifest.chunks) keys.add(chunkKey(c.id));
  if (manifest.tail) keys.add(tailKey(manifest.archiveId));
  return keys;
}
