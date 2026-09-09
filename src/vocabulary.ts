import { normalizeAiBaseUrl, validateAiProfile, type Settings } from './settings';
import { completedVocabularyEntries, requestVocabularyText } from './vocabulary-stream';
import { VOCABULARY_PROMPT, VOCABULARY_PROMPT_VERSION } from './vocabulary-prompt';
import { cacheHit, measureRequest } from './translation/metrics';
import { withTranslationRetry } from './translation/retry';
import { translationTextFingerprint } from './translation/translation-text';
import type { TranslationTaskManager, TranslationTaskPriority } from './translation/translation-task-manager';

export interface VocabularyWord { word: string; ipa: string; meaning: string; example: string; level: 'CET4' | 'CET6' | 'CET6+'; exampleMeaning?: string; memoryExample?: string; memoryMeaning?: string; memoryTerm?: string; translatedTerm?: string }
export interface SavedWord extends VocabularyWord { sourceUrl: string; addedAt: number; due: number; stage: number }
const BOOK = 'ft:wordbook:v1';
const CACHE = 'ft:vocabulary:v1';
function words(value: unknown): VocabularyWord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is VocabularyWord => {
    if (!item || typeof item !== 'object') return false;
    const word = item as Partial<VocabularyWord>;
    return typeof word.word === 'string' && /^[a-z]+(?:[-'][a-z]+)*$/i.test(word.word) && word.word.length <= 40
      && typeof word.ipa === 'string' && word.ipa.length <= 100 && typeof word.meaning === 'string' && word.meaning.length <= 200
      && typeof word.example === 'string' && word.example.length <= 500 && (word.level === 'CET4' || word.level === 'CET6' || word.level === 'CET6+')
      && (word.exampleMeaning === undefined || typeof word.exampleMeaning === 'string' && word.exampleMeaning.length <= 2000)
      && (word.memoryExample === undefined || typeof word.memoryExample === 'string' && word.memoryExample.length <= 240)
      && (word.memoryTerm === undefined || typeof word.memoryTerm === 'string' && word.memoryTerm.length <= 30)
      && (word.translatedTerm === undefined || typeof word.translatedTerm === 'string' && word.translatedTerm.length <= 30)
      && (word.memoryMeaning === undefined || typeof word.memoryMeaning === 'string' && word.memoryMeaning.length <= 200);
  });
}
export function readWordbook(): SavedWord[] {
  const stored: unknown = GM_getValue(BOOK, []);
  return words(stored).flatMap(word => {
    const item = word as Partial<SavedWord>;
    return typeof item.sourceUrl === 'string' && typeof item.addedAt === 'number' && typeof item.due === 'number' && typeof item.stage === 'number'
      ? [{ ...word, sourceUrl: item.sourceUrl, addedAt: item.addedAt, due: item.due, stage: item.stage }] : [];
  });
}
export function saveWord(word: VocabularyWord, sourceUrl: string): void {
  const book = readWordbook();
  if (book.some(item => item.word.toLowerCase() === word.word.toLowerCase())) return;
  if (book.length >= 1000) throw new Error('单词本已满（1000 词），请先移除不需要的词。');
  const url = new URL(sourceUrl); url.search = ''; url.hash = '';
  book.push({ ...word, word: word.word.toLowerCase(), sourceUrl: url.href, addedAt: Date.now(), due: Date.now(), stage: 0 });
  GM_setValue(BOOK, book);
}
export function removeWord(word: string): void { GM_setValue(BOOK, readWordbook().filter(item => item.word !== word)); }
export function reviewWord(word: string, remembered: boolean): void {
  GM_setValue(BOOK, readWordbook().map(item => {
    if (item.word !== word) return item;
    const days = [1, 3, 7, 14, 30];
    const stage = remembered ? Math.min(item.stage + 1, days.length) : 0;
    return { ...item, stage, due: Date.now() + (remembered ? days[stage - 1] ?? 30 : 1) * 86400000 };
  }));
}
let activeSpeech: { button?: HTMLElement; clear: () => void } | undefined;
export function stopWordSpeech(root?: Node): void {
  if (!activeSpeech || root && (!activeSpeech.button || !root.contains(activeSpeech.button))) return;
  activeSpeech.clear(); activeSpeech = undefined;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
export function speakWord(word: string, status: HTMLElement, button?: HTMLElement): void {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { status.textContent = '此浏览器不支持语音朗读。'; return; }
  if (button && activeSpeech?.button === button) { stopWordSpeech(); return; }
  stopWordSpeech();
  const utterance = new SpeechSynthesisUtterance(word); utterance.lang = 'en-US'; utterance.rate = 0.85;
  const voice = speechSynthesis.getVoices().find(item => item.lang === 'en-US') ?? speechSynthesis.getVoices().find(item => item.lang.startsWith('en'));
  if (voice) utterance.voice = voice;
  const clear = (): void => { button?.classList.remove('is-speaking'); button?.setAttribute('aria-pressed', 'false'); button?.setAttribute('aria-label', `朗读 ${word}`); if (button) button.title = `朗读 ${word}`; };
  const active = { ...(button ? { button } : {}), clear }; activeSpeech = active;
  button?.classList.add('is-speaking'); button?.setAttribute('aria-pressed', 'true'); button?.setAttribute('aria-label', `停止朗读 ${word}`); if (button) button.title = '停止朗读';
  const finish = (): void => { if (activeSpeech === active) { clear(); activeSpeech = undefined; } };
  utterance.onend = finish;
  utterance.onerror = () => { if (activeSpeech === active) { finish(); status.textContent = '朗读失败，请检查系统英语语音。'; } };
  try { speechSynthesis.speak(utterance); } catch { finish(); status.textContent = '朗读失败，请检查系统英语语音。'; }
}
export async function collectVocabulary(source: string, settings: Settings, tasks: TranslationTaskManager, signal: AbortSignal, translation = '', onPartial?: (words: VocabularyWord[]) => void, scheduling?: { priority(): TranslationTaskPriority; queued(key: string): void }): Promise<VocabularyWord[]> {
  validateAiProfile(settings.ai);
  const text = source.slice(0, 18000);
  const key = await translationTextFingerprint([VOCABULARY_PROMPT_VERSION, settings.ai.baseUrl, settings.ai.model, text, translation], crypto.subtle);
  signal.throwIfAborted();
  const cached: unknown = GM_getValue(CACHE, []);
  const cache = Array.isArray(cached) ? cached as unknown[] : [];
  const hit = cache.find(item => Array.isArray(item) && item[0] === key);
  if (Array.isArray(hit)) {
    const result = words(hit[1]);
    // Empty model selections are transient; legacy empty entries have no expiry.
    if (result.length || typeof hit[2] === 'number' && hit[2] > Date.now()) { cacheHit('vocabulary'); return result; }
  }
  scheduling?.queued(`vocabulary:${key}`);
  const result = await withTranslationRetry(() => tasks.request({ key: `vocabulary:${key}`, serviceKey: `ai:${normalizeAiBaseUrl(settings.ai.baseUrl)}:${settings.ai.model}`, priority: scheduling?.priority() ?? 'prefetch', signal, quota: settings.ai, estimatedTokens: Math.ceil((text.length + translation.slice(0, 18000).length + VOCABULARY_PROMPT.length) * 1.5) }, async requestSignal => {
    const response = await requestVocabularyText(`${normalizeAiBaseUrl(settings.ai.baseUrl)}/responses`, requestSignal, {
      model: settings.ai.model, store: false, stream: true, reasoning: { effort: settings.ai.reasoningEffort ?? 'low' }, ...(settings.ai.fastMode ? { service_tier: 'priority' } : {}), max_output_tokens: 2400, prompt_cache_key: `forum-translater:${VOCABULARY_PROMPT_VERSION}`,
      input: [
        { role: 'system', content: VOCABULARY_PROMPT },
        { role: 'user', content: JSON.stringify({ original: text, translation: translation.slice(0, 18000) }) },
      ],
    }, settings.ai.apiKey, partial => { if (!signal.aborted) onPartial?.(normalize(completedVocabularyEntries(partial))); });
    const decoded: unknown = JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!Array.isArray(decoded)) throw new Error('词汇响应格式错误');
    const normalized = normalize(decoded);
    measureRequest('vocabulary-result', { received: decoded.length, accepted: normalized.length }).finish(true);
    return normalized;
  }), signal);
  signal.throwIfAborted();
  const latest: unknown = GM_getValue(CACHE, []);
  const entries: unknown[] = Array.isArray(latest) ? latest as unknown[] : [];
  GM_setValue(CACHE, [...entries.filter(item => Array.isArray(item) && item[0] !== key).slice(-99), [key, result, result.length ? null : Date.now() + 60000]]);
  return result;

  function normalize(decoded: unknown[]): VocabularyWord[] { return normalizeVocabulary(text, decoded, translation); }
}

export function normalizeVocabulary(text: string, decoded: unknown[], translation = ''): VocabularyWord[] {
    const sourceWords = new Set((text.toLowerCase().match(/[a-z]+(?:[-'][a-z]+)*/g) ?? []));
    const seen = new Set<string>();
    const candidates: unknown[] = decoded.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('word' in item) || typeof item.word !== 'string') return item;
      const escaped = item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').exec(text);
      const start = match ? Math.max(text.lastIndexOf('\n', match.index) + 1, match.index - 100) : 0;
      const boundary = match ? text.slice(match.index).search(/[.!?](?=\s|$)|\n/) : -1;
      const end = match ? Math.min(boundary < 0 ? text.length : match.index + boundary + 1, match.index + item.word.length + 150) : 0;
      const level = 'level' in item && item.level === '固定CET6' ? 'CET6' : 'level' in item ? item.level : undefined;
      return { ...item, level, example: text.slice(start, end).trim() };
    });
    return words(candidates).filter(word => {
      const normalized = word.word.toLowerCase();
      if (word.level !== 'CET6' && word.level !== 'CET6+' || !sourceWords.has(normalized) || !word.example || !text.includes(word.example) || seen.has(normalized)) return false;
      seen.add(normalized); return true;
    }).slice(0, 6).map(word => word.translatedTerm ? { ...word, translatedTerm: !translation || translation.includes(word.translatedTerm) ? word.translatedTerm : '' } : word);
}
