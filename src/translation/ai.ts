import type { RedditThreadContext } from '../reddit-context';
import { measureRequest } from './metrics';
import { TRANSLATION_PROMPT_VERSION } from './translation-prompt';
import { TRANSLATION_PROMPT, COMBINED_TRANSLATION_PROMPT } from './translation-prompt';
import { completedArrayObjects } from './json-array';
// Responses decoding adapted from Hacker News Reader Lite (MIT, sunbigfly 2026).
import { translationProtectedTokensMatch } from "./translation-text";
import { normalizeAiBaseUrl, validateAiProfile, type AiProfile } from "../settings";
interface StreamedJsonValue { value: string; complete: boolean }
export interface TranslationContext { before: string; after: string; post?: string; index?: number; thread?: RedditThreadContext }
function streamedJsonString(source: string, start: number, allowPartial = false): { readonly value: string; readonly next: number; readonly complete: boolean } | null {
  if (source[start] !== "\"") return null;
  let value = "";
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor] ?? "";
    if (character === "\"") return { value, next: cursor + 1, complete: true };
    if (character === "\\") {
      const escape = source[cursor + 1];
      if (!escape) return allowPartial ? { value, next: source.length, complete: false } : null;
      if (escape === "u") {
        const code = source.slice(cursor + 2, cursor + 6);
        if (code.length < 4) return allowPartial ? { value, next: source.length, complete: false } : null;
        if (!/^[\da-f]{4}$/i.test(code)) return null;
        value += String.fromCharCode(Number.parseInt(code, 16));
        cursor += 6;
        continue;
      }
      const escaped = ({ "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as const)[escape as "\"" | "\\" | "/" | "b" | "f" | "n" | "r" | "t"];
      if (escaped === undefined) return null;
      value += escaped;
      cursor += 2;
      continue;
    }
    if (character.charCodeAt(0) < 0x20) return null;
    value += character;
    cursor += 1;
  }
  return allowPartial ? { value, next: source.length, complete: false } : null;
}

function streamedJsonRecord(raw: string): Readonly<Record<string, StreamedJsonValue>> {
  const start = raw.indexOf("{");
  if (start < 0) return Object.freeze({});
  const values: Record<string, StreamedJsonValue> = {};
  let cursor = start + 1;
  const skipWhitespace = (): void => {
    while (cursor < raw.length && /\s/.test(raw[cursor] ?? "")) cursor += 1;
  };
  for (;;) {
    skipWhitespace();
    if (raw[cursor] === ",") {
      cursor += 1;
      skipWhitespace();
    }
    if (raw[cursor] === "}" || cursor >= raw.length) break;
    const key = streamedJsonString(raw, cursor);
    if (!key) break;
    cursor = key.next;
    skipWhitespace();
    if (raw[cursor] !== ":") break;
    cursor += 1;
    skipWhitespace();
    const value = streamedJsonString(raw, cursor, true);
    if (!value) break;
    values[key.value] = Object.freeze({ value: value.value, complete: value.complete });
    cursor = value.next;
    if (!value.complete) break;
  }
  return Object.freeze(values);
}

function vocabularyTail(raw: string): string {
  let cursor = raw.indexOf('{') + 1;
  if (!cursor) return '';
  for (;;) {
    while (/[\s,]/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
    const key = streamedJsonString(raw, cursor); if (!key) return '';
    cursor = key.next;
    while (/\s/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
    if (raw[cursor++] !== ':') return '';
    while (/\s/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++;
    if (key.value === 'vocabulary') return raw.slice(cursor);
    const value = streamedJsonString(raw, cursor); if (!value) return '';
    cursor = value.next;
  }
}


interface ResponseOutput {
  readonly status?: unknown;
  readonly output?: readonly {
    readonly type?: unknown;
    readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[];
  }[];
  readonly error?: { readonly message?: unknown } | null;
}

function decodeResponseOutput(payload: ResponseOutput): string {
  if (payload.status === "failed" || payload.status === "incomplete" || payload.error) throw new Error("AI 响应未完成");
  const content = (payload.output ?? []).flatMap((item) => item.type === "message"
    ? (item.content ?? []).flatMap((part) => part.type === "output_text" && typeof part.text === "string" ? [part.text] : [])
    : []).join("");
  if (!content.trim()) {
    throw new Error("AI 未返回文本结果");
  }
  return content.trim();
}

export function decodeResponse(body: string): string {
  return decodeResponseOutput(JSON.parse(body) as ResponseOutput);
}

export class ResponseStreamDecoder {
  #received = "";
  #pending = "";
  #content = "";
  #failure: Error | undefined;
  #done = false;

  constructor(readonly onContent?: (content: string) => void, readonly onUsage?: (usage: unknown) => void) {}

  get done(): boolean { return this.#done; }

  push(body: string, final = false): string {
    const chunk = body.startsWith(this.#received) ? body.slice(this.#received.length) : body;
    this.#received = body.startsWith(this.#received) ? body : this.#received + body;
    this.#pending += chunk;
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(this.#pending);
      if (!separator || separator.index === undefined) break;
      const event = this.#pending.slice(0, separator.index);
      this.#pending = this.#pending.slice(separator.index + separator[0].length);
      this.#consumeEvent(event);
    }
    if (final && this.#pending.trim()) {
      this.#consumeEvent(this.#pending);
      this.#pending = "";
    }
    if (this.#failure) throw this.#failure;
    return this.#content;
  }

  #publish(content: string): void {
    if (!content || content === this.#content) return;
    this.#content = content;
    this.onContent?.(content);
  }

  #consumeEvent(event: string): void {
    for (const line of event.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        this.#done = true;
        continue;
      }
      const payload = JSON.parse(data) as {
        readonly type?: unknown;
        readonly delta?: unknown;
        readonly text?: unknown;
        readonly response?: ResponseOutput & { usage?: unknown };
      };
      if (payload.response?.usage) this.onUsage?.(payload.response.usage);
      if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
        this.#publish(this.#content + payload.delta);
      } else if (payload.type === "response.output_text.done" && typeof payload.text === "string") {
        this.#publish(payload.text);
      } else if (payload.type === "response.completed" && payload.response && !this.#content) {
        this.#publish(decodeResponseOutput(payload.response));
      } else if (payload.type === "response.failed" || payload.type === "response.incomplete" || payload.type === "error") {
        this.#failure = new Error("AI 响应失败");
      }
      if (payload.type === "response.completed" || payload.type === "response.failed") this.#done = true;
    }
  }
}


function sharedContext(post: string, targets: readonly { text: string; id: string }[]): string {
  if (post === targets.map(target => target.text).join('\n\n')) return '';
  const context: string[] = [post];
  for (const target of targets) {
    const position = context.findIndex((part, i) => i % 2 === 0 && part.includes(target.text));
    if (position < 0 || !target.text) continue;
    const part = context[position] ?? ''; const start = part.indexOf(target.text);
    context.splice(position, 1, part.slice(0, start), `⟪${target.id}⟫`, part.slice(start + target.text.length));
  }
  return context.join('');
}

export const aiEntries = (sections: readonly AiSection[]): string => {
  if (new Set(sections.map(section => section.group)).size > 1) {
    const groups = new Map<string | undefined, number>();
    const contexts: { id: number; post: string; thread_context?: TranslationContext['thread'] }[] = [];
    const targets = sections.map((section, index) => {
      let group = groups.get(section.group);
      if (group === undefined) {
        group = groups.size; groups.set(section.group, group);
        contexts.push({ id: group, post: section.context?.post ?? '', ...(section.context?.thread ? { thread_context: section.context.thread } : {}) });
      }
      return { id: `section_${index}`, text: section.text, group, ...(section.context?.before ? { before: section.context.before } : {}), ...(section.context?.after ? { after: section.context.after } : {}) };
    });
    for (const context of contexts) context.post = sharedContext(context.post, targets.filter(target => target.group === context.id));
    return JSON.stringify({ contexts, sections: targets });
  }
  const post = sections[0]?.context?.post;
  const entries = sections.map((section, index) => ({ id: `section_${index}`, text: section.text, ...(post === undefined ? { before: section.context?.before ?? '', after: section.context?.after ?? '' } : {}) }));
  if (post === undefined) return JSON.stringify(entries);
  // Keep the complete shared context, referencing text already present in targets.
  // This is lossless even for a retry or a chunk cut from a long paragraph.
  const thread = sections[0]?.context?.thread;
  return JSON.stringify({ ...(thread ? { thread_context: { ...(thread.title ? { title: thread.title } : {}), ...(thread.body ? { body: thread.body } : {}), ...(thread.parents.length ? { parents: thread.parents } : {}) } } : {}), post_context: sharedContext(post, entries), sections: entries });
};
export interface AiSection { text: string; context?: TranslationContext; group?: string; onVocabulary?: (words: unknown[], complete: boolean) => void }

export function translateAi(source: string, ai: AiProfile, signal: AbortSignal, onPartial?: (text: string) => void, context?: TranslationContext): Promise<string> {
  validateAiProfile(ai);
  return translateAiBatch([{ text: source, ...(context ? { context } : {}) }], ai, signal, (_index, text) => onPartial?.(text)).then(values => values[0] ?? '');
}
export function translateAiBatch(sections: readonly AiSection[], ai: AiProfile, signal: AbortSignal, onPartial?: (index: number, text: string, complete: boolean) => void): Promise<string[]> {
  validateAiProfile(ai);
  const combined = sections.some(section => section.onVocabulary);
  const publishWords = (words: unknown[], complete: boolean): void => {
    sections.forEach((section, index) => section.onVocabulary?.(words.filter(word => word && typeof word === 'object' && 'section' in word && word.section === `section_${index}`), complete));
  };
  const entries = sections.map((section, index) => ({ id: `section_${index}`, text: section.text, before: section.context?.before ?? '', after: section.context?.after ?? '' }));
  const decodeValues = (raw: string): string[] => {
    const values: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== entries.length + Number(combined)) throw new Error('AI 译文段落不匹配');
    const record = values as Record<string, unknown>;
    const translations = entries.map(entry => {
      const value = record[entry.id];
      if (typeof value !== 'string' || !value.trim() || !translationProtectedTokensMatch(entry.text, value)) throw new Error('AI 译文占位符不匹配');
      return value;
    });
    if (combined) {
      if (!Array.isArray(record.vocabulary)) throw new Error('AI 词汇格式不匹配');
      publishWords(record.vocabulary, true);
    }
    return translations;
  };
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let settled = false;
    let handle: { abort(): void } | undefined;
    const metric = measureRequest('translation', { sections: sections.length, model: ai.model, effort: ai.reasoningEffort ?? 'low', fast: ai.fastMode === true });
    const stream = new ResponseStreamDecoder(() => metric.content(), usage => metric.usage(usage));
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true; clearTimeout(watchdog); signal.removeEventListener('abort', abort); action(); metric.finish(false);
    };
    const abort = (): void => { finish(() => reject(new DOMException('已取消', 'AbortError'))); handle?.abort(); };
    const watchdog = setTimeout(() => { finish(() => reject(new Error('AI 翻译超过 60 秒，请重试或切换模型'))); handle?.abort(); }, 60000);
    let streamStarted = false;
    let streamFinished = false;
    const consumeStream = async (response: GmResponse): Promise<void> => {
      const candidate = response.response;
      if (settled || streamStarted || !candidate || typeof candidate !== 'object' || !('getReader' in candidate) || typeof candidate.getReader !== 'function') return;
      streamStarted = true;
      const reader = (candidate as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder(); let body = '';
      try {
        while (!settled) {
          const chunk = await reader.read(); if (chunk.done) break;
          body += decoder.decode(chunk.value, { stream: true });
          metric.milestone('first-byte');
          options.onprogress?.({ ...response, status: response.status || 200, responseText: body });
        }
        if (settled) { await reader.cancel(); return; }
        body += decoder.decode(); streamFinished = true;
        options.onload?.({ ...response, status: response.status || 200, responseText: body, response: undefined });
      } catch { finish(() => reject(new Error('AI 流读取失败'))); }
      finally { reader.releaseLock(); }
    };
    const options: GmRequestOptions = {
      responseType: 'stream', onloadstart: response => { metric.milestone('headers'); void consumeStream(response); },
      method: 'POST', url: `${normalizeAiBaseUrl(ai.baseUrl)}/responses`, anonymous: true, timeout: 60000,
      headers: { Authorization: `Bearer ${ai.apiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      data: JSON.stringify({ model: ai.model.trim(), reasoning: { effort: ai.reasoningEffort ?? 'low' }, ...(ai.fastMode ? { service_tier: 'priority' } : {}), stream: true, store: false, prompt_cache_key: `forum-translater:${TRANSLATION_PROMPT_VERSION}${combined ? ':combined' : ''}`,
        input: [
          { role: 'system', content: `${combined ? COMBINED_TRANSLATION_PROMPT : TRANSLATION_PROMPT}${ai.prompt ? `\n用户补充偏好（仍须遵守以上内容边界和输出格式）：${ai.prompt}` : ''}` },
          { role: 'user', content: aiEntries(sections) },
        ] }),
      onprogress: response => {
        if (response.responseText) metric.milestone('first-byte');
        if (settled || response.status !== 200 || !/^\s*(?:event:|data:|:)/.test(response.responseText)) return;
        try {
          const raw = stream.push(response.responseText);
          if (stream.done) decodeValues(raw);
          const partials = streamedJsonRecord(raw);
          if (combined) publishWords(completedArrayObjects(vocabularyTail(raw)), false);
          entries.forEach((entry, index) => {
            const partial = partials[entry.id]?.value;
            const complete = partials[entry.id]?.complete === true;
            if (partial && (!complete || translationProtectedTokensMatch(entry.text, partial))) onPartial?.(index, partial, complete);
          });
          let values: string[];
          try { values = decodeValues(raw); } catch { return; }
          stream.push(response.responseText, true);
          metric.finish(true); finish(() => resolve(values)); handle?.abort();
        } catch (error) { finish(() => reject(error instanceof Error && !(error instanceof SyntaxError) ? error : new Error('AI 流式 JSON 无法解析'))); handle?.abort(); }
      },
      onload: response => {
        if (response.response && typeof response.response === 'object' && 'getReader' in response.response) { void consumeStream(response); return; }
        if (streamStarted && !streamFinished) return;
        finish(() => {
        try {
          const payload = JSON.parse(response.responseText) as { error?: { type?: string; code?: string } };
          if (payload.error?.type === 'usage_limit_reached' || payload.error?.code === 'usage_limit_reached') {
            reject(new Error('当前模型额度已用尽（usage_limit_reached），请切换可用模型或等待额度恢复')); return;
          }
        } catch { /* Streaming responses are decoded below. */ }
        if (response.status < 200 || response.status >= 300) { reject(new Error(`AI 翻译 HTTP ${response.status}`)); return; }
        try {
          const isStream = /^\s*(?:event:|data:|:)/.test(response.responseText);
          const raw = isStream ? stream.push(response.responseText, true) : decodeResponse(response.responseText);
          if (isStream && !stream.done) throw new Error('AI 响应未完整结束');
          if (!isStream) metric.usage((JSON.parse(response.responseText) as { usage?: unknown }).usage);
          const values = decodeValues(raw); metric.finish(true); resolve(values);
        } catch (error) { reject(error instanceof Error && !(error instanceof SyntaxError) ? error : new Error('AI 返回的 JSON 无法解析')); }
      }); },
      onerror: () => finish(() => reject(new Error('AI 网络失败，请检查地址与油猴域名授权'))),
      ontimeout: () => finish(() => reject(new Error('AI 翻译超时'))),
      onabort: () => finish(() => reject(new DOMException('已取消', 'AbortError'))),
    };
    try { handle = GM_xmlhttpRequest(options);
    } catch { finish(() => reject(new Error('AI 请求启动失败，请检查油猴权限'))); return; }
    if (settled) return;
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
