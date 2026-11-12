/**
 * localStorage 垫片：可注入读写延迟与配额/故障，用于验证安全写入语义。
 * 与应用代码隔离，仅测试环境使用。
 */
export class MemoryStorage {
  private map = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;
  delayMs = 0;
  failWritesTo: string[] = [];
  /** 记录正式键的删除/写入顺序，断言“不先删后写” */
  events: { type: "set" | "remove"; key: string; at: number }[] = [];
  private clock = 0;

  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string): string | null {
    const v = this.map.has(key) ? (this.map.get(key) as string) : null;
    if (!this.delayMs) return v;
    // 同步接口无法真正延迟；延迟只作用于应用层封装的异步 setItem 路径
    return v;
  }
  setItem(key: string, value: string) {
    if (this.failWritesTo.includes(key))
      throw new Error("注入的写入故障: " + key);
    const size = this.bytes() + value.length - (this.map.get(key)?.length ?? 0);
    if (size > this.quota) throw new Error("QuotaExceededError (注入)");
    this.events.push({ type: "set", key, at: this.clock++ });
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.events.push({ type: "remove", key, at: this.clock++ });
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  raw(key: string) {
    return this.map.get(key) ?? null;
  }
  keys() {
    return [...this.map.keys()];
  }
  bytes() {
    let n = 0;
    for (const v of this.map.values()) n += v.length;
    return n;
  }
  /** 异步版本：应用封装把 getItem/setItem 包成 Promise，这里用延迟调度模拟 IO */
  async setItemAsync(key: string, value: string, ms = this.delayMs) {
    await wait(ms);
    this.setItem(key, value);
  }
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function install(storage: MemoryStorage) {
  // 应用通过全局 localStorage 访问
  (globalThis as Record<string, unknown>).localStorage = storage;
}
