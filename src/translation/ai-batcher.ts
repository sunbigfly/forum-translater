import { withTranslationRetry } from './retry';
import { normalizeAiBaseUrl, type AiProfile } from '../settings';
import { aiEntries, translateAiBatch, type AiSection } from './ai';
import { TranslationTaskManager, type TranslationTaskPriority } from './translation-task-manager';
interface Job extends AiSection {
  key: string; signal: AbortSignal; priority: TranslationTaskPriority;
  partial: (text: string) => void; resolve: (text: string) => void; reject: (error: unknown) => void;
  cleanup: () => void; cancelled: boolean; delivered: boolean; batch?: { key: string; controller: AbortController; jobs: Job[]; attempt: number };
}
const rank = { 'visible-batch': -1, interactive: 0, visible: 1, prefetch: 2 };
export class AiBatcher {
  private pending: Job[] = [];
  private active = new Set<Job>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private destroyed = false;
  private foregroundKeys = new Set<string>();
  private resumePrefetch: (() => void) | undefined;
  setForeground(keys: Iterable<string>): void {
    this.foregroundKeys = new Set(keys);
    this.tasks.setForeground([...this.foregroundKeys, ...[...this.active].filter(job => this.foregroundKeys.has(job.key) && job.batch).map(job => job.batch?.key ?? '')]);
  }
  constructor(private readonly ai: AiProfile, private readonly tasks: TranslationTaskManager) {}
  deprioritize(key: string): void {
    for (const job of this.active) if (job.key === key) {
      job.priority = 'prefetch';
      if (job.batch && job.batch.jobs.every(item => item.priority === 'prefetch' || item.cancelled || item.delivered)) this.tasks.deprioritize(job.batch.key);
    }
  }
  status(key: string): string | undefined {
    const job = [...this.active].find(item => item.key === key && !item.cancelled && !item.delivered);
    if (!job) return;
    if (!job.batch) return '等待合并请求';
    const state = this.tasks.status(job.batch.key) ?? '等待自动重试';
    return `${state} · 第 ${job.batch.attempt} 次请求`;
  }
  promote(key: string, priority: 'visible' | 'interactive'): void {
    const next = priority === 'visible' ? 'visible-batch' : priority;
    for (const job of this.active) if (job.key === key && rank[next] < rank[job.priority]) {
      job.priority = next;
      if (job.batch) this.tasks.promote(job.batch.key, next);
    }
  }
  request(key: string, section: AiSection, priority: TranslationTaskPriority, signal: AbortSignal, partial: (text: string) => void): Promise<string> {
    if (priority === 'visible') priority = 'visible-batch';
    return new Promise((resolve, reject) => {
      signal.throwIfAborted(); normalizeAiBaseUrl(this.ai.baseUrl); if (this.destroyed) { reject(new DOMException('已取消', 'AbortError')); return; }
      const job: Job = { ...section, key, priority, signal, partial, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort), cancelled: false, delivered: false };
      const abort = (): void => {
        job.cancelled = true; job.cleanup(); this.active.delete(job); reject(new DOMException('已取消', 'AbortError'));
        if (job.batch?.jobs.every(item => item.cancelled || item.delivered)) job.batch.controller.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      this.active.add(job); this.pending.push(job);
      this.resumePrefetch ??= this.tasks.holdPrefetch();
      this.timer ??= setTimeout(() => this.flush(), 25);
    });
  }
  private flush(): void {
    this.timer = undefined;
    // Task dispatch is microtask-based, so enqueue text before releasing background work.
    this.resumePrefetch?.(); this.resumePrefetch = undefined;
    this.pending = this.pending.filter(job => !job.cancelled);
    this.pending.sort((a, b) => Number(this.foregroundKeys.has(b.key)) - Number(this.foregroundKeys.has(a.key)) || rank[a.priority] - rank[b.priority]);
    while (this.pending.length) {
      const jobs: Job[] = [];
      const first = this.pending[0];
      const foregroundBatch = first !== undefined && this.foregroundKeys.has(first.key);
      const groups = new Map<string | undefined, Job[]>();
      for (const job of this.pending) if (job.priority === first?.priority && (!foregroundBatch || this.foregroundKeys.has(job.key))) {
        const group = groups.get(job.group) ?? []; group.push(job); groups.set(job.group, group);
      }
      const candidates = [...groups.values()].flatMap(group => group.sort((a, b) => (a.context?.index ?? 0) - (b.context?.index ?? 0)));
      for (const next of candidates) {
        if (jobs.length >= 16 || jobs.length && aiEntries([...jobs, next]).length > 24000) break;
        this.pending.splice(this.pending.indexOf(next), 1); jobs.push(next);
      }
      const batch = { key: `ai-batch:${++this.sequence}`, controller: new AbortController(), jobs, attempt: 0 };
      for (const job of jobs) job.batch = batch;
      const unique = [...new Map(jobs.map(job => [job.key, job])).values()];
      void withTranslationRetry(async () => {
        batch.attempt++;
        const remaining = unique.filter(item => jobs.some(job => job.key === item.key && !job.cancelled && !job.delivered));
        if (!remaining.length) return;
        const deliver = (index: number, text: string, complete: boolean, finished = false): void => {
          const key = remaining[index]?.key;
          for (const job of jobs) if (job.key === key && !job.cancelled && !job.delivered) {
            if (!complete || job.onVocabulary && !finished) job.partial(text);
            if (complete && (!job.onVocabulary || finished)) { job.delivered = true; job.resolve(text); }
          }
        };
        const characters = aiEntries(remaining).length;
        const priority = jobs.some(job => job.priority === 'visible' || job.priority === 'visible-batch') ? 'visible-batch' : jobs[0]?.priority ?? 'prefetch';
        const request = this.tasks.request({ key: batch.key, serviceKey: `ai:${normalizeAiBaseUrl(this.ai.baseUrl)}:${this.ai.model}`, priority, signal: batch.controller.signal, quota: this.ai, estimatedTokens: Math.ceil((characters + this.ai.prompt.length + 400) * 1.5) }, signal => translateAiBatch(remaining, this.ai, signal, deliver));
        this.setForeground(this.foregroundKeys);
        const values = await request;
        values.forEach((value, index) => deliver(index, value, true, true));
      }, batch.controller.signal).catch((error: unknown) => {
        for (const job of jobs) if (!job.cancelled && !job.delivered) job.reject(error);
      }).finally(() => { for (const job of jobs) { job.cleanup(); this.active.delete(job); } });
    }
  }
  destroy(): void {
    this.destroyed = true; clearTimeout(this.timer);
    this.resumePrefetch?.(); this.resumePrefetch = undefined;
    for (const job of this.active) { job.cancelled = true; job.cleanup(); job.reject(new DOMException('已取消', 'AbortError')); job.batch?.controller.abort(); }
    this.active.clear(); this.pending = [];
  }
}
