export function retryableTranslationError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === 'AbortError') return false;
  if (/usage_limit_reached/.test(error.message)) return false;
  if (/HTTP\s+(?:401|403|400|404|422)\b/.test(error.message) || /配置|API Key|启动失败/.test(error.message)) return false;
  return /网络|超时|超过 60 秒|流读取|响应|格式|占位符|标记|HTTP\s+(?:408|429|5\d\d)\b/.test(error.message);
}
export async function withTranslationRetry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await operation(); } catch (error) {
      if (attempt >= 2 || signal.aborted || !retryableTranslationError(error)) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, (attempt + 1) * 1000);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    }
  }
}
