export { default as ReplayPanel } from "./ui/ReplayPanel.vue";
export { usePlayback } from "./model/playback";
export { useHistoryStore } from "./model/history";
export type { HistoryStore, HistoryNotice } from "./model/history";
export { downloadArchive } from "./lib/archive";
export { migrateLegacyArchive } from "./lib/migration";
export { diffBattle, patchBattle, rebuildFromCheckpoint } from "./lib/delta";
export type { BattleDelta, UnitPatch, TilePatch } from "./lib/delta";
