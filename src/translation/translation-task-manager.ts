import { measureRequest } from './metrics';
export type TranslationTaskPriority = "visible-batch" | "interactive" | "visible" | "prefetch";

export const TRANSLATION_MAX_CONCURRENT = 6;
const TRANSLATION_MAX_PREFETCH_CONCURRENT = TRANSLATION_MAX_CONCURRENT - 1;

export interface TranslationTaskQuota {
  readonly requestsPerMinute: number;
  readonly tokensPerMinute: number;
}

export interface TranslationTaskOptions {
  readonly key: string;
  readonly serviceKey: string;
  readonly priority: TranslationTaskPriority;
  readonly signal: AbortSignal;
  readonly quota?: TranslationTaskQuota;
  readonly estimatedTokens?: number;
}

interface QuotaRecord { readonly startedAt: number; readonly tokens: number }

interface TranslationQueueEntry<T> {
  readonly key: string;
  readonly serviceKey: string;
  readonly quota: TranslationTaskQuota | undefined;
  readonly estimatedTokens: number;
  readonly sequence: number;
  readonly queued: ReturnType<typeof measureRequest>;
  readonly controller: AbortController;
  readonly operation: (signal: AbortSignal) => Promise<T>;
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
  priority: TranslationTaskPriority;
  subscribers: number;
  started: boolean;
  settled: boolean;
  countedAsPrefetch: boolean;
}

const PRIORITY_ORDER: Readonly<Record<TranslationTaskPriority, number>> = {
  'visible-batch': -1,
  interactive: 0,
  visible: 1,
  prefetch: 2,
};

function errorReason(reason: unknown, message = "翻译任务失败"): Error {
  return reason instanceof Error ? reason : new Error(message);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("翻译任务已取消", "AbortError");
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

class TranslationQuotaGate {
  readonly #records = new Map<string, QuotaRecord[]>();
  constructor(
    readonly now: () => number = Date.now,
    readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void> = abortableDelay,
  ) {}

  tryAcquire(
    serviceKey: string,
    quota: TranslationTaskQuota | undefined,
    estimatedTokens: number,
    priority: TranslationTaskPriority,
  ): number {
    const rpm = Math.max(0, Math.floor(quota?.requestsPerMinute ?? 0));
    const tpm = Math.max(0, Math.floor(quota?.tokensPerMinute ?? 0));
    if (rpm === 0 && tpm === 0) return 0;
      const now = this.now();
      const records = (this.#records.get(serviceKey) ?? []).filter((record) => now - record.startedAt < 60_000);
      this.#records.set(serviceKey, records);
      const requestLimit = rpm === 0 ? Number.POSITIVE_INFINITY : priority === "prefetch" ? Math.max(1, rpm - 1) : rpm;
      const tokenLimit = tpm === 0 ? Number.POSITIVE_INFINITY : priority === "prefetch" ? Math.max(1, Math.floor(tpm * 0.8)) : tpm;
      const tokenCost = Math.max(1, Math.min(estimatedTokens, tokenLimit));
      const usedTokens = records.reduce((sum, record) => sum + record.tokens, 0);
      if (records.length < requestLimit && usedTokens + tokenCost <= tokenLimit) {
        records.push({ startedAt: now, tokens: tokenCost });
        return 0;
      }
      const next = records.length > 0 ? Math.min(...records.map((record) => record.startedAt + 60_000)) : now + 60_000;
      return Math.max(50, next - now + 1);
  }

  clear(): void { this.#records.clear(); }
}

/**
 * 页面级翻译队列。后台预翻译最多使用五个槽，始终为新进入视野的正文保留第六个槽；
 * 同一稳定 key 再次以 visible/interactive 请求时只晋级并订阅原任务，不重启网络请求。
 */
export class TranslationTaskManager {
  readonly #maxConcurrent: number;
  readonly #maxPrefetchConcurrent: number;
  readonly #maxVocabularyConcurrent: number;
  readonly #quota: TranslationQuotaGate;
  readonly #queue: Array<TranslationQueueEntry<unknown>> = [];
  readonly #entries = new Map<string, TranslationQueueEntry<unknown>>();
  #activeCount = 0;
  #activePrefetchCount = 0;
  #activeVocabularyCount = 0;
  #sequence = 0;
  #destroyed = false;
  #wake: AbortController | undefined;
  #preparing = 0;

  /** Reserve launch order while visible text is hashed/batched, never while awaiting AI. */
  holdPrefetch(signal?: AbortSignal): () => void {
    this.#preparing++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true; this.#preparing--;
      signal?.removeEventListener('abort', release);
      queueMicrotask(() => this.#drain());
    };
    signal?.addEventListener('abort', release, { once: true });
    if (signal?.aborted) release();
    return release;
  }

  constructor(options: {
    readonly maxConcurrent?: number;
    readonly maxPrefetchConcurrent?: number;
    readonly maxVocabularyConcurrent?: number;
    readonly now?: () => number;
    readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  } = {}) {
    this.#maxConcurrent = options.maxConcurrent ?? TRANSLATION_MAX_CONCURRENT;
    if (!Number.isSafeInteger(this.#maxConcurrent) || this.#maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a positive integer");
    }
    this.#maxPrefetchConcurrent = this.#maxConcurrent === 1
      ? 1
      : Math.max(1, Math.min(options.maxPrefetchConcurrent ?? TRANSLATION_MAX_PREFETCH_CONCURRENT, this.#maxConcurrent - 1));
    this.#maxVocabularyConcurrent = Math.max(1, Math.min(options.maxVocabularyConcurrent ?? this.#maxConcurrent, this.#maxConcurrent));
    this.#quota = new TranslationQuotaGate(options.now, options.delay);
  }

  request<T>(options: TranslationTaskOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#destroyed) return Promise.reject(new Error("翻译任务管理器已销毁"));
    const key = options.key.trim();
    if (!key || !options.serviceKey.trim()) return Promise.reject(new Error("翻译任务 key/serviceKey 不能为空"));
    if (options.signal.aborted) return Promise.reject(abortReason(options.signal));

    const existing = this.#entries.get(key) as TranslationQueueEntry<T> | undefined;
    if (existing && !existing.settled && !existing.controller.signal.aborted) {
      this.#promoteEntry(existing, options.priority);
      return this.#subscribe(existing, options.signal);
    }

    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry: TranslationQueueEntry<T> = {
      key,
      serviceKey: options.serviceKey.trim(),
      quota: options.quota,
      estimatedTokens: Math.max(1, options.estimatedTokens ?? 1),
      priority: options.priority,
      sequence: this.#sequence,
      queued: measureRequest('queue', { priority: options.priority, category: key.startsWith('vocabulary:') ? 'vocabulary' : 'translation' }),
      controller: new AbortController(),
      operation,
      promise,
      resolve,
      reject,
      subscribers: 0,
      started: false,
      settled: false,
      countedAsPrefetch: false,
    };
    this.#sequence += 1;
    this.#entries.set(key, entry as TranslationQueueEntry<unknown>);
    this.#queue.push(entry as TranslationQueueEntry<unknown>);
    this.#sortQueue();
    queueMicrotask(() => this.#drain());
    return this.#subscribe(entry, options.signal);
  }

  promote(key: string, priority: Exclude<TranslationTaskPriority, "prefetch"> = "visible"): boolean {
    const entry = this.#entries.get(key);
    if (!entry || entry.settled || entry.controller.signal.aborted) return false;
    this.#promoteEntry(entry, priority);
    return true;
  }

  snapshot(): { readonly active: number; readonly queued: number } {
    return Object.freeze({ active: this.#activeCount, queued: this.#queue.length });
  }
  private foregroundKeys = new Set<string>();
  setForeground(keys: Iterable<string>): void { this.foregroundKeys = new Set(keys); this.#sortQueue(); }
  deprioritize(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry || entry.started || entry.settled) return;
    entry.priority = 'prefetch'; this.#sortQueue();
    queueMicrotask(() => this.#drain());
  }

  status(key: string): string | undefined {
    const entry = this.#entries.get(key);
    if (!entry || entry.settled) return;
    return entry.started ? '等待接口响应' : '排队中（并发或额度限制）';
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#wake?.abort(); this.#wake = undefined;
    this.#quota.clear();
    for (const entry of [...this.#entries.values()]) this.#cancelEntry(entry, new Error("翻译任务管理器已销毁"));
  }

  #promoteEntry<T>(entry: TranslationQueueEntry<T>, priority: TranslationTaskPriority): void {
    if (PRIORITY_ORDER[priority] >= PRIORITY_ORDER[entry.priority]) return;
    if (entry.countedAsPrefetch) {
      entry.countedAsPrefetch = false;
      this.#activePrefetchCount = Math.max(0, this.#activePrefetchCount - 1);
    }
    entry.priority = priority;
    this.#sortQueue();
    queueMicrotask(() => this.#drain());
  }

  #subscribe<T>(entry: TranslationQueueEntry<T>, signal: AbortSignal): Promise<T> {
    entry.subscribers += 1;
    return new Promise<T>((resolve, reject) => {
      let active = true;
      const finish = (callback: () => void): void => {
        if (!active) return;
        active = false;
        signal.removeEventListener("abort", onAbort);
        entry.subscribers = Math.max(0, entry.subscribers - 1);
        callback();
      };
      const onAbort = (): void => {
        const reason = abortReason(signal);
        finish(() => reject(reason));
        if (entry.subscribers === 0 && !entry.settled) this.#cancelEntry(entry, reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(errorReason(error))),
      );
    });
  }

  #cancelEntry<T>(entry: TranslationQueueEntry<T>, reason: unknown): void {
    if (entry.settled) return;
    if (entry.started) {
      if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
      entry.controller.abort(reason);
      return;
    }
    const index = this.#queue.indexOf(entry as TranslationQueueEntry<unknown>);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#settle(entry, false, reason);
    queueMicrotask(() => this.#drain());
  }

  #sortQueue(): void {
    this.#queue.sort((left, right) => Number(this.foregroundKeys.has(right.key)) - Number(this.foregroundKeys.has(left.key)) || PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.sequence - right.sequence);
  }

  #drain(): void {
    this.#wake?.abort(); this.#wake = undefined;
    while (!this.#destroyed && this.#activeCount < this.#maxConcurrent) {
      this.#sortQueue();
      let wait = Infinity;
      const nextIndex = this.#queue.findIndex((entry) => {
        if (this.#preparing > 0 && entry.key.startsWith('vocabulary:')) return false;
        if (entry.priority === 'prefetch' && entry.key.startsWith('vocabulary:') && [...this.#entries.values()].some(active => active.started && !active.settled && active.countedAsPrefetch && active.key.startsWith('vocabulary:'))) return false;
        if (entry.key.startsWith('vocabulary:') && this.#activeVocabularyCount >= this.#maxVocabularyConcurrent) return false;
        if (entry.priority === "prefetch" && (this.#preparing > 0 || this.#activePrefetchCount >= this.#maxPrefetchConcurrent)) return false;
        const delay = this.#quota.tryAcquire(entry.serviceKey, entry.quota, entry.estimatedTokens, entry.priority);
        if (!delay) return true;
        wait = Math.min(wait, delay); return false;
      });
      if (nextIndex < 0) {
        if (Number.isFinite(wait)) {
          const wake = new AbortController(); this.#wake = wake;
          void this.#quota.delay(wait, wake.signal).then(() => { if (!wake.signal.aborted) this.#drain(); }, () => undefined);
        }
        break;
      }
      const entry = this.#queue.splice(nextIndex, 1)[0];
      if (!entry || entry.settled) continue;
      entry.started = true;
      entry.queued.finish(true);
      entry.countedAsPrefetch = entry.priority === "prefetch";
      this.#activeCount += 1;
      if (entry.countedAsPrefetch) this.#activePrefetchCount += 1;
      if (entry.key.startsWith('vocabulary:')) this.#activeVocabularyCount += 1;
      void this.#execute(entry);
    }
  }

  async #execute(entry: TranslationQueueEntry<unknown>): Promise<void> {
    const aborted = new Promise<never>((_resolve, reject) => {
      entry.controller.signal.addEventListener("abort", () => reject(abortReason(entry.controller.signal)), { once: true });
    });
    try {
      const operation = entry.operation(entry.controller.signal);
      const value = await Promise.race([operation, aborted]);
      this.#settle(entry, true, value);
    } catch (error) {
      this.#settle(entry, false, error);
    } finally {
      this.#activeCount = Math.max(0, this.#activeCount - 1);
      if (entry.countedAsPrefetch) this.#activePrefetchCount = Math.max(0, this.#activePrefetchCount - 1);
      if (entry.key.startsWith('vocabulary:')) this.#activeVocabularyCount = Math.max(0, this.#activeVocabularyCount - 1);
      entry.countedAsPrefetch = false;
      this.#drain();
    }
  }

  #settle<T>(entry: TranslationQueueEntry<T>, success: boolean, value: unknown): void {
    if (entry.settled) return;
    entry.settled = true;
    if (!entry.started) entry.queued.finish(false);
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
    if (success) entry.resolve(value as T);
    else entry.reject(errorReason(value));
  }
}
