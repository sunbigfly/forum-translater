import { afterEach, expect, it, vi } from 'vitest';
import { AiBatcher } from '../src/translation/ai-batcher';
import { TranslationTaskManager } from '../src/translation/translation-task-manager';
import { DEFAULTS } from '../src/settings';
import { translateAiBatch } from '../src/translation/ai';
vi.mock('../src/translation/ai', async importOriginal => ({ ...await importOriginal<typeof import('../src/translation/ai')>(), translateAiBatch: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('launches text before queued vocabulary after batching, while both remain concurrent', async () => {
  vi.useFakeTimers();
  const tasks = new TranslationTaskManager({ maxConcurrent: 2 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', model: 'test' }, tasks);
  const order: string[] = []; let finish!: (values: string[]) => void;
  vi.mocked(translateAiBatch).mockImplementation(() => { order.push('text'); return new Promise(resolve => { finish = resolve; }); });
  const signal = new AbortController().signal;
  const text = batcher.request('text', { text: 'Hello' }, 'visible', signal, vi.fn());
  const words = tasks.request({ key: 'vocabulary:test', serviceKey: 'ai', priority: 'prefetch', signal }, () => { order.push('vocabulary'); return Promise.resolve(); });
  await vi.advanceTimersByTimeAsync(24); expect(order).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(order).toEqual(['text', 'vocabulary']);
  finish(['你好']); await Promise.all([text, words]); batcher.destroy(); tasks.destroy();
});
it('merges simultaneous paragraphs into one request, deduplicates identical text and streams to each owner', async () => {
  vi.useFakeTimers();
  const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const scheduled = vi.spyOn(tasks, 'request');
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementation((sections, _ai, _signal, partial) => { sections.forEach((_section, index) => partial?.(index, '首字', false)); return Promise.resolve(sections.map(section => `译${section.text}`)); });
  const partial = vi.fn<(text: string) => void>(); const signal = new AbortController().signal;
  const requests = ['a', 'a', 'b', 'c'].map(key => batcher.request(key, { text: key }, 'visible', signal, partial));
  await vi.advanceTimersByTimeAsync(25);
  expect(await Promise.all(requests)).toEqual(['译a', '译a', '译b', '译c']);
  expect(translateAiBatch).toHaveBeenCalledOnce();
  expect(scheduled.mock.calls[0]?.[0].priority).toBe('visible-batch');
  expect(vi.mocked(translateAiBatch).mock.calls[0]?.[0]).toHaveLength(3);
  expect(partial.mock.calls.map(call => call[0])).toEqual(['首字', '首字', '首字', '首字', '译a', '译a', '译b', '译c']);
  batcher.destroy(); tasks.destroy();
});
it('cancelling one paragraph does not abort other paragraphs in the same batch', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  let complete: ((values: string[]) => void) | undefined; let signal: AbortSignal | undefined;
  vi.mocked(translateAiBatch).mockImplementation((_sections, _ai, value) => { signal = value; return new Promise(resolve => { complete = resolve; }); });
  const first = new AbortController(); const second = new AbortController();
  const a = batcher.request('a', { text: 'a' }, 'visible', first.signal, vi.fn());
  const b = batcher.request('b', { text: 'b' }, 'visible', second.signal, vi.fn());
  await vi.advanceTimersByTimeAsync(25);
  const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' }); first.abort(); await rejected;
  expect(signal?.aborted).toBe(false); complete?.(['甲', '乙']); expect(await b).toBe('乙');
  batcher.destroy(); tasks.destroy();
});

it('sends only the new batch without accumulating prior source or translation history', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockResolvedValue(['译文']);
  const signal = new AbortController().signal;
  const first = batcher.request('a', { text: 'First' }, 'visible', signal, vi.fn()); await vi.advanceTimersByTimeAsync(25); await first;
  const second = batcher.request('b', { text: 'Second' }, 'visible', signal, vi.fn()); await vi.advanceTimersByTimeAsync(25); await second;
  const calls = vi.mocked(translateAiBatch).mock.calls;
  expect(calls[0]?.[0].map(section => section.text)).toEqual(['First']);
  expect(calls[1]?.[0].map(section => section.text)).toEqual(['Second']);
  expect(calls[1]).toHaveLength(4);
  batcher.destroy(); tasks.destroy();
});

it('delivers completed sections immediately and retries only unfinished sections', async () => {
  vi.useFakeTimers();
  const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementationOnce((_sections, _ai, _signal, partial) => {
    partial?.(0, '第一段译文', true);
    return Promise.reject(new Error('网络错误'));
  }).mockResolvedValueOnce(['第二段译文']);
  const signal = new AbortController().signal;
  const first = batcher.request('a', { text: 'First' }, 'visible', signal, vi.fn());
  const second = batcher.request('b', { text: 'Second' }, 'visible', signal, vi.fn());
  await vi.advanceTimersByTimeAsync(25);
  expect(await first).toBe('第一段译文');
  expect(translateAiBatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await second).toBe('第二段译文');
  expect(vi.mocked(translateAiBatch).mock.calls[1]?.[0].map(section => section.text)).toEqual(['Second']);
  batcher.destroy(); tasks.destroy();
});

it('keeps vocabulary running after delivering text and never retranslates text after a failed tail', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  let fail!: (error: Error) => void; let transportSignal!: AbortSignal;
  const words = vi.fn();
  vi.mocked(translateAiBatch).mockImplementation((_sections, _ai, signal, partial) => {
    transportSignal = signal; partial?.(0, '已完成正文', true);
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  const result = batcher.request('a', { text: 'First', onVocabulary: words }, 'visible', new AbortController().signal, vi.fn());
  await vi.advanceTimersByTimeAsync(25);
  expect(await result).toBe('已完成正文');
  expect(batcher.hasPendingVocabulary('a')).toBe(true);
  expect(transportSignal.aborted).toBe(false);
  fail(new Error('网络错误'));
  await vi.advanceTimersByTimeAsync(4000);
  expect(translateAiBatch).toHaveBeenCalledOnce();
  expect(batcher.hasPendingVocabulary('a')).toBe(false);
  batcher.destroy(); tasks.destroy();
});

it('retries only unfinished combined sections after a stream fails', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementationOnce((_sections, _ai, _signal, partial) => {
    partial?.(0, '已完成正文', true);
    return Promise.reject(new Error('流读取失败'));
  }).mockResolvedValueOnce(['第二段译文']);
  const signal = new AbortController().signal;
  const first = batcher.request('a', { text: 'First', onVocabulary: vi.fn() }, 'visible', signal, vi.fn());
  const second = batcher.request('b', { text: 'Second', onVocabulary: vi.fn() }, 'visible', signal, vi.fn());
  await vi.advanceTimersByTimeAsync(25);
  expect(await first).toBe('已完成正文');
  await vi.advanceTimersByTimeAsync(1000);
  expect(await second).toBe('第二段译文');
  expect(vi.mocked(translateAiBatch).mock.calls.map(call => call[0].map(section => section.text))).toEqual([['First', 'Second'], ['Second']]);
  batcher.destroy(); tasks.destroy();
});

it('does not abort a delivered section vocabulary tail when another section is cancelled', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  const words = vi.fn(); let finish!: (values: string[]) => void; let transportSignal!: AbortSignal;
  vi.mocked(translateAiBatch).mockImplementation((_sections, _ai, signal, partial) => {
    transportSignal = signal; partial?.(0, '第一段译文', true);
    return new Promise(resolve => { finish = resolve; });
  });
  const first = batcher.request('a', { text: 'First', onVocabulary: words }, 'visible', new AbortController().signal, vi.fn());
  const controller = new AbortController();
  const second = batcher.request('b', { text: 'Second' }, 'visible', controller.signal, vi.fn());
  await vi.advanceTimersByTimeAsync(25); expect(await first).toBe('第一段译文');
  const cancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled;
  expect(transportSignal.aborted).toBe(false); expect(batcher.hasPendingVocabulary('a')).toBe(true);
  vi.mocked(translateAiBatch).mock.calls[0]?.[0][0]?.onVocabulary?.([{ word: 'First' }], true);
  finish(['第一段译文', '第二段译文']); await vi.advanceTimersByTimeAsync(0);
  expect(words).toHaveBeenCalledWith([{ word: 'First' }], true);
  expect(batcher.hasPendingVocabulary('a')).toBe(false);
  batcher.destroy(); tasks.destroy();
});

it('groups more than six paragraphs by post and preserves paragraph order', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementation(sections => Promise.resolve(sections.map(section => `译${section.text}`)));
  const signal = new AbortController().signal;
  const requests = [6, 2, 0, 4, 3, 1, 5].map(index => batcher.request(`a${index}`, { text: `A${index}`, group: 'post-a', context: { before: '', after: '', post: 'Whole post A', index } }, 'visible', signal, vi.fn()));
  requests.push(batcher.request('b', { text: 'Post B', group: 'post-b' }, 'visible', signal, vi.fn()));
  await vi.advanceTimersByTimeAsync(25); await Promise.all(requests);
  const calls = vi.mocked(translateAiBatch).mock.calls;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0].map(section => section.text)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Post B']);
  batcher.destroy(); tasks.destroy();
});
it('caps batches at sixteen targets and keeps prefetch separate', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementation(sections => Promise.resolve(sections.map(section => section.text)));
  const requests = Array.from({ length: 18 }, (_, i) => batcher.request(String(i), { text: String(i), group: String(i) }, i === 17 ? 'prefetch' : 'visible', new AbortController().signal, vi.fn()));
  await vi.advanceTimersByTimeAsync(25); await Promise.all(requests);
  expect(vi.mocked(translateAiBatch).mock.calls.map(call => call[0].length)).toEqual([16, 1, 1]);
  batcher.destroy(); tasks.destroy();
});
it('sends the first visible post separately before larger batches', async () => {
  vi.useFakeTimers(); const tasks = new TranslationTaskManager({ maxConcurrent: 6 });
  const batcher = new AiBatcher({ ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'test' }, tasks);
  vi.mocked(translateAiBatch).mockImplementation(sections => Promise.resolve(sections.map(section => section.text)));
  const requests = ['other', 'first-a', 'first-b', 'third'].map(key => batcher.request(key, { text: key, group: key.startsWith('first') ? 'first' : key }, 'visible', new AbortController().signal, vi.fn()));
  batcher.setForeground(['first-a', 'first-b']); await vi.advanceTimersByTimeAsync(25); await Promise.all(requests);
  expect(vi.mocked(translateAiBatch).mock.calls.map(call => call[0].map(section => section.text))).toEqual([['first-a', 'first-b'], ['other', 'third']]);
  batcher.destroy(); tasks.destroy();
});
