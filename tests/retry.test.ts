import { afterEach, expect, it, vi } from 'vitest';
import { withTranslationRetry } from '../src/translation/retry';
afterEach(() => vi.useRealTimers());
it('retries transient failures at most twice with backoff', async () => {
  vi.useFakeTimers();
  const operation = vi.fn().mockRejectedValue(new Error('HTTP 503'));
  const result = expect(withTranslationRetry(operation, new AbortController().signal)).rejects.toThrow('HTTP 503');
  await vi.advanceTimersByTimeAsync(999); expect(operation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(operation).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000); await result;
  expect(operation).toHaveBeenCalledTimes(3);
});
it('does not retry authentication failures', async () => {
  const operation = vi.fn().mockRejectedValue(new Error('HTTP 401'));
  await expect(withTranslationRetry(operation, new AbortController().signal)).rejects.toThrow('HTTP 401');
  expect(operation).toHaveBeenCalledOnce();
});
it('cancels a pending retry when the page is destroyed', async () => {
  vi.useFakeTimers(); const controller = new AbortController();
  const operation = vi.fn().mockRejectedValue(new Error('网络错误'));
  const result = expect(withTranslationRetry(operation, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10); controller.abort(); await result;
  await vi.advanceTimersByTimeAsync(4000); expect(operation).toHaveBeenCalledOnce();
});
