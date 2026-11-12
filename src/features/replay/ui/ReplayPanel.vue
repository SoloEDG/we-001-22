<script setup lang="ts">
import type { BattleEvent } from "../../../shared/types";
defineProps<{ events: BattleEvent[]; cursor: number; playing: boolean }>();
defineEmits<{ seek: [cursor: number]; play: []; stop: []; download: [] }>();
</script>
<template>
  <section class="panel replay-panel">
    <div class="eyebrow">04 / BATTLE ARCHIVE</div>
    <h3>
      战斗回放 <small>{{ events.length }} 步记录</small>
    </h3>
    <div class="replay-tools">
      <button @click="playing ? $emit('stop') : $emit('play')">
        {{ playing ? "Ⅱ 暂停" : "▶ 播放" }}</button
      ><button @click="$emit('seek', -1)">返回实战</button
      ><button @click="$emit('download')">导出记录 ↓</button>
    </div>
    <input
      aria-label="回放进度"
      type="range"
      min="0"
      :max="events.length"
      :value="cursor < 0 ? events.length : cursor"
      @input="$emit('seek', Number(($event.target as HTMLInputElement).value))"
    />
    <div class="event-list">
      <button :class="{ chosen: cursor === 0 }" @click="$emit('seek', 0)">
        <small>00</small>战斗开始</button
      ><button
        v-for="(e, i) in events"
        :key="e.id"
        :class="{ chosen: cursor === i + 1 }"
        @click="$emit('seek', i + 1)"
      >
        <small>{{ String(e.id).padStart(2, "0") }}</small
        >{{ e.label
        }}<span>{{
          e.kind === "move"
            ? "↗"
            : e.kind === "skill"
              ? "✧"
              : e.kind === "terrain"
                ? "△"
                : "→"
        }}</span>
      </button>
    </div>
  </section>
</template>
