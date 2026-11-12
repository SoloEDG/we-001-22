import { computed, reactive, ref } from "vue";
import type {
  ActionDelta,
  ArchiveChunk,
  ArchiveManifest,
  Battle,
  CorruptedRange,
  EventKind,
  EventMeta,
  OpenTail,
  Point,
  StepLoadState,
} from "../../../shared/types";
import { clone } from "../../../shared/document";
import {
  ChunkCorruptError,
  StorageWriteError,
  computeChunkChecksum,
  gcStorage,
  readChunk,
  readManifest,
  readTailRaw,
  storageActiveKeys,
  writeChunk,
  writeManifest,
  writeTail,
} from "../lib/storage";
import { rebuildFromCheckpoint } from "../lib/delta";
import { CHUNK_SIZE, migrateLegacyArchive } from "../lib/migration";
import { buildManifestBase, newArchiveId } from "../lib/manifest";
import { buildDelta, toMeta } from "./recording";
import { usePlayback } from "./playback";
import { newSession } from "../../../app/session";

const FRAME_CACHE_LIMIT = 3; // 已重建帧的小型 LRU
const CHUNK_CACHE_LIMIT = 2; // 按需加载的块缓存

export interface HistoryNotice {
  level: "info" | "warn" | "error";
  text: string;
}

export function createEmptyManifest(): ArchiveManifest {
  const fresh = newSession();
  return {
    ...buildManifestBase({
      archiveId: newArchiveId(),
      chunkSize: CHUNK_SIZE,
      initial: fresh.initial,
      live: fresh.live,
      events: [],
    }),
    chunks: [],
    tail: null,
    corruptedRanges: [],
  };
}

function emptyTail(manifest: ArchiveManifest): OpenTail {
  return {
    index: manifest.chunks.length,
    fromStep: 0,
    checkpoint: clone(manifest.initial),
    deltas: [],
  };
}

export function useHistoryStore() {
  const manifest = reactive<ArchiveManifest>(createEmptyManifest());
  const live = ref<Battle>(manifest.live);
  const cursor = ref(-1);
  const locating = ref(false);
  const locateTarget = ref<number | null>(null);
  const notice = ref<HistoryNotice>({ level: "info", text: "" });
  const saveState = ref<"idle" | "saving" | "error">("idle");

  /* ---------------- 内存缓存 ---------------- */

  const frameCache = new Map<number, Battle>();
  const chunkCache = new Map<string, ArchiveChunk>();
  const loadedChunkIds = ref<Set<string>>(new Set());
  let locateSeq = 0;

  function rememberFrame(step: number, battle: Battle) {
    frameCache.set(step, battle);
    if (frameCache.size > FRAME_CACHE_LIMIT) {
      const oldest = frameCache.keys().next().value;
      if (oldest !== undefined) frameCache.delete(oldest);
    }
  }

  function rememberChunk(id: string, chunk: ArchiveChunk) {
    chunkCache.set(id, chunk);
    if (!loadedChunkIds.value.has(id)) {
      const next = new Set(loadedChunkIds.value);
      next.add(id);
      loadedChunkIds.value = next;
    }
    if (chunkCache.size > CHUNK_CACHE_LIMIT) {
      const oldest = chunkCache.keys().next().value;
      if (oldest !== undefined && oldest !== id) {
        chunkCache.delete(oldest);
        // 缓存被挤出内存，但块仍属于“已装载过”，时间轴状态保持 loaded
      }
    }
  }

  /* ---------------- 派生状态 ---------------- */

  const length = computed(() => manifest.events.length);

  const corruptedRanges = computed<CorruptedRange[]>(() =>
    [...manifest.corruptedRanges].sort((a, b) => a.fromStep - b.fromStep),
  );

  function isCorruptStep(step: number): boolean {
    return manifest.corruptedRanges.some(
      (r) => step >= r.fromStep && step <= r.toStep,
    );
  }

  function stepState(step: number): StepLoadState {
    if (step === 0) return "loaded";
    if (isCorruptStep(step)) return "corrupt";
    if (manifest.tail && step > manifest.tail.fromStep) return "pending";
    const descriptor = manifest.chunks.find(
      (c) => step > c.fromStep && step <= c.toStep,
    );
    if (!descriptor) return "pending";
    if (descriptor.status === "corrupt") return "corrupt";
    return loadedChunkIds.value.has(descriptor.id) ? "loaded" : "unloaded";
  }

  const segments = computed(() => {
    const total = manifest.events.length;
    const list: {
      kind: StepLoadState;
      from: number;
      to: number;
      label: string;
    }[] = [];
    let i = 1;
    const push = (kind: StepLoadState, from: number, to: number) => {
      if (to < from) return;
      list.push({
        kind,
        from,
        to,
        label:
          kind === "corrupt"
            ? `损坏 ${from}–${to}`
            : kind === "pending"
              ? `待存档 ${from}–${to}`
              : `${from}–${to}`,
      });
    };
    for (const c of manifest.chunks) {
      const end = Math.min(c.toStep, total);
      const kind: StepLoadState =
        c.status === "corrupt"
          ? "corrupt"
          : loadedChunkIds.value.has(c.id)
            ? "loaded"
            : "unloaded";
      push(kind, c.fromStep + 1, end);
      i = end + 1;
    }
    if (manifest.tail?.deltas.length) {
      push(
        "pending",
        manifest.tail.fromStep + 1,
        manifest.tail.fromStep + manifest.tail.deltas.length,
      );
    }
    return list;
  });

  const displayed = computed(() => {
    if (cursor.value < 0) return live.value;
    return frameCache.get(cursor.value) ?? frameCache.get(0) ?? live.value;
  });

  const locked = computed(
    () => cursor.value >= 0 || locating.value || !!live.value.ended,
  );

  const currentMeta = computed<EventMeta | null>(() =>
    cursor.value > 0
      ? (manifest.events.find((e) => e.id === cursor.value) ?? null)
      : null,
  );

  const currentPath = computed<Point[]>(() =>
    currentMeta.value ? clone(currentMeta.value.path) : [],
  );

  /* ---------------- 块定位与重建 ---------------- */

  function tailAtStep(step: number): Battle | null {
    const tail = manifest.tail;
    if (!tail) return null;
    if (step <= tail.fromStep) return null;
    const count = step - tail.fromStep;
    if (count > tail.deltas.length) return null;
    return rebuildFromCheckpoint(tail.checkpoint, tail.deltas, count);
  }

  async function locate(step: number): Promise<boolean> {
    if (step < 0) {
      cursor.value = -1;
      return true;
    }
    if (step === 0) {
      locateSeq++;
      locating.value = false;
      locateTarget.value = null;
      frameCache.set(0, clone(manifest.initial));
      cursor.value = 0;
      return true;
    }
    if (step > manifest.events.length) return false;
    if (isCorruptStep(step)) {
      const range = manifest.corruptedRanges.find(
        (r) => step >= r.fromStep && step <= r.toStep,
      );
      notice.value = {
        level: "error",
        text: `步骤 ${step} 所在区间数据损坏（${range?.reason ?? "未知原因"}），仅标记受影响区间，可返回实战继续指挥`,
      };
      return false;
    }

    const seq = ++locateSeq;
    locating.value = true;
    locateTarget.value = step;
    const canceled = () => {
      if (seq !== locateSeq) {
        notice.value = {
          level: "info",
          text: "已切换到更新的定位请求，更早的历史读取已取消",
        };
        return true;
      }
      return false;
    };
    try {
      // 尾块（待存档）始终在内存，优先本地重建，让出一个微任务模拟异步按需读取
      const tailFrame = tailAtStep(step);
      if (tailFrame) {
        await Promise.resolve();
        if (canceled()) return false; // 快速连续拖动：旧定位被取消
        rememberFrame(step, tailFrame);
        cursor.value = step;
        return true;
      }

      const descriptor = manifest.chunks.find(
        (c) => step > c.fromStep && step <= c.toStep,
      );
      if (!descriptor) throw new ChunkCorruptError("找不到对应块", "unknown");

      let chunk = chunkCache.get(descriptor.id);
      if (!chunk) {
        if (descriptor.status === "corrupt") {
          throw new ChunkCorruptError("块已标记为损坏", descriptor.id);
        }
        chunk = await readChunk(descriptor.id, descriptor.checksum);
        if (canceled()) return false; // 读取期间用户已拖走，丢弃本次结果
        rememberChunk(descriptor.id, chunk);
      }

      const frame = rebuildFromCheckpoint(
        chunk.checkpoint,
        chunk.deltas,
        step - chunk.fromStep,
      );
      if (canceled()) return false;
      rememberFrame(step, frame);
      cursor.value = step;
      return true;
    } catch (e) {
      if (seq !== locateSeq) return false;
      if (e instanceof ChunkCorruptError) {        markCorrupt(descriptorOf(step), e.message);
      } else {
        notice.value = {
          level: "error",
          text: e instanceof Error ? e.message : "历史读取失败",
        };
      }
      return false;
    } finally {
      // 仅最新一次定位负责清理等待态；被取消的旧定位不得关闭新定位的遮罩
      if (seq === locateSeq) {
        locating.value = false;
        locateTarget.value = null;
      }
    }
  }

  function descriptorOf(step: number) {
    return manifest.chunks.find(
      (c) => step > c.fromStep && step <= c.toStep,
    );
  }

  function markCorrupt(
    descriptor: ArchiveManifest["chunks"][number] | undefined,
    reason: string,
  ) {
    if (!descriptor) return;
    descriptor.status = "corrupt";
    chunkCache.delete(descriptor.id);
    if (loadedChunkIds.value.has(descriptor.id)) {
      const next = new Set(loadedChunkIds.value);
      next.delete(descriptor.id);
      loadedChunkIds.value = next;
    }
    for (const k of [...frameCache.keys()]) {
      if (k > descriptor.fromStep && k <= descriptor.toStep) frameCache.delete(k);
    }
    const exists = manifest.corruptedRanges.some(
      (r) => r.fromStep === descriptor.fromStep + 1 && r.toStep === descriptor.toStep,
    );
    if (!exists) {
      manifest.corruptedRanges.push({
        fromStep: descriptor.fromStep + 1,
        toStep: descriptor.toStep,
        reason,
      });
    }
    notice.value = {
      level: "error",
      text: `检查点或增量重建失败，已标记受影响区间（步骤 ${descriptor.fromStep + 1}–${descriptor.toStep}）；其余历史与实战不受影响`,
    };
    // 损坏标记本身需要落盘，但失败不阻断使用
    persistManifestOnly().catch(() => undefined);
  }

  /* ---------------- 录制与分块落盘 ---------------- */

  function record(
    before: Battle,
    kind: EventKind,
    label: string,
    path: Point[] = [],
  ): ActionDelta {
    if (!manifest.tail) manifest.tail = emptyTail(manifest);
    const tail = manifest.tail;
    const id = manifest.events.length + 1; // 原始逻辑步骤编号，永不重排
    const delta = buildDelta(id, before, live.value, kind, before.active, label, path);
    tail.deltas.push(delta);
    manifest.events.push(toMeta(delta));
    return delta;
  }

  /**
   * 安全持久化：
   * - 尾块未满 → 只重写尾块 temp→正式，再更新清单；
   * - 尾块写满 → 定稿为不可变块（新键安全写入），再写尾块与清单。
   * 任何写入失败都抛 StorageWriteError，存储中的旧档保持原样，
   * 内存中的新动作也不回滚，下一次行动会重试整条尾块。
   */
  async function persist(): Promise<void> {
    if (!manifest.tail) return;
    saveState.value = "saving";
    try {
      const tail = manifest.tail;
      if (tail.deltas.length >= manifest.chunkSize) {
        const body = {
          index: tail.index,
          fromStep: tail.fromStep,
          toStep: tail.fromStep + tail.deltas.length,
          checkpoint: clone(tail.checkpoint),
          deltas: clone(tail.deltas),
        };
        const chunk: ArchiveChunk = {
          ...body,
          checksum: computeChunkChecksum(body),
        };
        const id = `${manifest.archiveId}-c${chunk.index}`;
        await writeChunk(id, chunk); // 不可变新键，失败时旧档完全不动
        manifest.chunks.push({
          id,
          index: chunk.index,
          fromStep: chunk.fromStep,
          toStep: chunk.toStep,
          status: "ok",
          checksum: chunk.checksum,
        });
        manifest.tail = {
          index: chunk.index + 1,
          fromStep: chunk.toStep,
          checkpoint: clone(live.value),
          deltas: [],
        };
      }
      await writeTail(manifest.archiveId, JSON.stringify(manifest.tail));
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(manifest);
      saveState.value = "idle";
    } catch (e) {
      saveState.value = "error";
      const reason =
        e instanceof StorageWriteError ? e.message : "档案写入失败，旧档已保留";
      notice.value = { level: "error", text: reason };
      throw e;
    }
  }

  async function persistManifestOnly(): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(manifest);
  }

  /* ---------------- 重新部署 / 返回实战 ---------------- */

  async function reset(): Promise<void> {
    locateSeq++;
    const fresh = newSession();
    const next: ArchiveManifest = {
      ...buildManifestBase({
        archiveId: newArchiveId(),
        chunkSize: manifest.chunkSize,
        initial: fresh.initial,
        live: fresh.live,
        events: [],
      }),
      chunks: [],
      tail: null,
      corruptedRanges: [],
    };
    // 新清单安全写入成功前，旧块一个都不删
    await writeManifest(next);
    Object.assign(manifest, next);
    live.value = manifest.live;
    cursor.value = -1;
    frameCache.clear();
    chunkCache.clear();
    loadedChunkIds.value = new Set();
    locating.value = false;
    locateTarget.value = null;
    await gcStorage(storageActiveKeys(manifest)).catch(() => undefined);
    saveState.value = "idle";
  }

  function backToLive() {
    locateSeq++;
    locating.value = false;
    locateTarget.value = null;
    cursor.value = -1;
  }

  /* ---------------- 启动：清单 + 尾块校验 + 旧档迁移 ---------------- */

  async function bootstrap(migrationNote?: (text: string) => void): Promise<void> {
    const m = await readManifest().catch((e) => {
      notice.value = {
        level: "error",
        text: `档案清单读取失败：${e instanceof Error ? e.message : "未知错误"}，已创建新战斗`,
      };
      return null;
    });

    if (m) {
      Object.assign(manifest, m);
      live.value = manifest.live;
      frameCache.set(0, clone(manifest.initial));

      // 尾块独立于块键，启动时回读校验，损坏只影响尾块区间
      if (manifest.tail) {
        try {
          const raw = await readTailRaw(manifest.archiveId);
          if (!raw) throw new Error("尾块数据缺失");
          const tail = JSON.parse(raw) as OpenTail;
          if (
            !tail.checkpoint ||
            !Array.isArray(tail.deltas) ||
            tail.fromStep !== manifest.tail.fromStep
          ) {
            throw new Error("尾块结构不完整");
          }
          const metaCount = manifest.events.filter(
            (e) => e.id > tail.fromStep,
          ).length;
          if (tail.deltas.length !== metaCount)
            throw new Error("尾块增量数量与清单不一致");
          // 空尾块（刚定稿后的开放块）只校验检查点；非空尾块要求能重建到 live
          if (tail.deltas.length) {
            const rebuilt = rebuildFromCheckpoint(
              tail.checkpoint,
              tail.deltas,
              tail.deltas.length,
            );
            if (JSON.stringify(rebuilt) !== JSON.stringify(manifest.live))
              throw new Error("尾块重建结果与实战不一致");
          }
          manifest.tail = tail;
        } catch (e) {
          const tail = manifest.tail;
          manifest.corruptedRanges.push({
            fromStep: tail.fromStep + 1,
            toStep: tail.fromStep + tail.deltas.length,
            reason: `尾块损坏：${e instanceof Error ? e.message : "未知错误"}`,
          });
          manifest.tail = {
            index: tail.index,
            fromStep: tail.fromStep,
            checkpoint: clone(tail.checkpoint),
            deltas: [],
          };
          await persistManifestOnly().catch(() => undefined);
        }
      }
    }

    // 旧完整快照档迁移
    const result = await migrateLegacyArchive();
    if (result.kind === "migrated") {
      const migrated = await readManifest();
      if (migrated) {
        Object.assign(manifest, migrated);
        live.value = manifest.live;
        frameCache.clear();
        chunkCache.clear();
        loadedChunkIds.value = new Set();
        frameCache.set(0, clone(manifest.initial));
        const text = `旧完整快照档已迁移为 ${result.chunks} 个检查点分块（共 ${result.steps} 步，编号保持不变）`;
        notice.value = { level: "info", text };
        migrationNote?.(text);
      }
    } else if (result.kind === "failed") {
      notice.value = {
        level: "warn",
        text: `分块压缩失败，旧完整快照档继续保留：${result.reason}`,
      };
      migrationNote?.(result.reason);
    }
  }

  /* ---------------- 导出：自包含 JSON，块全部按需读取 ---------------- */

  async function exportArchive(): Promise<{ filename: string; json: string }> {
    const loadedChunks: ArchiveChunk[] = [];
    for (const d of manifest.chunks) {
      if (d.status === "corrupt") {
        throw new Error(
          `块 ${d.id}（步骤 ${d.fromStep + 1}–${d.toStep}）已损坏，无法导出该区间，请先处理损坏数据`,
        );
      }
      const chunk = chunkCache.has(d.id)
        ? (chunkCache.get(d.id) as ArchiveChunk)
        : await readChunk(d.id, d.checksum);
      rememberChunk(d.id, chunk);
      loadedChunks.push(chunk);
    }
    const payload = {
      format: "we001-battle-archive/v2",
      exportedAt: new Date().toISOString(),
      manifest: {
        archiveId: manifest.archiveId,
        chunkSize: manifest.chunkSize,
        initial: manifest.initial,
        live: manifest.live,
        events: manifest.events,
        corruptedRanges: manifest.corruptedRanges,
      },
      chunks: loadedChunks,
      tail: manifest.tail,
    };
    return { filename: "灰烬渡口-战斗记录.json", json: JSON.stringify(payload, null, 2) };
  }

  /* ---------------- 播放 ---------------- */

  const playback = usePlayback(async (step) => {
    await locate(step);
  });

  return {
    // 状态
    manifest,
    live,
    cursor,
    locating,
    locateTarget,
    notice,
    saveState,
    playing: playback.playing,
    playbackWaiting: playback.waiting,
    // 派生
    length,
    segments,
    corruptedRanges,
    displayed,
    locked,
    currentMeta,
    currentPath,
    // 方法
    stepState,
    locate,
    record,
    persist,
    reset,
    backToLive,
    bootstrap,
    exportArchive,
    play: (start?: number) =>
      playback.play(start ?? Math.max(0, cursor.value), manifest.events.length),
    stop: playback.stop,
  };
}

export type HistoryStore = ReturnType<typeof useHistoryStore>;
