import { contentIdentity, sourceSnapshot } from './reddit';

type Data = Record<string, unknown>;
const object = (value: unknown): Data | undefined => value !== null && typeof value === 'object' ? value as Data : undefined;
function tweetData(root: HTMLElement, id: string): Data | undefined {
  const article = root.closest('article[data-testid="tweet"]');
  for (let node: Element | null = root; node && article?.contains(node); node = node.parentElement) {
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
    let fiber = object(key ? (node as unknown as Data)[key] : undefined);
    for (let depth = 0; fiber && depth < 30; depth++, fiber = object(fiber.return)) {
      const tweet = object(object(fiber.memoizedProps)?.tweet);
      if (tweet && (tweet.id_str === id || tweet.rest_id === id)) return tweet;
    }
  }
}
export function fullPostText(root: HTMLElement): string | undefined {
  const id = contentIdentity(root).replace(/^x:status:/, '');
  if (!/^\d+$/.test(id)) return;
  const tweet = tweetData(root, id);
  const note = object(tweet?.note_tweet);
  const result = object(object(note?.note_tweet_results)?.result);
  const text = note?.text ?? result?.text;
  if (typeof text !== 'string' || !text.trim()) return;
  return text;
}
function previewText(source: HTMLElement, fullText: string): string | undefined {
  const snapshot = sourceSnapshot(source);
  for (const br of snapshot.querySelectorAll('br')) br.replaceWith('\n');
  const prefix = (snapshot.textContent ?? '').replace(/\r\n?/g, '\n').trim().replace(/(?:…|\.{3})$/, '').trimEnd();
  // Only extend a verified prefix; links and quoted text can differ from note data.
  if (!prefix || !fullText.startsWith(prefix)) return;
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(fullText)) {
    const end = segment.index + segment.segment.trimEnd().length;
    if (end < prefix.length) continue;
    const lineEnd = fullText.indexOf('\n', prefix.length);
    return fullText.slice(0, lineEnd < 0 ? end : Math.min(end, lineEnd)).trimEnd();
  }
}
interface ExpandedPost {
  source: HTMLElement; body: HTMLElement; wrapper: HTMLElement; more: HTMLElement;
  signature: string; identity: string;
}

// Preserve the native text. Translate the preview through its last sentence;
// expose the remaining source to the translator only after explicit expansion.
export class XLongPosts {
  private posts = new Map<HTMLElement, ExpandedPost>();
  prepare(source: HTMLElement): HTMLElement {
    if (!source.matches('[data-testid="tweetText"]') || source.closest('[data-ft-long-post]')) return source;
    const existing = this.posts.get(source);
    const signature = sourceSnapshot(source).innerHTML; const identity = contentIdentity(source);
    if (existing) {
      if (signature === existing.signature && identity === existing.identity && existing.wrapper.isConnected) return existing.body;
      this.remove(existing);
    }
    const article = source.closest('article[data-testid="tweet"]');
    // A quote has its own identity; never attach the outer post's full text to it.
    if (article?.querySelector('[data-testid="tweetText"]') !== source) return source;
    const more = source.parentElement?.querySelector<HTMLElement>(':scope > [data-testid="tweet-text-show-more-link"]');
    if (!more) return source;
    const text = fullPostText(source)?.replace(/\r\n?/g, '\n').trim();
    if (!text) return source;
    const preview = previewText(source, text);
    if (!preview) return source;
    const remaining = text.slice(preview.length).trimStart();
    const wrapper = document.createElement('div'); wrapper.dataset.ftLongPost = '';
    const viewport = document.createElement('div'); viewport.className = 'ft-long-post-viewport';
    const body = document.createElement('div'); body.dataset.testid = 'tweetText'; body.lang = source.lang;
    body.textContent = preview;
    const remainder = document.createElement('div'); remainder.dataset.ftLongRemainder = ''; remainder.hidden = true;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.ftOwned = 'long-post-toggle';
    button.textContent = 'Show more'; button.setAttribute('aria-expanded', 'false'); button.hidden = !remaining;
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      const expanded = wrapper.toggleAttribute('data-expanded');
      if (expanded && !remainder.childNodes.length) {
        const tail = document.createElement('div'); tail.dataset.testid = 'tweetText'; tail.lang = source.lang; tail.textContent = remaining;
        remainder.append(tail);
      }
      remainder.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? 'Show less' : 'Show more';
    };
    const ellipsis = document.createElement('div'); ellipsis.dataset.ftOwned = 'long-post-ellipsis'; ellipsis.textContent = '…'; ellipsis.setAttribute('aria-hidden', 'true');
    ellipsis.hidden = !remaining;
    viewport.append(body, remainder); wrapper.append(viewport, ellipsis, button); source.after(wrapper);
    source.setAttribute('data-ft-long-source', ''); more.setAttribute('data-ft-long-more', '');
    this.posts.set(source, { source, body, wrapper, more, signature, identity });
    return body;
  }
  reconcile(): void {
    for (const post of this.posts.values()) {
      if (post.source.isConnected !== post.wrapper.isConnected || post.source.parentElement !== post.wrapper.parentElement) this.remove(post);
    }
    const detached = [...this.posts.values()].filter(post => !post.source.isConnected);
    for (const post of detached.slice(0, Math.max(0, detached.length - 50))) this.remove(post);
  }
  private remove(post: ExpandedPost): void {
    post.source.removeAttribute('data-ft-long-source'); post.more.removeAttribute('data-ft-long-more');
    post.wrapper.remove(); this.posts.delete(post.source);
  }
  destroy(): void { for (const post of this.posts.values()) this.remove(post); }
}
