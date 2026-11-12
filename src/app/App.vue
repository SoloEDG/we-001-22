<script setup lang="ts">
import { onMounted } from "vue";
import { BattleMap, TerrainPanel } from "../features/terrain";
import { RosterPanel } from "../features/roster";
import { ActionPanel } from "../features/tactics";
import { TurnOrder } from "../features/initiative";
import { ReplayPanel, downloadArchive } from "../features/replay";
import { key } from "../shared/document";
import { useWorkspace } from "./workspace";

const {
  session,
  history,
  cursor,
  selected,
  skill,
  brush,
  notice,
  battle,
  actor,
  locked,
  routes,
  targets,
  path,
  playback,
  locating,
  locateTarget,
  saveState,
  cell,
  wait,
  seek,
  reset,
  bootstrap,
} = useWorkspace();

onMounted(() => {
  void bootstrap();
});

async function onDownload() {
  try {
    await downloadArchive(history);
  } catch (e) {
    notice.value = (e as Error).message;
  }
}
</script>

<template>
  <main>
    <header>
      <a class="brand" href="./"
        ><span class="brand-mark">⌘</span>
        <div>灰烬渡口<small>ASHEN CROSSING / TACTICS LAB</small></div></a
      >
      <nav>
        <span class="nav-active">战术指挥台</span><span>本地演练 / 07</span>
      </nav>
      <button @click="reset">↻ 重新部署</button>
    </header>
    <div class="mission">
      <div>
        <div class="eyebrow">OPERATION 001 / 北境战役</div>
        <h1>在河岸，决定下一步。</h1>
        <p>利用地形，掌握先机。每一次行动，都有迹可循。</p>
      </div>
      <div class="live-badge">
        <i />{{ cursor < 0 ? "实战指挥" : "历史回放 · 只读"
        }}<small>消灭敌方所有角色获胜</small>
      </div>
    </div>

    <div class="turn-host" :class="{ waiting: locating }">
      <TurnOrder :battle="battle" />
      <div v-if="locating" class="locate-overlay">
        <span class="spinner light" />
        定位等待 · 步骤 {{ locateTarget }} 的检查点与增量重建完成后，
        行动队列才会整体切换
      </div>
    </div>

    <div class="workspace">
      <aside>
        <div class="panel-host" :class="{ waiting: locating }">
          <RosterPanel
            :units="battle.units"
            :selected="selected"
            :active="battle.active"
            @select="selected = $event"
          />
          <div v-if="locating" class="locate-overlay compact">
            <span class="spinner light" />编队定位中…
          </div>
        </div>
        <TerrainPanel
          :brush="brush"
          :locked="locked"
          @paint="
            brush = $event;
            skill = '';
          "
        />
      </aside>
      <div class="center">
        <div class="map-host" :class="{ waiting: locating }">
          <BattleMap
            :battle="battle"
            :selected="selected"
            :routes="[...routes.keys()]"
            :targets="targets.map(key)"
            :path="path"
            @cell="cell"
          />
          <div v-if="locating" class="locate-overlay map-overlay">
            <span class="spinner light" />
            <div>
              <b>正在定位步骤 {{ locateTarget }}</b>
              <p>
                地图画面保持上一帧，直到对应检查点加载、动作增量全部重放成功后
                整体切换；快速拖动会自动取消更早的定位请求。
              </p>
            </div>
          </div>
        </div>
        <div class="field-note">
          <span>✦ 战场提示</span>
          <p>
            密林提供 3 点掩护；高地攻击 +2；迟缓减少 2
            点移动；灼烧在自身行动结束时结算。
          </p>
        </div>
      </div>
      <aside>
        <ActionPanel
          :unit="actor"
          :skill="skill"
          :locked="locked"
          :notice="notice"
          @skill="
            skill = $event;
            brush = null;
          "
          @wait="wait"
        />
        <ReplayPanel
          :events="session.events"
          :cursor="cursor"
          :playing="playback.playing.value"
          :locating="locating"
          :locate-target="locateTarget"
          :segments="history.segments.value"
          :corrupted="history.corruptedRanges.value"
          :step-state="history.stepState"
          :save-state="saveState"
          @seek="seek"
          @play="playback.play()"
          @stop="playback.stop"
          @download="onDownload"
          @live="history.backToLive()"
        />
      </aside>
    </div>
    <footer>
      <span>WE–001 / TURN-BASED TACTICS</span
      ><span
        >检查点 + 动作增量分块存储　·　异步按需读取　·　全部运算在本地完成</span
      ><span>苍蓝军 <b>VS</b> 余烬军</span>
    </footer>
  </main>
</template>
