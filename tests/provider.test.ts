import { afterEach, expect, it, vi } from 'vitest';
import { requestJson } from '../src/translation/provider';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('ends a request even if the userscript transport never fires timeout or abort callbacks', async () => {
  vi.useFakeTimers(); const abort = vi.fn();
  vi.stubGlobal('GM_xmlhttpRequest', () => ({ abort }));
  const result = requestJson('https://example.com/v1/models', new AbortController().signal);
  const assertion = expect(result).rejects.toThrow('25 秒');
  await vi.advanceTimersByTimeAsync(25000); await assertion;
  expect(abort).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('cleans its watchdog after a synchronous transport failure', async () => {
  vi.useFakeTimers(); vi.stubGlobal('GM_xmlhttpRequest', () => { throw new Error('transport unavailable'); });
  await expect(requestJson('https://example.com/v1/models', new AbortController().signal)).rejects.toThrow('transport unavailable');
  expect(vi.getTimerCount()).toBe(0);
});
