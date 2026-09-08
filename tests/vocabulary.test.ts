// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectVocabulary, readWordbook, removeWord, reviewWord, saveWord, speakWord, stopWordSpeech, type VocabularyWord } from '../src/vocabulary';
import { requestVocabularyText } from '../src/vocabulary-stream';
import { TranslationTaskManager } from '../src/translation/translation-task-manager';
import { DEFAULTS } from '../src/settings';
import { mountVocabulary, renderWordbook } from '../src/vocabulary-ui';
import { TranslationCache, TranslationService } from '../src/translation/service';
vi.mock('../src/vocabulary-stream', async importOriginal => ({ ...await importOriginal<typeof import('../src/vocabulary-stream')>(), requestVocabularyText: vi.fn() }));
const word: VocabularyWord = { word: 'publish', ipa: '/ˈpʌblɪʃ/', meaning: '发布', example: 'They publish it.', level: 'CET4' };
let store: Map<string, unknown>; let tasks: TranslationTaskManager;
beforeEach(() => {
  store = new Map(); tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => { stopWordSpeech(); tasks.destroy(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });
it('deduplicates saved words and persists review progress across opening the wordbook', () => {
  saveWord(word, 'https://x.com/a/status/123?tracking=1'); saveWord({ ...word, word: 'Publish' }, 'https://x.com/');
  expect(readWordbook()).toHaveLength(1); expect(readWordbook()[0]?.sourceUrl).toBe('https://x.com/a/status/123');
  reviewWord('publish', true); expect(readWordbook()[0]?.stage).toBe(1); expect(readWordbook()[0]?.due).toBeGreaterThan(Date.now());
  reviewWord('publish', false); expect(readWordbook()[0]?.stage).toBe(0);
  removeWord('publish'); expect(readWordbook()).toEqual([]);
});
it('validates original words and examples, caches results, and does not send a second request', async () => {
  const advanced: VocabularyWord = { ...word, word: 'substantial', level: 'CET6', example: 'It requires substantial effort.' };
  vi.mocked(requestVocabularyText).mockResolvedValue(JSON.stringify([advanced, word, { ...advanced, word: 'invented' }]));
  const settings = { ...DEFAULTS, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } };
  expect(await collectVocabulary('It requires substantial effort. They publish it.', settings, tasks, new AbortController().signal)).toEqual([advanced]);
  expect(await collectVocabulary('It requires substantial effort. They publish it.', settings, tasks, new AbortController().signal)).toEqual([advanced]);
  expect(requestVocabularyText).toHaveBeenCalledOnce();
});
it('reuses recent empty results but reanalyses expired or legacy empty caches', async () => {
  const settings = { ...DEFAULTS, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } };
  const load = (): Promise<VocabularyWord[]> => collectVocabulary('substantial effort', settings, tasks, new AbortController().signal);
  vi.mocked(requestVocabularyText).mockResolvedValue('[]');
  await load(); await load(); expect(requestVocabularyText).toHaveBeenCalledOnce();
  const cache = store.get('ft:vocabulary:v1') as unknown[][];
  if (!cache[0]) throw new Error('Expected cached empty result');
  cache[0][2] = Date.now() - 1;
  await load(); expect(requestVocabularyText).toHaveBeenCalledTimes(2);
  const latest = store.get('ft:vocabulary:v1') as unknown[][];
  if (!latest[0]) throw new Error('Expected refreshed empty result');
  latest[0].length = 2;
  vi.mocked(requestVocabularyText).mockResolvedValue(JSON.stringify([{ ...word, word: 'substantial', level: 'CET6' }]));
  expect(await load()).toHaveLength(1); expect(requestVocabularyText).toHaveBeenCalledTimes(3);
});
it('shows only three compact words and expands examples and remaining words on demand', async () => {
  const source = 'substantial coherent inevitable profound';
  const selected = source.split(' ').map(value => ({ ...word, word: value, level: 'CET6', example: source, memoryExample: `This is ${value}.`, memoryMeaning: '这需要大量的努力。', memoryTerm: value === 'substantial' ? '大量的' : '不存在的对应词' }));
  vi.mocked(requestVocabularyText).mockResolvedValue(JSON.stringify(selected));
  const service = new TranslationService({ ...DEFAULTS, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } }, new TranslationCache());
  const original = document.createElement('div'); original.textContent = source;
  const anchor = document.createElement('div'); document.body.append(original, anchor);
  const destroy = mountVocabulary(anchor, source, 'https://x.com/home', service, { original, translations: [anchor] });
  try {
    const shadow = document.querySelector('[data-ft-owned="learning"]')?.shadowRoot;
    await vi.waitFor(() => expect(shadow?.querySelectorAll('.word-row')).toHaveLength(4));
    const marked = original.querySelector('[data-ft-word]'); marked?.dispatchEvent(new Event('pointerenter'));
    const popup = document.querySelector('[data-ft-owned="word-popup"]')?.shadowRoot;
    expect(popup?.textContent).toContain('This is substantial.');
    expect(popup?.querySelector('.ft-audio')).not.toBeNull();
    popup?.querySelector<HTMLButtonElement>('[aria-label="收藏单词"]')?.click();
    expect(readWordbook()[0]?.word).toBe('substantial');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-ft-owned="word-popup"]')).toBeNull();
    expect(requestVocabularyText).toHaveBeenCalledOnce();
    const rows = [...(shadow?.querySelectorAll<HTMLElement>('.word-row') ?? [])];
    expect(rows.map(row => row.parentElement?.hidden)).toEqual([false, false, false, true]);
    const example = shadow?.querySelector<HTMLElement>('.example'); expect(example?.hidden).toBe(true);
    shadow?.querySelector<HTMLButtonElement>('.word')?.click(); expect(example?.hidden).toBe(false); expect(example?.textContent).toContain('This is substantial.');
    expect(example?.querySelector('u')?.textContent).toBe('substantial');
    expect(example?.querySelector('p:nth-child(2) u')?.textContent).toBe('大量的');
    expect(example?.querySelector('p:nth-child(2)')?.textContent).toBe('这需要大量的努力。');
    expect(rows[1]?.parentElement?.querySelector('.example p:nth-child(2) u')).toBeNull();
    rows[0]?.querySelector<HTMLElement>('.meaning')?.click(); expect(example?.hidden).toBe(true);
    rows[0]?.querySelector<HTMLElement>('.ipa')?.click(); expect(example?.hidden).toBe(false);
    rows[0]?.click(); expect(example?.hidden).toBe(true);
    shadow?.querySelector<HTMLButtonElement>('.more')?.click(); expect(rows[3]?.parentElement?.hidden).toBe(false);
    shadow?.querySelector<HTMLButtonElement>('.more')?.click(); expect(rows[3]?.parentElement?.hidden).toBe(true);
    shadow?.querySelector<HTMLButtonElement>('[aria-label="收藏 substantial"]')?.click(); expect(readWordbook()[0]?.memoryMeaning).toBe('这需要大量的努力。');
    expect(example?.hidden).toBe(true);
    rows[0]?.querySelector<HTMLButtonElement>('.ft-audio')?.click(); expect(example?.hidden).toBe(true);
    expect(shadow?.querySelector('h3')).toBeNull(); expect(shadow?.querySelector('section')?.textContent).not.toContain('六级参考');
  } finally { destroy(); service.destroy(); }
});
it('supports reveal, review and returning to the saved word preview', () => {
  saveWord(word, 'https://reddit.com/'); const root = document.createElement('section'); document.body.append(root); renderWordbook(root);
  const click = (label: string): void => { [...root.querySelectorAll('button')].find(button => button.textContent === label)?.click(); };
  click('继续学习');
  expect(root.querySelector<HTMLInputElement>('input')?.hidden).toBe(true);
  click('显示释义'); click('记住了'); expect(root.textContent).toContain('本轮学习完成');
  click('返回单词本'); expect(root.querySelector<HTMLInputElement>('input')?.hidden).toBe(false);
  expect(readWordbook()[0]?.stage).toBe(1);
});
it('keeps loading vocabulary hidden and shows words as they arrive', async () => {
  const entry = { ...word, word: 'substantial', level: 'CET6', memoryExample: 'A substantial meal.', memoryMeaning: '一顿丰盛的饭。', memoryTerm: '丰盛' };
  let publish: ((text: string) => void) | undefined;
  let finish: ((text: string) => void) | undefined;
  vi.mocked(requestVocabularyText).mockImplementation((_url, _signal, _body, _key, onPartial) => {
    publish = onPartial; return new Promise(resolve => { finish = resolve; });
  });
  const service = new TranslationService({ ...DEFAULTS, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } }, new TranslationCache());
  const anchor = document.createElement('div'); document.body.append(anchor);
  const destroy = mountVocabulary(anchor, 'A substantial meal.', 'https://x.com/home', service);
  try {
    const host = document.querySelector<HTMLElement>('[data-ft-owned="learning"]');
    const shadow = host?.shadowRoot;
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'));
    expect(host?.hidden).toBe(true);
    expect(shadow?.querySelectorAll('.skeleton')).toHaveLength(0);
    publish?.(`[${JSON.stringify(entry)},`);
    expect(shadow?.querySelectorAll('.word-row')).toHaveLength(1);
    expect(host?.hidden).toBe(false);
    shadow?.querySelector<HTMLButtonElement>('.word')?.click();
    finish?.(JSON.stringify([entry]));
    await vi.waitFor(() => expect(shadow?.querySelector('section')?.hasAttribute('aria-busy')).toBe(false));
    expect(shadow?.querySelector<HTMLElement>('.example')?.hidden).toBe(false);
    expect(shadow?.querySelector('section')?.hasAttribute('aria-busy')).toBe(false);
  } finally { destroy(); service.destroy(); }
});
it('highlights translations arriving after vocabulary without another model request', async () => {
  const entry = { ...word, word: 'substantial', level: 'CET6', translatedTerm: '丰盛' };
  vi.mocked(requestVocabularyText).mockResolvedValue(JSON.stringify([entry]));
  const service = new TranslationService({ ...DEFAULTS, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } }, new TranslationCache());
  const original = document.createElement('p'); original.textContent = 'A substantial meal.';
  const translation = document.createElement('div'); document.body.append(original, translation);
  const destroy = mountVocabulary(translation, original.textContent, 'https://x.com/home', service, { original, translations: [translation] });
  try {
    await vi.waitFor(() => expect(original.querySelector('[data-ft-word]')).not.toBeNull());
    translation.textContent = '一顿丰盛的饭。';
    await vi.waitFor(() => expect(translation.querySelector('[data-ft-word]')?.textContent).toBe('丰盛'));
    translation.textContent = '一顿饭。';
    await vi.waitFor(() => expect(translation.querySelector('[data-ft-word]')).toBeNull());
    expect(requestVocabularyText).toHaveBeenCalledOnce();
  } finally { destroy(); service.destroy(); }
});
it('uses an English voice and reports unsupported speech without throwing', () => {
  const status = document.createElement('p');
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(readonly text: string) {} });
  const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak });
  speakWord('publish', status); expect(speak).toHaveBeenCalledOnce();
  expect(speak.mock.calls[0]?.[0]).toMatchObject({ text: 'publish', lang: 'en-US', rate: 0.85 });
});
it('toggles speech off and restores the icon after natural completion', () => {
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(readonly text: string) {} });
  const utterances: SpeechSynthesisUtterance[] = []; const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (utterance: SpeechSynthesisUtterance) => utterances.push(utterance) });
  const status = document.createElement('p'); const button = document.createElement('button');
  speakWord('publish', status, button); expect(button.classList.contains('is-speaking')).toBe(true);
  speakWord('publish', status, button); expect(cancel).toHaveBeenCalledOnce(); expect(button.getAttribute('aria-pressed')).toBe('false');
  speakWord('publish', status, button); const utterance = utterances[1];
  utterance?.onend?.call(utterance, {} as SpeechSynthesisEvent);
  expect(button.classList.contains('is-speaking')).toBe(false);
});
