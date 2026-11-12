<script setup lang="ts">
import type { Unit } from "../../../shared/types";
import { professions } from "../model/professions";
import { statusNames } from "../lib/status";
defineProps<{ units: Unit[]; selected: string; active: string }>();
defineEmits<{ select: [id: string] }>();
</script>
<template>
  <section class="panel roster-panel">
    <div class="eyebrow">02 / COMBAT SQUAD</div>
    <h3>
      战场编队 <small>{{ units.filter((u) => u.hp > 0).length }} 名存活</small>
    </h3>
    <button
      v-for="u in units"
      :key="u.id"
      :data-unit="u.id"
      :class="[
        'unit-row',
        u.team,
        { chosen: u.id === selected, dead: u.hp <= 0 },
      ]"
      @click="$emit('select', u.id)"
    >
      <span class="avatar">{{ u.name.slice(0, 1) }}</span
      ><span class="unit-name"
        ><b>{{ u.name }} <i v-if="u.id === active">行动中</i></b
        ><small
          >{{ professions[u.job].name }} ·
          {{ u.team === "azure" ? "苍蓝" : "余烬" }}</small
        ><span class="hp-track"
          ><i :style="{ width: (u.hp / u.maxHp) * 100 + '%' }" /></span></span
      ><span class="hp-value"
        >{{ u.hp }}<small>/{{ u.maxHp }}</small
        ><small>{{
          u.statuses.map((s) => statusNames[s.kind] + s.turns).join(" ") ||
          "状态正常"
        }}</small></span
      >
    </button>
  </section>
</template>
