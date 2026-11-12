import type { HistoryStore } from "../model/history";

function triggerDownload(filename: string, json: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 导出自包含分块档案：清单 + 全部检查点块（按需读取）+ 开放尾块。
 * 步骤编号沿用录制时的原始编号，下载记录与历史引用可直接对照。
 */
export async function downloadArchive(store: HistoryStore): Promise<void> {
  const { filename, json } = await store.exportArchive();
  triggerDownload(filename, json);
}
