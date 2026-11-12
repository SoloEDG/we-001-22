import { onUnmounted, ref } from "vue";

/**
 * 时间轴播放。
 *
 * 与旧实现的区别：step 为异步函数，当目标步骤所在块尚未加载时，
 * step 内部会等待检查点与增量重建完成才 resolve，定时器在此期间暂停推进，
 * 因此跨块播放会等待数据而不是跳过动作。
 */
export function usePlayback(step: (cursor: number) => Promise<void>) {
  const playing = ref(false);
  const waiting = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runId = 0;

  function stop() {
    runId++;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    playing.value = false;
    waiting.value = false;
  }

  async function play(start: number, end: number) {
    stop();
    const id = ++runId;
    let cursor = Math.max(0, start);
    playing.value = true;

    const tick = () => {
      if (id !== runId) return;
      timer = setTimeout(async () => {
        if (id !== runId) return;
        if (cursor > end) {
          stop();
          return;
        }
        const target = cursor;
        cursor++;
        waiting.value = true;
        try {
          await step(target);
        } finally {
          waiting.value = false;
        }
        if (id !== runId) return; // 等待期间被暂停或新定位取消
        tick();
      }, 750);
    };
    tick();
  }

  onUnmounted(stop);
  return { playing, waiting, play, stop };
}
