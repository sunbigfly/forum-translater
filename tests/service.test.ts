// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/settings';
import { TranslationCache, TranslationService, splitText } from '../src/translation/service';
import { requestJson, validateTranslation } from '../src/translation/provider';
let service: TranslationService;
let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { store.set(key, value); });
  service = new TranslationService(DEFAULTS, new TranslationCache());
});
afterEach(() => { service.destroy(); vi.unstubAllGlobals(); });
describe('translation gateway and cache', () => {
  it('cancels old route work and accepts new work after reset', async () => {
    const oldTasks = service.tasks;
    let activeSignal: AbortSignal | undefined;
    const pending = oldTasks.request({ key: 'old', serviceKey: 'ai', priority: 'visible', signal: new AbortController().signal }, signal => { activeSignal = signal; return new Promise<void>(() => {}); });
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);
    await Promise.resolve(); service.resetPending(); await rejected;
    expect(activeSignal?.aborted).toBe(true);
    await expect(service.tasks.request({ key: 'new', serviceKey: 'ai', priority: 'visible', signal: new AbortController().signal }, () => Promise.resolve('new'))).resolves.toBe('new');
  });
  it('keeps AI requests alive after a view disappears and reuses them on return', async () => {
    service.destroy();
    service = new TranslationService({ ...DEFAULTS, provider: 'ai', ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' } }, new TranslationCache());
    let options: GmRequestOptions | undefined; const abort = vi.fn();
    const request = vi.fn((value: GmRequestOptions) => { options = value; return { abort }; });
    vi.stubGlobal('GM_xmlhttpRequest', request);
    const first = new AbortController(); const partial = vi.fn();
    const pending = service.section('Hello world', 'old-node', 'visible', first.signal, partial);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    first.abort(); service.release('old-node'); await rejected;
    expect(abort).not.toHaveBeenCalled();
    const next = service.section('Hello world', 'new-node', 'visible', new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(request).toHaveBeenCalledOnce();
    options?.onload?.({ status: 200, responseText: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"section_0":"你好世界","vocabulary":[]}' }] }] }) });
    await expect(next).resolves.toBe('你好世界');
    await expect(service.section('Hello world', 'third-node', 'visible', new AbortController().signal)).resolves.toBe('你好世界');
    expect(request).toHaveBeenCalledOnce(); expect(partial).not.toHaveBeenCalled();
  });
  it('deduplicates identical work across owners and reuses persisted cache', async () => {
    const request = vi.fn((options: Parameters<typeof GM_xmlhttpRequest>[0]) => {
      queueMicrotask(() => options.onload?.({ status: 200, responseText: '[["你好世界"]]' }));
      return { abort: vi.fn() };
    });
    vi.stubGlobal('GM_xmlhttpRequest', request);
    const signal = new AbortController().signal;
    const values = await Promise.all([service.section('Hello world', 'a', 'visible', signal), service.section('Hello world', 'b', 'prefetch', signal)]);
    expect(values).toEqual(['你好世界', '你好世界']); expect(request).toHaveBeenCalledTimes(1);
    service.destroy(); service = new TranslationService(DEFAULTS, new TranslationCache());
    expect(await service.section('Hello world', 'c', 'visible', signal)).toBe('你好世界'); expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].anonymous).toBe(true);
  });
  it('aborts the GM handle and rejects HTTP and malformed JSON failures', async () => {
    let options: Parameters<typeof GM_xmlhttpRequest>[0] | undefined;
    const abort = vi.fn(); vi.stubGlobal('GM_xmlhttpRequest', (value: Parameters<typeof GM_xmlhttpRequest>[0]) => { options = value; return { abort }; });
    const controller = new AbortController();
    const promise = requestJson('https://example.com', controller.signal); const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; expect(abort).toHaveBeenCalledOnce();
    const bad = requestJson('https://example.com', new AbortController().signal);
    options?.onload?.({ status: 429, responseText: 'private body' }); await expect(bad).rejects.toThrow('HTTP 429');
    const invalid = requestJson('https://example.com', new AbortController().signal);
    options?.onload?.({ status: 200, responseText: 'not json' }); await expect(invalid).rejects.toThrow('格式错误');
  });
  it('protects tokens when splitting long text and rejects missing or duplicate placeholders', () => {
    const source = 'a'.repeat(898) + '⟦123⟧' + 'b'.repeat(1800);
    const parts = splitText(source); expect(parts.join('')).toBe(source); expect(parts.every(part => part.length <= 900)).toBe(true);
    expect(parts.some(part => part.includes('⟦123⟧'))).toBe(true);
    expect(() => validateTranslation('Hi ⟦0⟧', '你好')).toThrow();
    expect(() => validateTranslation('Hi ⟦0⟧', '你好 ⟦0⟧⟦0⟧')).toThrow();
    expect(validateTranslation('Hi ⟦0⟧', '你好 ⟦ 0 ⟧')).toBe('你好 ⟦0⟧');
  });
  it('expires cached entries and does not request untranslated code-only content', async () => {
    store.set('ft:translations:v1', [['expired', { text: 'old', expires: 0 }]]);
    const cache = new TranslationCache(); expect(cache.get('expired')).toBeUndefined(); cache.clear();
    const request = vi.fn(); vi.stubGlobal('GM_xmlhttpRequest', request);
    expect(await service.section('⟦0⟧', 'x', 'visible', new AbortController().signal)).toBe('⟦0⟧'); expect(request).not.toHaveBeenCalled();
  });
});
