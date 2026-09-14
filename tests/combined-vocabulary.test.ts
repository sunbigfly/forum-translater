// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/settings';
import { TranslationCache, TranslationService } from '../src/translation/service';
import { normalizeVocabulary } from '../src/vocabulary';
import { mountVocabulary } from '../src/vocabulary-ui';
import { CombinedVocabulary } from '../src/translation/combined-vocabulary';

const source = 'A substantial epistemological challenge.';
const selected = ['substantial', 'epistemological'].map((word, index) => ({ section: 'section_0', word, ipa: '/test/', meaning: '挑战', level: index ? 'CET6+' : '固定CET6' }));
const settings = { ...DEFAULTS, provider: 'ai' as const, ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } };
const event = (delta: string): string => `data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`;
let store: Map<string, unknown>;
let service: TranslationService;
beforeEach(() => {
  store = new Map(); vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  service = new TranslationService(settings, new TranslationCache());
});
afterEach(() => { service.destroy(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('accepts six-level and advanced words, repairs the observed legacy level, and rejects basic or absent words', () => {
  expect(normalizeVocabulary(source, [...selected, { ...selected[0], word: 'challenge', level: 'CET4' }, { ...selected[1], word: 'absent' }]).map(word => [word.word, word.level])).toEqual([['substantial', 'CET6'], ['epistemological', 'CET6+']]);
});

it('keeps streamed word order stable across sections and isolates different posts', () => {
  const vocabulary = new CombinedVocabulary('test');
  const received = vi.fn(); vocabulary.watch(source, received);
  vocabulary.publish(source, 'second', [selected[1]], false);
  vocabulary.publish(source, 'first', [selected[0]], false);
  expect(received).toHaveBeenLastCalledWith([expect.objectContaining({ word: 'epistemological' }), expect.objectContaining({ word: 'substantial' })]);
  const other = vi.fn(); vocabulary.watch('Different post', other);
  expect(other).toHaveBeenCalledWith([]);
});

it('streams text and vocabulary from one request, keeps it alive for words, and restores both after reload', async () => {
  let transport: GmRequestOptions | undefined;
  const abort = vi.fn();
  const request = vi.fn((options: GmRequestOptions) => { transport = options; return { abort }; });
  vi.stubGlobal('GM_xmlhttpRequest', request);
  const anchor = document.createElement('div'); document.body.append(anchor);
  const cleanup = mountVocabulary(anchor, source, 'https://x.com/home', service);
  const partial = vi.fn(); let finished = false;
  const promise = service.section(source, 'post', 'visible', new AbortController().signal, partial, { post: source, before: '', after: '' }).then(text => { finished = true; return text; });
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  let responseText = event('{"section_0":"一个重大认识论挑战。","vocabulary":[');
  transport?.onprogress?.({ status: 200, responseText });
  await Promise.resolve();
  expect(partial).toHaveBeenCalledWith('一个重大认识论挑战。');
  expect(finished).toBe(false); expect(abort).not.toHaveBeenCalled();
  const host = document.querySelector<HTMLElement>('[data-ft-owned="learning"]');
  expect(host?.hidden).toBe(true);
  responseText += event(JSON.stringify(selected[0]));
  transport?.onprogress?.({ status: 200, responseText });
  await vi.waitFor(() => expect(host?.shadowRoot?.querySelectorAll('.word-row')).toHaveLength(1));
  expect(host?.hidden).toBe(false); expect(finished).toBe(true); expect(abort).not.toHaveBeenCalled();
  responseText += event(`,${JSON.stringify(selected[1])}]}`);
  transport?.onprogress?.({ status: 200, responseText });
  expect(await promise).toBe('一个重大认识论挑战。');
  await vi.waitFor(() => expect(host?.shadowRoot?.querySelectorAll('.word-row')).toHaveLength(2));
  expect(request).toHaveBeenCalledOnce(); expect(abort).toHaveBeenCalledOnce();
  cleanup(); service.destroy();
  service = new TranslationService(settings, new TranslationCache());
  const restored = vi.fn(); const stop = service.watchVocabulary(source, restored);
  expect(restored.mock.calls[0]?.[0]).toHaveLength(2);
  expect(await service.section(source, 'post', 'visible', new AbortController().signal, undefined, { post: source, before: '', after: '' })).toBe('一个重大认识论挑战。');
  expect(request).toHaveBeenCalledOnce(); stop();
});

it('hides empty vocabulary and does not launch a fallback request', async () => {
  const request = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => options.onprogress?.({ status: 200, responseText: event('{"section_0":"你好","vocabulary":[]}') }));
    return { abort: vi.fn() };
  }); vi.stubGlobal('GM_xmlhttpRequest', request);
  const anchor = document.createElement('div'); document.body.append(anchor);
  const cleanup = mountVocabulary(anchor, 'Hello world', 'https://x.com/home', service);
  expect(await service.section('Hello world', 'post', 'visible', new AbortController().signal)).toBe('你好');
  expect(document.querySelector<HTMLElement>('[data-ft-owned="learning"]')?.hidden).toBe(true);
  expect(request).toHaveBeenCalledOnce(); cleanup();
});
