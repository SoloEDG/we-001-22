<script setup lang="ts">
import type { Terrain } from "../../../shared/types";
import { terrainRules } from "../lib/cost";
defineProps<{ brush: Terrain | null; locked: boolean }>();
defineEmits<{ paint: [terrain: Terrain | null] }>();
</script>
<template>
  <section class="panel terrain-panel">
    <div class="eyebrow">01 / FIELD CONDITIONS</div>
    <h3>地形图例 <small>选择后点击空地编辑</small></h3>
    <div class="terrain-list">
      <button
        v-for="(rule, id) in terrainRules"
        :key="id"
        :disabled="locked"
        :class="{ chosen: brush === id }"
        @click="$emit('paint', brush === id ? null : id)"
      >
        <b>{{ rule.glyph }}</b
        ><span>{{ rule.name }}</span
        ><small
          >移动 {{ Number.isFinite(rule.cost) ? rule.cost : "×" }} / 护甲 +{{
            rule.cover
          }}</small
        >
      </button>
    </div>
  </section>
</template>
