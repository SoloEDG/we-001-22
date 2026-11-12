<script setup lang="ts">
import { computed } from "vue";
import type {
  CorruptedRange,
  EventMeta,
  StepLoadState,
} from "../../../shared/types";

const props = defineProps<{
  events: EventMeta[];
  cursor: number;
  playing: boolean;
  locating: boolean;
  locateTarget: number | null;
  segments: { kind: StepLoadState; from: number; to: number; label: string }[];
  corrupted: CorruptedRange[];
  stepState: (step: number) => StepLoadState;
  saveState: "idle" | "saving" | "error";
}>();

defineEmits<{
  seek: [cursor: number];
  play: [];
  stop: [];
  download: [];
  live: [];
}>();

const effectiveCursor = computed(() =>
  props.cursor < 0 ? props.events.length : props.cursor,
);

const kindIcon: Record<EventMeta["kind"], string> = {
  move: "↗",
  skill: "✧",
  wait: "→",
  terrain: "△",
};

const stateHint: Record<StepLoadState, string> = {
  loaded: "已加载",
  unloaded: "未加载 · 拖动时按需读取",
  corrupt: "损坏区间",
  pending: "当前尾块 · 待定稿",
};
</script>

<template>
  <section class="panel replay-panel">
    <div class="eyebrow">04 / BATTLE ARCHIVE</div>
    <h3>
      战斗回放 <small>{{ events.length }} 步记录 · 检查点分块</small>
    </h3>
    <div class="replay-tools">
      <button
        :disabled="locating || events.length === 0"
        @click="playing ? $emit('stop') : $emit('play')"
      >
        {{ playing ? "Ⅱ 暂停" : "▶ 播放" }}
      </button>
      <button :disabled="locating" @click="$emit('live')">返回实战</button>
      <button :disabled="locating" @click="$emit('download')">导出记录 ↓</button>
    </div>

    <div class="save-state" :data-state="saveState">
      <i />
      {{
        saveState === "saving"
          ? "正在写入分块档案…"
          : saveState === "error"
            ? "写入失败，旧档保留，将随下一步重试"
            : "档案已同步 · 步骤编号保持原始顺序"
      }}
    </div>

    <input
      aria-label="回放进度"
      type="range"
      min="0"
      :max="events.length"
      :value="effectiveCursor"
      @input="$emit('seek', Number(($event.target as HTMLInputElement).value))"
    />

    <div v-if="segments.length" class="segment-bar" aria-label="分块装载状态">
      <span
        v-for="(s, i) in segments"
        :key="i"
        class="segment"
        :class="s.kind"
        :title="`${stateHint[s.kind]} · 步骤 ${s.label}`"
        :style="{ flex: s.to - s.from + 1 }"
      />
    </div>

    <div v-if="locating" class="locating-banner" role="status">
      <span class="spinner" />
      正在定位步骤 {{ locateTarget }}：读取检查点并重放动作增量，
      地图、编队与行动队列将在重建成功后整体切换…
    </div>

    <div v-if="corrupted.length" class="corrupt-banner">
      损坏区间：
      <template v-for="(r, i) in corrupted" :key="i">
        <b>步骤 {{ r.fromStep }}–{{ r.toStep }}</b
        ><span v-if="i < corrupted.length - 1">、</span>
      </template>
      ；其余历史可正常回放，实战指挥不受影响。
    </div>

    <div class="event-list">
      <button :class="{ chosen: cursor === 0 }" @click="$emit('seek', 0)">
        <small>00</small>战斗开始<span class="state-tag loaded">初始</span>
      </button>
      <button
        v-for="e in events"
        :key="e.id"
        :class="['event-row', stepState(e.id), { chosen: cursor === e.id }]"
        @click="$emit('seek', e.id)"
      >
        <small>{{ String(e.id).padStart(2, "0") }}</small>
        <span class="event-label">{{ e.label }}</span>
        <span class="event-side">
          <em v-if="stepState(e.id) === 'unloaded'">未加载</em>
          <em v-else-if="stepState(e.id) === 'corrupt'" class="bad">损坏</em>
          <em v-else-if="stepState(e.id) === 'pending'" class="pending">尾块</em>
          <i>{{ kindIcon[e.kind] }}</i>
        </span>
      </button>
    </div>
  </section>
</template>
