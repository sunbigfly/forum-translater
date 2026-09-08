import { translateAi, type TranslationContext } from './ai';
import type { Settings } from '../settings';
import { translationProtectedTokensMatch } from './translation-text';
export function requestJson(url: string, signal: AbortSignal, body?: unknown, key?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let settled = false;
    let handle: { abort(): void } | undefined;
    const finish = (action: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); action(); };
    const abort = (): void => { finish(() => reject(new DOMException('已取消', 'AbortError'))); handle?.abort(); };
    const timer = setTimeout(() => { finish(() => reject(new Error('请求超时（25 秒），请重试'))); handle?.abort(); }, 25000);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers.Authorization = `Bearer ${key}`;
    try { handle = GM_xmlhttpRequest({
      method: body === undefined ? 'GET' : 'POST', url, headers,
      ...(body === undefined ? {} : { data: JSON.stringify(body) }), timeout: 25000, anonymous: true,
      onload: response => finish(() => {
        if (response.status < 200 || response.status >= 300) { reject(new Error(`翻译服务 HTTP ${response.status}`)); return; }
        try { resolve(JSON.parse(response.responseText) as unknown); } catch { reject(new Error('翻译服务响应格式错误')); }
      }),
      onerror: () => finish(() => reject(new Error('翻译网络失败，请检查连接与油猴域名授权'))),
      ontimeout: () => finish(() => reject(new Error('翻译超时'))),
      onabort: () => finish(() => reject(new DOMException('已取消', 'AbortError'))),
    }); } catch (error) { finish(() => reject(error instanceof Error ? error : new Error('请求启动失败'))); }
    if (!settled) signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
export function validateTranslation(source: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('翻译服务未返回有效译文');
  const text = value.replace(/⟦([\d\p{Cf}\p{White_Space}]+)⟧/gu, (_match, digits: string) => `⟦${digits.replace(/[\p{Cf}\p{White_Space}]/gu, '')}⟧`).trim();
  if (!translationProtectedTokensMatch(source, text)) throw new Error('译文未保留链接或代码标记，请重试');
  return text;
}
export async function translate(source: string, settings: Settings, signal: AbortSignal, onPartial?: (text: string) => void, context?: TranslationContext): Promise<string> {
  let value: unknown;
  if (settings.provider === 'ai') {
    value = await translateAi(source, settings.ai, signal, onPartial, context);
  } else if (settings.provider === 'google') {
    // Ported from HN TranslationService.#google; one bounded section per request.
    const url = new URL('https://translate.googleapis.com/translate_a/t');
    for (const [key, val] of Object.entries({ client: 'dict-chrome-ex', sl: 'auto', tl: 'zh-CN', q: source })) url.searchParams.set(key, val);
    const data = await requestJson(url.href, signal);
    value = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0][0] : data[0]) : undefined;
  } else if (settings.provider === 'microsoft') {
    // Translator's public webpage API, following the source project's token flow.
    const token = await microsoftToken(signal);
    const data = await requestJson('https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans', signal, [{ Text: source }], token);
    const translations = record(Array.isArray(data) ? data[0] : undefined).translations;
    value = record(Array.isArray(translations) ? translations[0] : undefined).text;
  }
  return validateTranslation(source, value);
}
let tokenValue = '';
let tokenExpires = 0;
function microsoftToken(signal: AbortSignal): Promise<string> {
  if (tokenValue && Date.now() < tokenExpires) return Promise.resolve(tokenValue);
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = (fn: () => void): void => { signal.removeEventListener('abort', abort); fn(); };
    const abort = (): void => { handle.abort(); done(() => reject(new DOMException('已取消', 'AbortError'))); };
    const handle = GM_xmlhttpRequest({ method: 'GET', url: 'https://edge.microsoft.com/translate/auth', timeout: 15000, anonymous: true,
      onload: response => done(() => {
        if (response.status !== 200 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(response.responseText.trim())) { reject(new Error('Microsoft 翻译授权失败')); return; }
        tokenValue = response.responseText.trim(); tokenExpires = Date.now() + 5 * 60000; resolve(tokenValue);
      }),
      onerror: () => done(() => reject(new Error('Microsoft 翻译授权网络失败'))),
      ontimeout: () => done(() => reject(new Error('Microsoft 翻译授权超时'))),
      onabort: () => done(() => reject(new DOMException('已取消', 'AbortError'))),
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
