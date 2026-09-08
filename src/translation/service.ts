import { withTranslationRetry } from './retry';
import { TRANSLATION_PROMPT_VERSION } from './translation-prompt';
import { normalizeAiBaseUrl, type Settings } from '../settings';
import type { TranslationTaskPriority } from './translation-task-manager';
import { TranslationWorkerController } from './worker-controller';
import { CombinedVocabulary } from './combined-vocabulary';
import type { VocabularyWord } from '../vocabulary';
export { splitText } from './worker-controller';
import { cacheHit, measureRequest } from './metrics';
import type { TranslationContext } from './ai';
import { translate } from './provider';
import { translationBlockNeedsTranslation, translationTextFingerprint } from './translation-text';
interface CacheEntry { text: string; expires: number }
const CACHE_KEY = 'ft:translations:v1';
const TTL = 30 * 86400000;
// Bound by characters as well as entries, including unusually long translations.
export class TranslationCache {
  private values = new Map<string, CacheEntry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    const stored: unknown = GM_getValue(CACHE_KEY, []);
    if (Array.isArray(stored)) for (const item of stored) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      const entry = item[1] as Partial<CacheEntry> | null;
      if (entry && typeof entry.text === 'string' && typeof entry.expires === 'number' && entry.expires > Date.now()) this.values.set(item[0], { text: entry.text, expires: entry.expires });
    }
    this.trim();
  }
  get(key: string): string | undefined {
    const item = this.values.get(key);
    if (!item) return;
    if (item.expires <= Date.now()) { this.values.delete(key); return; }
    this.values.delete(key); this.values.set(key, item);
    cacheHit('translation');
    return item.text;
  }
  set(key: string, text: string): void {
    this.values.delete(key); this.values.set(key, { text, expires: Date.now() + TTL }); this.trim();
    this.timer ??= setTimeout(() => this.flush(), 600);
  }
  private trim(): void {
    let size = [...this.values.values()].reduce((sum, entry) => sum + entry.text.length, 0);
    for (const [key, entry] of this.values) {
      if (this.values.size <= 500 && size <= 500000) break;
      this.values.delete(key); size -= entry.text.length;
    }
  }
  clear(): void { this.values.clear(); this.flush(); }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    try { GM_setValue(CACHE_KEY, [...this.values]); } catch { /* cache quota must not break reading */ }
  }
}
export class TranslationService {
  private vocabulary: CombinedVocabulary;
  hasVocabulary(source: string): boolean { return this.vocabulary.hasPost(source); }
  watchVocabulary(source: string, callback: (words: VocabularyWord[]) => void): () => void { return this.vocabulary.watch(source, callback); }
  private aiInflight = new Map<string, { controller: AbortController; promise: Promise<string> }>();
  private foregroundOwner: string | undefined;
  setForeground(owner?: string): void { this.foregroundOwner = owner; this.worker.batcher.setForeground(owner ? this.pendingKeys.get(owner) ?? [] : []); }
  private partialListeners = new Map<string, Set<(text: string) => void>>();
  worker: TranslationWorkerController;
  get tasks(): TranslationWorkerController['tasks'] { return this.worker.tasks; }
  private priorities = new Map<string, TranslationTaskPriority>();
  private pendingKeys = new Map<string, Set<string>>();
  constructor(readonly settings: Settings, readonly cache: TranslationCache) {
    this.worker = new TranslationWorkerController(settings.ai);
    this.vocabulary = new CombinedVocabulary(JSON.stringify([TRANSLATION_PROMPT_VERSION, settings.ai.baseUrl, settings.ai.model, settings.ai.prompt]));
  }
  promote(owner: string, priority: 'visible' | 'interactive'): void {
    this.priorities.set(owner, priority);
    for (const key of this.pendingKeys.get(owner) ?? []) { this.tasks.promote(key, priority); this.worker.batcher.promote(key, priority); }
  }
  deprioritize(owner: string): void {
    this.priorities.set(owner, 'prefetch');
    for (const key of this.pendingKeys.get(owner) ?? []) {
      if ([...this.pendingKeys].some(([other, keys]) => other !== owner && keys.has(key) && this.priorities.get(other) !== 'prefetch')) continue;
      this.tasks.deprioritize(key); this.worker.batcher.deprioritize(key);
    }
  }
  release(owner: string): void { this.deprioritize(owner); this.worker.release(owner); this.priorities.delete(owner); this.pendingKeys.delete(owner); }
  status(owner: string): string {
    const states = [...(this.pendingKeys.get(owner) ?? [])].map(key => this.settings.provider === 'ai' ? this.worker.batcher.status(key) : this.tasks.status(key)).filter(Boolean);
    return [...new Set(states)].join('；') || '准备翻译';
  }
  async section(text: string, owner: string, priority: TranslationTaskPriority, signal: AbortSignal, onPartial?: (text: string) => void, context?: TranslationContext): Promise<string> {
    const values: string[] = [];
    for (const source of this.worker.preprocess(text, this.settings.provider === 'ai')) {
      signal.throwIfAborted();
      if (!translationBlockNeedsTranslation(source.replace(/⟦\d+⟧/g, ''), true)) { values.push(source); continue; }
      const ai = this.settings.provider === 'ai' ? this.settings.ai : undefined;
      const serviceKey = ai ? `ai:${normalizeAiBaseUrl(ai.baseUrl)}:${ai.model}` : this.settings.provider;
      const combinedSource = ai && this.settings.vocabulary ? context?.post ?? text : undefined;
      const identity = JSON.stringify([serviceKey, ai ? TRANSLATION_PROMPT_VERSION : '', ai?.prompt ?? '', ai ? context ?? null : null, !!combinedSource, 'zh-CN', source]);
      const resumePrefetch = ai && priority !== 'prefetch' ? this.tasks.holdPrefetch(signal) : undefined;
      let key: string;
      try { key = await translationTextFingerprint([identity], crypto.subtle); }
      finally { resumePrefetch?.(); }
      signal.throwIfAborted();
      const cached = this.cache.get(key);
      if (cached !== undefined && (!combinedSource || this.vocabulary.has(combinedSource, key))) { values.push(this.worker.format(source, cached)); continue; }
      let keys = this.pendingKeys.get(owner);
      if (!keys) { keys = new Set(); this.pendingKeys.set(owner, keys); }
      keys.add(key);
      if (this.foregroundOwner === owner) this.setForeground(owner);
      const listener = (partial: string): void => { if (!signal.aborted) onPartial?.(values.join('') + partial); };
      let listeners = this.partialListeners.get(key);
      if (!listeners) { listeners = new Set(); this.partialListeners.set(key, listeners); }
      listeners.add(listener);
      try {
        if (ai) {
          let inflight = this.aiInflight.get(key);
          if (!inflight) {
            const controller = new AbortController();
            const promise = this.worker.batcher.request(key, { text: source, group: owner, ...(context ? { context } : {}), ...(combinedSource ? { onVocabulary: (raw: unknown[], complete: boolean) => { if (!controller.signal.aborted) this.vocabulary.publish(combinedSource, key, raw, complete); } } : {}) }, this.priorities.get(owner) ?? priority, controller.signal,
              partial => { for (const callback of this.partialListeners.get(key) ?? []) callback(partial); })
              .then(value => { controller.signal.throwIfAborted(); const translated = this.worker.format(source, value); this.cache.set(key, translated); return translated; })
              .finally(() => { if (this.aiInflight.get(key)?.controller === controller) this.aiInflight.delete(key); });
            inflight = { controller, promise }; this.aiInflight.set(key, inflight);
          } else if (priority === 'visible' || priority === 'interactive') this.worker.batcher.promote(key, priority);
          const translated = await new Promise<string>((resolve, reject) => {
            const abort = (): void => reject(new DOMException('已取消', 'AbortError'));
            signal.addEventListener('abort', abort, { once: true });
            inflight.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            if (signal.aborted) abort();
          });
          signal.throwIfAborted(); values.push(translated); continue;
        }
        values.push(await withTranslationRetry(() => this.tasks.request({ key, serviceKey,
          priority: this.priorities.get(owner) ?? priority, signal,
          quota: { requestsPerMinute: 60, tokensPerMinute: 0 },
          estimatedTokens: Math.ceil((source.length + (context?.before.length ?? 0) + (context?.after.length ?? 0) + 400) * 1.5),
        }, async requestSignal => {
          const metric = measureRequest(this.settings.provider); let success = false;
          try {
            const translated = await translate(source, this.settings, requestSignal, partial => { metric.content(); for (const callback of this.partialListeners.get(key) ?? []) callback(partial); }, context);
            requestSignal.throwIfAborted(); this.cache.set(key, translated); success = true; return translated;
          } finally { metric.finish(success); }
        }), signal));
      } finally { keys.delete(key); listeners.delete(listener); if (!listeners.size && this.partialListeners.get(key) === listeners) this.partialListeners.delete(key); }
    }
    return this.worker.format(text, values.join(''));
  }
  destroy(): void { for (const entry of this.aiInflight.values()) entry.controller.abort(); this.aiInflight.clear(); this.worker.destroy(); this.partialListeners.clear(); this.vocabulary.clearListeners(); this.priorities.clear(); this.pendingKeys.clear(); this.foregroundOwner = undefined; this.cache.flush(); }
  resetPending(): void { this.destroy(); this.worker = new TranslationWorkerController(this.settings.ai); }
}
