import assert from "node:assert/strict";
import { effectScope } from "vue";
import { usePlayback } from "../src/features/replay/model/playback";
import { wait } from "./storage-shim";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("\n[播放控制 usePlayback]");

  await test("从起点播放到终点，每一步都调用且不跳过", async () => {
    const scope = effectScope();
    const seen: number[] = [];
    const playback = scope.run(() =>
      usePlayback(async (step) => {
        seen.push(step);
      }),
    )!;
    playback.play(0, 4);
    // 首个 tick 也在 750ms 后执行，5 步 + 结束检测各一个定时周期
    await wait(4800);
    assert.equal(playback.playing.value, false, "播放结束自动停止");
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
    scope.stop();
  });

  await test("中途暂停立即停止推进，停止后可继续", async () => {
    const scope = effectScope();
    const seen: number[] = [];
    const playback = scope.run(() =>
      usePlayback(async (step) => {
        seen.push(step);
      }),
    )!;
    playback.play(0, 5);
    await wait(1600); // 约两步
    playback.stop();
    const snapshot = seen.length;
    await wait(1600);
    assert.equal(seen.length, snapshot, "暂停后不应再推进");
    assert.equal(playback.playing.value, false);
    scope.stop();
  });

  await test("步进为异步且含 IO 延迟时，等待完成才进入下一步（不跳动作）", async () => {
    const scope = effectScope();
    const seen: number[] = [];
    const order: string[] = [];
    const playback = scope.run(() =>
      usePlayback(async (step) => {
        order.push(`start-${step}`);
        await wait(300); // 模拟跨块读取检查点
        seen.push(step);
        order.push(`end-${step}`);
      }),
    )!;
    playback.play(0, 3);
    await wait(4600);
    assert.deepEqual(seen, [0, 1, 2, 3]);
    // 严格 start-k → end-k 成对出现，且下一步在上一步 end 之后才 start
    assert.deepEqual(order, [
      "start-0", "end-0",
      "start-1", "end-1",
      "start-2", "end-2",
      "start-3", "end-3",
    ]);
    assert.equal(playback.waiting.value, false);
    scope.stop();
  });

  await test("播放过程中新 play 会作废旧的播放循环", async () => {
    const scope = effectScope();
    const seen: number[] = [];
    const playback = scope.run(() =>
      usePlayback(async (step) => {
        seen.push(step);
      }),
    )!;
    playback.play(0, 8);
    await wait(900);
    playback.play(10, 11); // 重新从 10 播放
    await wait(2000);
    assert.deepEqual(seen.slice(-2), [10, 11], "旧循环作废，仅新循环生效");
    scope.stop();
  });

  console.log(
    `\n${process.exitCode ? "存在失败用例" : `全部通过 · ${passed} 个用例`}`,
  );
}

void main();
