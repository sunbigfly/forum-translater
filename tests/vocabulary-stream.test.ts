import { afterEach, expect, it, vi } from 'vitest';
import { completedVocabularyEntries, requestVocabularyText } from '../src/vocabulary-stream';

afterEach(() => vi.unstubAllGlobals());
it('publishes only complete objects, respecting braces and escaped quotes in strings', () => {
  const entry = { word: 'substantial', memoryExample: 'A "large" {box}.' };
  expect(completedVocabularyEntries(`[${JSON.stringify(entry)},{"word":"cohe`)).toEqual([entry]);
  expect(completedVocabularyEntries('[{"word":"sub')).toEqual([]);
});
it('delivers entries before completion and rejects an interrupted stream', async () => {
  let options: GmRequestOptions | undefined;
  const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const partial = vi.fn(); const controller = new AbortController();
  const pending = requestVocabularyText('https://example.com/responses', controller.signal, { stream: true }, 'test', partial);
  const event = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '[{"word":"substantial"},' })}\n\n`;
  options?.onprogress?.({ status: 200, responseText: event });
  expect(partial).toHaveBeenCalledWith('[{"word":"substantial"},');
  const rejected = expect(pending).rejects.toThrow('未完整结束');
  options?.onload?.({ status: 200, responseText: event });
  await rejected;
  expect(abort).toHaveBeenCalledOnce();
});
it('accepts completed SSE and non-streaming gateway responses', async () => {
  let options: GmRequestOptions | undefined;
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
  const pending = requestVocabularyText('https://example.com/responses', new AbortController().signal, {}, 'test', vi.fn());
  const body = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '[]' })}\n\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`;
  options?.onload?.({ status: 200, responseText: body });
  await expect(pending).resolves.toBe('[]');
  const fallback = requestVocabularyText('https://example.com/responses', new AbortController().signal, {}, 'test', vi.fn());
  options?.onload?.({ status: 200, responseText: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '[]' }] }] }) });
  await expect(fallback).resolves.toBe('[]');
});
it('finishes an empty vocabulary array without waiting for the connection to close', async () => {
  let options: GmRequestOptions | undefined; const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const pending = requestVocabularyText('https://example.com/responses', new AbortController().signal, {}, 'test', vi.fn());
  options?.onprogress?.({ status: 200, responseText: 'data: {"type":"response.output_text.delta","delta":"[]"}\n\n' });
  await expect(pending).resolves.toBe('[]'); expect(abort).toHaveBeenCalledOnce();
});
it('aborts the request and ignores late chunks', async () => {
  let options: GmRequestOptions | undefined;
  const abort = vi.fn(); const partial = vi.fn(); const controller = new AbortController();
  vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
  const pending = requestVocabularyText('https://example.com/responses', controller.signal, {}, 'test', partial);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  options?.onprogress?.({ status: 200, responseText: 'data: {"type":"response.output_text.delta","delta":"[]"}\n\n' });
  expect(partial).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledOnce();
});
