// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULTS, loadSettings, normalizeAiBaseUrl, saveSettings, type Settings } from '../src/settings';
import { aiEntries, ResponseStreamDecoder, translateAi, translateAiBatch } from '../src/translation/ai';
import { AiBatcher } from '../src/translation/ai-batcher';
import { TranslationTaskManager } from '../src/translation/translation-task-manager';
import { readTranslationMetrics } from '../src/translation/metrics';
import { translate } from '../src/translation/provider';
import { retryableTranslationError } from '../src/translation/retry';
import { TranslationCache, TranslationService } from '../src/translation/service';
const ai = { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only-key', model: 'test-model' };
const settings: Settings = { ...DEFAULTS, provider: 'ai', vocabulary: false, ai };
const event = (payload: unknown): string => `data: ${JSON.stringify(payload)}\r\n\r\n`;
const body = event({ type: 'response.output_text.delta', delta: '{"section_0":"你好 ⟦0⟧"}' }) + event({ type: 'response.completed' });
let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map(); vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { store.set(key, value); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('decodes cumulative fragmented SSE without duplicating deltas and rejects failed output', () => {
  const decoder = new ResponseStreamDecoder();
  expect(decoder.push(body.slice(0, 13))).toBe('');
  decoder.push(body.slice(0, 70));
  expect(decoder.push(body, true)).toBe('{"section_0":"你好 ⟦0⟧"}');
  expect(decoder.done).toBe(true);
  expect(() => new ResponseStreamDecoder().push(event({ type: 'response.failed', response: { error: { message: 'private body' } } }), true)).toThrow('AI 响应失败');
});
it.each(['response.failed', 'response.incomplete', 'error'])('rejects %s immediately even if the server leaves the stream open', async type => {
  const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (options: GmRequestOptions) => {
    queueMicrotask(() => options.onprogress?.({ status: 200, responseText: event({ type }) }));
    return { abort };
  });
  await expect(translate('Hello', settings, new AbortController().signal)).rejects.toThrow('AI 响应失败');
  expect(abort).toHaveBeenCalledOnce();
});
it.each([200, 429])('reports exhausted model quota without retry for HTTP %s', async status => {
  vi.stubGlobal('GM_xmlhttpRequest', (options: GmRequestOptions) => {
    queueMicrotask(() => options.onload?.({ status, responseText: JSON.stringify({ error: { type: 'usage_limit_reached', message: 'private provider detail' } }) }));
    return { abort: vi.fn() };
  });
  const error: unknown = await translate('Hello', settings, new AbortController().signal).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('当前模型额度已用尽');
  expect((error as Error).message).not.toContain('private');
  expect(retryableTranslationError(error)).toBe(false);
});
it.each([
  { type: 'response.failed', response: { error: { code: 'usage_limit_reached', message: 'private provider detail' } } },
  { type: 'error', error: { type: 'usage_limit_reached', message: 'private provider detail' } },
  { type: 'error', code: 'usage_limit_reached', message: 'private provider detail' },
])('preserves a non-retryable quota code for streaming errors: %j', async payload => {
  const request = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => options.onprogress?.({ status: 200, responseText: event(payload) }));
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', request);
  const error: unknown = await translateAi('Hello', ai, new AbortController().signal).catch((value: unknown) => value);
  expect((error as Error).message).toContain('usage_limit_reached');
  expect((error as Error).message).not.toContain('private');
  expect(retryableTranslationError(error)).toBe(false);
  expect(request).toHaveBeenCalledOnce();
});

it.each([
  { section_0: '已完成正文', section_1: '缺少保护标记', vocabulary: [] },
  { section_0: '已完成正文' },
  { section_0: '已完成正文', section_1: '有效 ⟦0⟧', vocabulary: 'invalid' },
])('retains valid sections from a non-streaming response before rejecting its invalid remainder: %j', async output => {
  vi.stubGlobal('GM_xmlhttpRequest', (options: GmRequestOptions) => {
    queueMicrotask(() => options.onload?.({ status: 200, responseText: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }) }));
    return { abort: vi.fn() };
  });
  const partial = vi.fn();
  await expect(translateAiBatch([{ text: 'First', onVocabulary: vi.fn() }, { text: 'Second ⟦0⟧' }], ai, new AbortController().signal, partial)).rejects.toThrow('不匹配');
  expect(partial).toHaveBeenCalledWith(0, '已完成正文', true);
  expect(partial.mock.calls.filter(call => call[0] === 0)).toHaveLength(1);
  if (output.section_1 !== '有效 ⟦0⟧') expect(partial.mock.calls.filter(call => call[0] === 1)).toHaveLength(0);
});

it.each([
  ['onprogress', '"尚未完成'], ['onload', '"尚未完成'],
  ['onprogress', '"缺少保护标记"'], ['onload', '"缺少保护标记"'],
] as const)('preserves only valid completed text before a same-block failure through %s (%s)', async (callback, unfinished) => {
  vi.useFakeTimers();
  const tasks = new TranslationTaskManager({ maxConcurrent: 4 });
  const batcher = new AiBatcher(ai, tasks);
  const sent: string[][] = [];
  const request = vi.fn((options: GmRequestOptions) => {
    if (typeof options.data !== 'string') throw new Error('Missing request body');
    const payload = JSON.parse(options.data) as { input: { content: string }[] };
    const sections = JSON.parse(payload.input[1]?.content ?? '[]') as { text: string }[];
    sent.push(sections.map(section => section.text));
    const responseText = sent.length === 1
      ? event({ type: 'response.output_text.delta', delta: `{"section_0":"第一段 ⟦0⟧","section_1":${unfinished}` }) + event({ type: 'response.failed' })
      : event({ type: 'response.output_text.delta', delta: '{"section_0":"第二段 ⟦1⟧","vocabulary":[]}' }) + event({ type: 'response.completed' });
    queueMicrotask(() => options[callback]?.({ status: 200, responseText }));
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', request);
  const signal = new AbortController().signal;
  const first = batcher.request('first', { text: 'First ⟦0⟧', onVocabulary: vi.fn() }, 'visible', signal, vi.fn());
  const second = batcher.request('second', { text: 'Second ⟦1⟧', onVocabulary: vi.fn() }, 'visible', signal, vi.fn());
  const secondResolved = vi.fn(); void second.then(secondResolved);
  await vi.advanceTimersByTimeAsync(25);
  expect(await first).toBe('第一段 ⟦0⟧');
  expect(secondResolved).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await second).toBe('第二段 ⟦1⟧');
  expect(request).toHaveBeenCalledTimes(2);
  expect(sent).toEqual([['First ⟦0⟧', 'Second ⟦1⟧'], ['Second ⟦1⟧']]);
  batcher.destroy(); tasks.destroy();
});
it('passes selected effort and fast tier to the transport', async () => {
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; queueMicrotask(() => value.onload?.({ status: 200, responseText: body })); return { abort: vi.fn() }; });
  await translateAi('Hello ⟦0⟧', { ...ai, reasoningEffort: 'none', fastMode: true }, new AbortController().signal);
  expect(JSON.parse(options?.data as string)).toMatchObject({ reasoning: { effort: 'none' }, service_tier: 'priority' });
});
it('uses the HN Responses contract and validates protected placeholders', async () => {
  const request = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => { options.onprogress?.({ status: 200, responseText: body.slice(0, 70) }); options.onload?.({ status: 200, responseText: body }); });
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', request);
  expect(await translate('Hello ⟦0⟧', settings, new AbortController().signal)).toBe('你好 ⟦0⟧');
  const options = request.mock.calls[0]?.[0];
  expect(options?.url).toBe('https://example.com/v1/responses');
  expect(options?.headers?.Authorization).toBe('Bearer test-only-key');
  if (typeof options?.data !== 'string') throw new Error('Missing JSON request body');
  expect(JSON.parse(options.data)).toMatchObject({ model: 'test-model', stream: true, store: false, reasoning: { effort: 'low' } });
  await expect(translate('Hello ⟦1⟧', settings, new AbortController().signal)).rejects.toThrow('占位符不匹配');
});
it('rejects truncated streams, mismatched sections, HTTP failures and aborts its transport', async () => {
  let options: GmRequestOptions | undefined; const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  for (const [status, responseText] of [
    [200, event({ type: 'response.output_text.delta', delta: '{"section_0":"你好"}' })],
    [200, event({ type: 'response.output_text.delta', delta: '{"wrong":"你好"}' }) + event({ type: 'response.completed' })],
    [200, JSON.stringify({ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"section_0":"你好"}' }] }] })],
    [401, 'sensitive response body'],
  ] as const) {
    const promise = translateAi('Hello', ai, new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow(status === 401 ? /HTTP 401/ : /未完整结束|不匹配|未完成/);
    options?.onload?.({ status, responseText }); await assertion;
  }
  const controller = new AbortController(); const promise = translateAi('Hello', ai, controller.signal);
  const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await assertion; expect(abort).toHaveBeenCalledOnce();
});
it('isolates models and prompts in cache without persisting credentials in cache or settings', async () => {
  const request = vi.fn((options: GmRequestOptions) => {
    queueMicrotask(() => options.onload?.({ status: 200, responseText: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"section_0":"你好"}' }] }] }) }));
    return { abort: vi.fn() };
  });
  vi.stubGlobal('GM_xmlhttpRequest', request);
  for (const profile of [ai, ai, { ...ai, model: 'another' }, { ...ai, prompt: 'formal' }]) {
    const service = new TranslationService({ ...settings, ai: profile }, new TranslationCache());
    try { expect(await service.section('Hello world', 'owner', 'visible', new AbortController().signal)).toBe('你好'); } finally { service.destroy(); }
  }
  expect(request).toHaveBeenCalledTimes(3);
  saveSettings(settings); expect(loadSettings()).toEqual(settings);
  expect(JSON.stringify(store.get('ft:settings:v1'))).not.toContain(ai.apiKey);
  expect(JSON.stringify(store.get('ft:translations:v1'))).not.toContain(ai.apiKey);
  expect(normalizeAiBaseUrl('http://localhost:8080/v1/')).toBe('http://localhost:8080/v1');
  expect(() => normalizeAiBaseUrl('http://example.com/v1')).toThrow();
  expect(() => normalizeAiBaseUrl('https://key@example.com/v1')).toThrow();
  expect(() => translateAi('Hello', { ...ai, apiKey: '' }, new AbortController().signal)).toThrow('API Key');
});

it('returns a validated streamed translation before connection close and frees transport', async () => {
  let options: GmRequestOptions | undefined; const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const promise = translateAi('Hello ⟦0⟧', ai, new AbortController().signal);
  options?.onprogress?.({ status: 200, responseText: event({ type: 'response.output_text.delta', delta: '{"section_0":"你好 ⟦0⟧"}' }) });
  expect(await promise).toBe('你好 ⟦0⟧'); expect(abort).toHaveBeenCalledOnce();
});
it('does not accept early JSON with missing protected markers', async () => {
  let options: GmRequestOptions | undefined; const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const controller = new AbortController(); const promise = translateAi('Hello ⟦0⟧', ai, controller.signal);
  options?.onprogress?.({ status: 200, responseText: event({ type: 'response.output_text.delta', delta: '{"section_0":"你好"}' }) });
  expect(abort).not.toHaveBeenCalled();
  const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await assertion;
});

it('times out and aborts even if the userscript transport never invokes a callback', async () => {
  vi.useFakeTimers(); const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', () => ({ abort }));
  const promise = translateAi('Hello', ai, new AbortController().signal);
  const assertion = expect(promise).rejects.toThrow('超过 60 秒');
  await vi.advanceTimersByTimeAsync(60000); await assertion;
  expect(abort).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('publishes partial words before complete JSON and sends bounded neighbor context separately', async () => {
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
  const partial = vi.fn(); const controller = new AbortController();
  const promise = translateAi('Hello', ai, controller.signal, partial, { before: 'Previous paragraph', after: 'Next paragraph' });
  options?.onprogress?.({ status: 200, responseText: event({ type: 'response.output_text.delta', delta: '{"section_0":"你' }) });
  expect(partial).toHaveBeenCalledWith('你');
  expect(options?.data).toContain('Previous paragraph');
  const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await assertion;
});

it('measures the first visible translation instead of JSON syntax or an incomplete protected token', async () => {
  vi.useFakeTimers();
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
  const partial = vi.fn();
  const promise = translateAi('Hello ⟦0⟧', ai, new AbortController().signal, partial);
  let responseText = '';
  const push = (delta: string): void => {
    responseText += event({ type: 'response.output_text.delta', delta });
    options?.onprogress?.({ status: 200, responseText });
  };
  await vi.advanceTimersByTimeAsync(100); push('{"section_0":"');
  await vi.advanceTimersByTimeAsync(200); push('   ⟦');
  expect(partial).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300); push('0⟧你');
  expect(partial).toHaveBeenCalledExactlyOnceWith('   ⟦0⟧你');
  await vi.advanceTimersByTimeAsync(300); push('"}');
  await expect(promise).resolves.toBe('   ⟦0⟧你');
  expect(readTranslationMetrics().samples.at(-1)).toMatchObject({ kind: 'translation', firstContentMs: 600, durationMs: 900, success: true });
});

it('publishes each section state once while later sections and 100 vocabulary deltas arrive', async () => {
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
  const partial = vi.fn(); const vocabulary = vi.fn();
  const promise = translateAiBatch([{ text: 'One', onVocabulary: vocabulary }, { text: 'Two' }], ai, new AbortController().signal, partial);
  let responseText = '';
  const push = (delta: string): void => {
    responseText += event({ type: 'response.output_text.delta', delta });
    options?.onprogress?.({ status: 200, responseText });
  };
  push('{"section_0":"一');
  push('","section_1":"二","vocabulary":[{"section":"section_0","word":"');
  expect(partial.mock.calls).toEqual([[0, '一', false], [0, '一', true], [1, '二', true]]);
  for (let index = 0; index < 100; index++) push('a');
  expect(partial).toHaveBeenCalledTimes(3);
  push('"}]}');
  await expect(promise).resolves.toEqual(['一', '二']);
  expect(partial).toHaveBeenCalledTimes(3);
  expect(vocabulary).toHaveBeenLastCalledWith([{ section: 'section_0', word: 'a'.repeat(100) }], true);
});

it('records first content for a validated non-streaming response', async () => {
  vi.useFakeTimers();
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
  const promise = translateAi('Hello', ai, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(400);
  options?.onload?.({ status: 200, responseText: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"section_0":"你好"}' }] }] }) });
  await expect(promise).resolves.toBe('你好');
  expect(readTranslationMetrics().samples.at(-1)).toMatchObject({ kind: 'translation', firstContentMs: 400, durationMs: 400, success: true });
});

it('reads GM response streams at loadstart before the transport load event', async () => {
  let options: GmRequestOptions | undefined; const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const promise = translateAi('Hello ⟦0⟧', ai, new AbortController().signal);
  expect(options?.responseType).toBe('stream');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); } });
  options?.onloadstart?.({ status: 200, responseText: '', response: stream });
  expect(await promise).toBe('你好 ⟦0⟧'); expect(abort).toHaveBeenCalledOnce();
});


it('sends shared post context once on retry and omits duplicate context for a full post', () => {
  const context = { before: '', after: '', post: 'First\n\nSecond' };
  const full = JSON.parse(aiEntries([{ text: 'First', context }, { text: 'Second', context }])) as { post_context: string; sections: { text: string }[] };
  expect(full.post_context).toBe(''); expect(full.sections.map(section => section.text)).toEqual(['First', 'Second']);
  const retry = JSON.parse(aiEntries([{ text: 'Second', context }])) as { post_context: string; sections: { text: string }[] };
  expect(retry.post_context).toBe('First\n\n⟪section_0⟫'); expect(retry.sections.map(section => section.text)).toEqual(['Second']);
});

it('serializes Reddit thread context once beside the translation targets', () => {
  const thread = { title: 'Topic', body: 'Post body', parents: ['Parent reply'] };
  const context = { before: '', after: '', post: 'One\n\nTwo', thread };
  const payload = JSON.parse(aiEntries([{ text: 'One', context }, { text: 'Two', context }])) as { thread_context: typeof thread; sections: { text: string }[] };
  expect(payload.thread_context).toEqual(thread); expect(payload.sections.map(item => item.text)).toEqual(['One', 'Two']);
  expect(JSON.stringify(payload).match(/Parent reply/g)).toHaveLength(1);
});
it('isolates contexts when combining multiple posts', () => {
  const payload = JSON.parse(aiEntries([{ text: 'One', group: 'a', context: { before: '', after: '', post: 'Post A' } }, { text: 'Two', group: 'b', context: { before: '', after: '', post: 'Post B' } }])) as { contexts: { id: number; post: string }[]; sections: { group: number }[] };
  expect(payload.contexts).toEqual([{ id: 0, post: 'Post A' }, { id: 1, post: 'Post B' }]);
  expect(payload.sections.map(section => section.group)).toEqual([0, 1]);
});

it('deduplicates each post independently without losing retry context or crossing groups', () => {
  const text = 'A substantial example. '.repeat(80);
  const serialized = aiEntries([
    { text, group: 'a', context: { before: '', after: '', post: `Before A\n${text}\nAfter A` } },
    { text, group: 'b', context: { before: '', after: '', post: `Before B\n${text}\nAfter B` } },
  ]);
  const payload = JSON.parse(serialized) as { contexts: { post: string }[]; sections: { id: string; text: string }[] };
  expect(payload.contexts.map(context => context.post)).toEqual(['Before A\n⟪section_0⟫\nAfter A', 'Before B\n⟪section_1⟫\nAfter B']);
  expect(payload.sections.map(section => section.text)).toEqual([text, text]);
  expect(serialized).not.toContain('"before":""');
});
it('reduces repeated request text without losing any shared context', () => {
  const target = 'This is a long paragraph with useful context. '.repeat(30);
  const post = `Earlier context.\n\n${target}\n\nLater context.`;
  const sections = [{ text: target, context: { before: '', after: '', post } }];
  const serialized = aiEntries(sections);
  const payload = JSON.parse(serialized) as { post_context: string; sections: { id: string; text: string }[] };
  expect(payload.post_context.replace('⟪section_0⟫', target)).toBe(post);
  expect(serialized.length).toBeLessThan(JSON.stringify({ post_context: post, sections: payload.sections }).length - 1000);
});
