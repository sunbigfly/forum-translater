import { describe, expect, it, vi } from "vitest";
import { TranslationTaskManager } from "../src/translation/translation-task-manager";

describe("TranslationTaskManager", () => {
  it('releases background preparation holds on abort and tolerates repeated cleanup', async () => {
    const manager = new TranslationTaskManager();
    const preparing = new AbortController(); const release = manager.holdPrefetch(preparing.signal);
    const run = vi.fn().mockResolvedValue('words');
    const words = manager.request({ key: 'words', serviceKey: 'ai', priority: 'prefetch', signal: new AbortController().signal }, run);
    await Promise.resolve(); expect(run).not.toHaveBeenCalled();
    preparing.abort(); release();
    await expect(words).resolves.toBe('words'); expect(run).toHaveBeenCalledOnce(); manager.destroy();
  });
  it('runs the first visible post before other queued visible work', async () => {
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const order: string[] = []; let complete: (() => void) | undefined;
    const options = { serviceKey: 'ai', priority: 'visible-batch' as const, signal: new AbortController().signal };
    const active = manager.request({ ...options, key: 'active' }, () => new Promise<void>(resolve => { complete = resolve; }));
    await Promise.resolve();
    const other = manager.request({ ...options, key: 'other' }, () => { order.push('other'); return Promise.resolve(); });
    const first = manager.request({ ...options, key: 'first' }, () => { order.push('first'); return Promise.resolve(); });
    manager.setForeground(['first']); complete?.();
    await Promise.all([active, other, first]); expect(order).toEqual(['first', 'other']); manager.destroy();
  });
  it('moves offscreen queued work behind visible work without interrupting the active request', async () => {
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const order: string[] = []; let complete: (() => void) | undefined; let activeSignal: AbortSignal | undefined;
    const options = { serviceKey: 'ai', priority: 'visible-batch' as const, signal: new AbortController().signal };
    const active = manager.request({ ...options, key: 'active' }, signal => { activeSignal = signal; order.push('active'); return new Promise<void>(resolve => { complete = resolve; }); });
    await Promise.resolve();
    const old = manager.request({ ...options, key: 'old' }, () => { order.push('old'); return Promise.resolve(); });
    const visible = manager.request({ ...options, key: 'visible' }, () => { order.push('visible'); return Promise.resolve(); });
    manager.deprioritize('old'); manager.deprioritize('active');
    expect(activeSignal?.aborted).toBe(false); complete?.();
    await Promise.all([active, old, visible]);
    expect(order).toEqual(['active', 'visible', 'old']); manager.destroy();
  });
  it('keeps quota waiters queued and lets another service use the worker', async () => {
    vi.useFakeTimers();
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const controller = new AbortController();
    const options = { serviceKey: 'limited', priority: 'visible' as const, signal: controller.signal, quota: { requestsPerMinute: 1, tokensPerMinute: 0 } };
    try {
      await manager.request({ ...options, key: 'first' }, () => Promise.resolve('first'));
      const waiting = manager.request({ ...options, key: 'waiting' }, () => Promise.resolve('waiting'));
      const cancelled = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      await Promise.resolve();
      expect(manager.snapshot()).toEqual({ active: 0, queued: 1 });
      await expect(manager.request({ key: 'other', serviceKey: 'other', priority: 'visible-batch', signal: new AbortController().signal }, () => Promise.resolve('other'))).resolves.toBe('other');
      controller.abort(); await cancelled;
    } finally { manager.destroy(); vi.useRealTimers(); }
  });
  it('promotes a quota-blocked prefetch immediately into reserved foreground capacity', async () => {
    vi.useFakeTimers();
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const options = { serviceKey: 'limited', priority: 'prefetch' as const, signal: new AbortController().signal, quota: { requestsPerMinute: 2, tokensPerMinute: 0 } };
    try {
      await manager.request({ ...options, key: 'first' }, () => Promise.resolve('first'));
      const waiting = manager.request({ ...options, key: 'waiting' }, () => Promise.resolve('promoted'));
      await Promise.resolve(); expect(manager.snapshot().queued).toBe(1);
      manager.promote('waiting', 'visible-batch');
      await expect(waiting).resolves.toBe('promoted');
    } finally { manager.destroy(); vi.useRealTimers(); }
  });
  it("bounds translation work at the configured six concurrent operations", async () => {
    const manager = new TranslationTaskManager();
    let active = 0;
    let maximum = 0;
    const jobs = Array.from({ length: 12 }, (_, index) => manager.request({
      key: `job:${index}`,
      serviceKey: "public",
      priority: "visible",
      signal: new AbortController().signal,
    }, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    }));
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(maximum).toBe(6);
    manager.destroy();
  });

  it("starts a newly visible Reader task before queued host prefetch", async () => {
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const order: string[] = [];
    let releaseActive: (() => void) | undefined;
    const request = (key: string, priority: "visible" | "prefetch", wait = false) => manager.request({
      key,
      serviceKey: "ai:test",
      priority,
      signal: new AbortController().signal,
    }, async () => {
      order.push(key);
      if (wait) await new Promise<void>((resolve) => { releaseActive = resolve; });
      return key;
    });
    const active = request("host-active", "prefetch", true);
    await vi.waitFor(() => expect(releaseActive).toBeTypeOf("function"));
    const queuedHost = request("host-queued", "prefetch");
    const visible = request("reader-visible", "visible");

    releaseActive?.();
    await expect(Promise.all([active, queuedHost, visible])).resolves.toEqual([
      "host-active",
      "host-queued",
      "reader-visible",
    ]);
    expect(order).toEqual(["host-active", "reader-visible", "host-queued"]);
    manager.destroy();
  });

  it("reserves the sixth worker for visible text while five prefetch requests are active", async () => {
    const manager = new TranslationTaskManager({ maxConcurrent: 6 });
    const releases: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    const prefetch = Array.from({ length: 6 }, (_, index) => manager.request({
      key: `prefetch:${index}`,
      serviceKey: "ai:test",
      priority: "prefetch",
      signal: new AbortController().signal,
    }, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    }));

    await vi.waitFor(() => expect(releases).toHaveLength(5));
    const visible = manager.request({
      key: "visible:urgent",
      serviceKey: "ai:test",
      priority: "visible",
      signal: new AbortController().signal,
    }, () => {
      active += 1;
      maximum = Math.max(maximum, active);
      active -= 1;
      return Promise.resolve("visible");
    });

    await expect(visible).resolves.toBe("visible");
    expect(maximum).toBe(6);
    expect(releases).toHaveLength(5);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(prefetch)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    manager.destroy();
  });

  it("promotes and reuses the same queued prefetch task when it becomes visible", async () => {
    const manager = new TranslationTaskManager({ maxConcurrent: 1 });
    const order: string[] = [];
    let releaseBlocker: (() => void) | undefined;
    const blocker = manager.request({
      key: "blocker",
      serviceKey: "ai:test",
      priority: "interactive",
      signal: new AbortController().signal,
    }, async () => {
      await new Promise<void>((resolve) => { releaseBlocker = resolve; });
      return "blocker";
    });
    await vi.waitFor(() => expect(releaseBlocker).toBeTypeOf("function"));
    const other = manager.request({
      key: "other-prefetch",
      serviceKey: "ai:test",
      priority: "prefetch",
      signal: new AbortController().signal,
    }, () => {
      order.push("other");
      return Promise.resolve("other");
    });
    const operation = vi.fn(() => {
      order.push("promoted");
      return Promise.resolve("shared");
    });
    const prefetch = manager.request({
      key: "shared-task",
      serviceKey: "ai:test",
      priority: "prefetch",
      signal: new AbortController().signal,
    }, operation);
    const visible = manager.request({
      key: "shared-task",
      serviceKey: "ai:test",
      priority: "visible",
      signal: new AbortController().signal,
    }, operation);

    releaseBlocker?.();
    await expect(Promise.all([blocker, other, prefetch, visible])).resolves.toEqual([
      "blocker", "other", "shared", "shared",
    ]);
    expect(order).toEqual(["promoted", "other"]);
    expect(operation).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("keeps low-quota prefetch runnable when RPM is one", async () => {
    const manager = new TranslationTaskManager();
    const result = await manager.request({
      key: "prefetch:one-rpm",
      serviceKey: "ai:test",
      priority: "prefetch",
      signal: new AbortController().signal,
      quota: { requestsPerMinute: 1, tokensPerMinute: 1 },
      estimatedTokens: 1,
    }, () => Promise.resolve("translated"));

    expect(result).toBe("translated");
    manager.destroy();
  });

  it.each([
    ["RPM", { requestsPerMinute: 1, tokensPerMinute: 0 }, 1],
    ["TPM", { requestsPerMinute: 0, tokensPerMinute: 10 }, 6],
  ] as const)("delays the next same-service request when the %s window is exhausted", async (_label, quota, estimatedTokens) => {
    let now = 0;
    const waits: number[] = [];
    const manager = new TranslationTaskManager({
      now: () => now,
      delay: (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });
    const request = (key: string) => manager.request({
      key,
      serviceKey: "ai:test:model",
      priority: "visible" as const,
      signal: new AbortController().signal,
      quota,
      estimatedTokens,
    }, () => Promise.resolve(key));

    await expect(request("first")).resolves.toBe("first");
    await expect(request("second")).resolves.toBe("second");
    expect(waits[0]).toBeGreaterThanOrEqual(60_000);
    manager.destroy();
  });
});
