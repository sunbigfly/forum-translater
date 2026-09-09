// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryDictionary, queryExamples } from '../src/wordbook';
import { renderWordbook } from '../src/vocabulary-ui';
import { requestJson } from '../src/translation/provider';
import { readWordbook, type SavedWord } from '../src/vocabulary';
vi.mock('../src/translation/provider', () => ({ requestJson: vi.fn() }));
let root: HTMLElement; let store: Map<string, unknown>;
const wiki = { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A <a href="/wiki/company">company</a>.', parsedExamples: [{ example: 'An <b>enterprise</b>.' }] }] }] };
const pairs = { data: [{ id: 10, text: 'An enterprise grows.', lang: 'eng', owner: 'Alice', translations: [{ id: 20, text: '一家企业在成长。', lang: 'cmn', owner: 'Bob' }] }] };
function click(label: string): void { const button = [...root.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); expect(button).toBeDefined(); button?.click(); }
beforeEach(() => {
  const book: SavedWord[] = Array.from({ length: 105 }, (_, index) => ({ word: `word${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`, ipa: '/test/', meaning: '测试', example: 'Source example.', memoryExample: 'Memory example.', memoryMeaning: '记忆例句', level: 'CET6', sourceUrl: 'https://example.com/post', addedAt: index, due: 0, stage: 0 }));
  store = new Map([['ft:wordbook:v1', book]]);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback); vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { store.set(key, value); });
  root = document.createElement('section'); document.body.append(root);
  vi.mocked(requestJson).mockImplementation(url => Promise.resolve(url.includes('tatoeba') ? pairs : wiki));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });
it('paginates all words and clamps the final page after removal', () => {
  const dispose = renderWordbook(root); expect(root.querySelectorAll('.wb-row')).toHaveLength(10); expect(requestJson).not.toHaveBeenCalled();
  for (let i = 0; i < 10; i++) click('下一页');
  expect(root.querySelectorAll('.wb-row')).toHaveLength(5);
  for (let i = 0; i < 5; i++) click('移除');
  expect(root.textContent).toContain('第 10 / 10 页'); expect(readWordbook()).toHaveLength(100); dispose();
});
it('persists dictionary and bilingual results across remounts without new network requests', async () => {
  let dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain('一家企业在成长。'));
  expect(root.textContent).toContain('A company.'); expect(root.textContent).toContain('已缓存'); expect(requestJson).toHaveBeenCalledTimes(2);
  dispose(); root.replaceChildren(); dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain('一家企业在成长。')); expect(requestJson).toHaveBeenCalledTimes(2); dispose();
});
it('uses Wiktionary directly and never stores failed requests', async () => {
  vi.mocked(requestJson).mockRejectedValueOnce(new Error('HTTP 404'));
  await expect(queryDictionary('missing', new AbortController().signal)).rejects.toThrow('404');
  expect([...store.keys()].some(key => key.includes('missing'))).toBe(false);
  await queryDictionary('missing', new AbortController().signal);
  expect(vi.mocked(requestJson).mock.calls[0]?.[0]).toContain('en.wiktionary.org'); expect(requestJson).toHaveBeenCalledTimes(2);
});
it('bounds the request to eight seconds without a slow primary provider', async () => {
  vi.useFakeTimers(); vi.mocked(requestJson).mockImplementationOnce((_url, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const result = queryDictionary('enterprise', new AbortController().signal); const assertion = expect(result).rejects.toThrow('dictionary-timeout');
  await vi.advanceTimersByTimeAsync(8000); await assertion; expect(requestJson).toHaveBeenCalledOnce();
});
it('cancels both pending requests when returning to the list', async () => {
  vi.mocked(requestJson).mockImplementation((_url, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }));
  const dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click(); click('返回单词本');
  await Promise.resolve(); expect(vi.mocked(requestJson).mock.calls.every(call => call[1].aborted)).toBe(true); dispose();
});
it('requests direct Chinese translations with required sort and preserves attribution', async () => {
  const result = await queryExamples('enterprise', new AbortController().signal);
  const url = new URL(vi.mocked(requestJson).mock.calls[0]?.[0] ?? '');
  expect(url.searchParams.get('sort')).toBe('relevance'); expect(url.searchParams.get('trans:lang')).toBe('cmn'); expect(url.searchParams.get('trans:is_direct')).toBe('yes');
  expect(result[0]).toMatchObject({ owner: 'Alice', translationOwner: 'Bob', chinese: '一家企业在成长。' });
  await queryExamples('enterprise', new AbortController().signal); expect(requestJson).toHaveBeenCalledOnce();
});
it('retries empty bilingual caches after one day and rejects malformed responses', async () => {
  vi.mocked(requestJson).mockResolvedValue({ data: [] });
  await queryExamples('absent', new AbortController().signal); await queryExamples('absent', new AbortController().signal); expect(requestJson).toHaveBeenCalledOnce();
  const entry = store.get('ft:wordbook-detail:v1:tatoeba:absent') as { savedAt: number }; entry.savedAt -= 86400001;
  vi.mocked(requestJson).mockResolvedValue({ bad: true }); await expect(queryExamples('absent', new AbortController().signal)).rejects.toThrow('格式');
});
it('restores scroll position and labels icon controls', () => {
  const scroller = document.createElement('div'); scroller.className = 'layout'; root.before(scroller); scroller.append(root);
  const dispose = renderWordbook(root); scroller.scrollTop = 260; root.querySelector<HTMLButtonElement>('.wb-open')?.click(); expect(scroller.scrollTop).toBe(0);
  expect(root.querySelector('[aria-label="返回单词本"] svg')).not.toBeNull(); click('返回单词本'); expect(scroller.scrollTop).toBe(260); dispose();
});
it('fetches all sources independently and switches cached views without additional requests', async () => {
  const dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain('A company.'));
  expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('双语学习');
  expect(root.querySelector<HTMLElement>('.wb-dictionary')?.hidden).toBe(true);
  click('Wiktionary'); expect(root.querySelector<HTMLElement>('.wb-dictionary')?.hidden).toBe(false);
  click('双语学习'); expect(requestJson).toHaveBeenCalledTimes(2); dispose();
});
it('keeps a source usable when the other source fails', async () => {
  vi.mocked(requestJson).mockImplementation(url => url.includes('tatoeba') ? Promise.reject(new Error('offline')) : Promise.resolve(wiki));
  const dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain('A company.')); expect(root.textContent).toContain('双语例句暂时无法获取');
  click('Wiktionary'); expect(root.querySelector<HTMLElement>('.wb-dictionary')?.hidden).toBe(false); dispose();
});
it('highlights the target vocabulary in bilingual examples', async () => {
  const book = readWordbook(); const first = book[0]; if (!first) throw new Error('Missing word'); store.set('ft:wordbook:v1', [{ ...first, word: 'enterprise' }]);
  const dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.querySelector('mark')?.textContent).toBe('enterprise')); dispose();
});
it('keeps word management without the removed study session', () => {
  const dispose = renderWordbook(root); expect(root.textContent).not.toContain('继续学习'); expect(root.querySelectorAll('.wb-row')).toHaveLength(10);
  root.querySelector<HTMLButtonElement>('.wb-open')?.click(); expect(root.textContent).not.toContain('显示释义'); expect(root.textContent).not.toContain('忘记了'); dispose();
});
it('simplifies and marks a previously cached Chinese example without refetching it', async () => {
  const first = readWordbook()[0]; if (!first) throw new Error('Missing word'); store.set('ft:wordbook:v1', [{ ...first, word: 'enterprise', meaning: '企业' }]);
  store.set('ft:wordbook-detail:v1:tatoeba:enterprise', { version: 1, savedAt: Date.now(), value: [{ id: 10, english: 'An enterprise grows.', chinese: '這家企業正在成長。', translationId: 20, owner: 'Alice', translationOwner: 'Bob', license: 'CC0 1.0', translationLicense: 'CC0 1.0' }] });
  const dispose = renderWordbook(root); root.querySelector<HTMLButtonElement>('.wb-open')?.click();
  await vi.waitFor(() => expect(root.querySelector('[lang="zh-Hans"] mark')?.textContent).toBe('企业'));
  expect(root.querySelector('[lang="zh-Hans"]')?.textContent).toBe('这家企业正在成长。');
  expect(vi.mocked(requestJson).mock.calls.every(call => !call[0].includes('tatoeba'))).toBe(true); dispose();
});
