import { ref, onUnmounted } from "vue";
export function usePlayback(
  length: () => number,
  seek: (cursor: number) => void,
) {
  const playing = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  function stop() {
    if (timer) clearInterval(timer);
    playing.value = false;
  }
  function play(start: number) {
    stop();
    let cursor = Math.max(0, start);
    seek(cursor);
    playing.value = true;
    timer = setInterval(() => {
      cursor++;
      if (cursor > length()) {
        stop();
        return;
      }
      seek(cursor);
    }, 750);
  }
  onUnmounted(stop);
  return { playing, play, stop };
}
