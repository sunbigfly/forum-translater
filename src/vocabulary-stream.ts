import { decodeResponse, ResponseStreamDecoder } from './translation/ai';
import { measureRequest } from './translation/metrics';

// Only publish complete array entries; braces inside JSON strings are ordinary text.
export function completedVocabularyEntries(text: string): unknown[] {
  const source = text.trim().replace(/^```(?:json)?\s*/i, '');
  if (!source.startsWith('[')) return [];
  const result: unknown[] = [];
  let start = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = 1; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth++ === 0) start = index; }
    else if (char === '}' && depth > 0 && --depth === 0) {
      try { result.push(JSON.parse(source.slice(start, index + 1)) as unknown); } catch { return result; }
    }
  }
  return result;
}

export function requestVocabularyText(url: string, signal: AbortSignal, body: unknown, key: string, onPartial: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let settled = false; let handle: { abort(): void } | undefined;
    let reading = false; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const metric = measureRequest('vocabulary');
    const stream = new ResponseStreamDecoder(text => { metric.content(); onPartial(text); }, usage => metric.usage(usage));
    const finish = (error?: Error, text = ''): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      metric.finish(!error);
      if (error) { reject(error); handle?.abort(); void reader?.cancel().catch(() => undefined); }
      else resolve(text);
    };
    const abort = (): void => finish(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('词汇生成超时')), 60000);
    const progress = (text: string): void => {
      if (settled || !/^\s*(?:event:|data:|:)/.test(text)) return;
      try {
        const value = stream.push(text);
        let decoded: unknown;
        try { decoded = JSON.parse(value); } catch { return; }
        if (Array.isArray(decoded)) {
          finish(undefined, value); handle?.abort(); void reader?.cancel().catch(() => undefined);
        }
      } catch { finish(new Error('词汇流式响应格式错误')); }
    };
    const complete = (response: GmResponse): void => {
      if (settled) return;
      if (response.status < 200 || response.status >= 300) { finish(new Error(`词汇服务 HTTP ${response.status}`)); return; }
      try {
        const isStream = /^\s*(?:event:|data:|:)/.test(response.responseText);
        const text = isStream ? stream.push(response.responseText, true) : decodeResponse(response.responseText);
        if (!isStream) metric.usage((JSON.parse(response.responseText) as { usage?: unknown }).usage);
        if (isStream && !stream.done) throw new Error('词汇响应未完整结束');
        finish(undefined, text);
      } catch (error) { finish(error instanceof Error ? error : new Error('词汇响应格式错误')); }
    };
    const consume = async (response: GmResponse): Promise<void> => {
      const candidate = response.response;
      if (reading || settled || !candidate || typeof candidate !== 'object' || !('getReader' in candidate)) return;
      reading = true; reader = (candidate as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder(); let text = '';
      try {
        while (!settled) {
          const chunk = await reader.read(); if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
          if (!response.status || response.status === 200) progress(text);
        }
        text += decoder.decode(); complete({ ...response, status: response.status || 200, responseText: text });
      } catch { finish(new Error('词汇流读取失败')); }
      finally { reader.releaseLock(); }
    };
    try {
      handle = GM_xmlhttpRequest({ method: 'POST', url, anonymous: true, timeout: 60000, responseType: 'stream',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, data: JSON.stringify(body),
        onloadstart: response => { void consume(response); },
        onprogress: response => { if (!reading && response.status === 200) progress(response.responseText); },
        onload: response => { if (response.response && typeof response.response === 'object' && 'getReader' in response.response) void consume(response); else if (!reading) complete(response); },
        onerror: () => finish(new Error('词汇网络请求失败')),
        ontimeout: () => finish(new Error('词汇生成超时')), onabort: abort,
      });
    } catch { finish(new Error('词汇请求启动失败')); }
    if (!settled) signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
