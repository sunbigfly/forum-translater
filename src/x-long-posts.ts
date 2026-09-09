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
const pendingFolds = new WeakSet<HTMLElement>();
export function updateXLongPostFold(element: HTMLElement): void {
  const viewport = element.closest<HTMLElement>('.ft-long-post-viewport');
  if (!viewport || pendingFolds.has(viewport)) return;
  pendingFolds.add(viewport);
  requestAnimationFrame(() => {
    pendingFolds.delete(viewport);
    if (!viewport.isConnected) return;
    const frame = viewport.getBoundingClientRect();
    if (frame.width <= 0) return;
    const top = frame.top; const limit = top + 320;
    let bottom = top; let contentBottom = top;
    // Translation cards are indivisible; original text may end at a complete line.
    for (const box of viewport.querySelectorAll<HTMLElement>('[data-ft-owned="translation"]')) {
      if (box.hidden) continue;
      const rect = box.getBoundingClientRect();
      if (rect.height > 0) contentBottom = Math.max(contentBottom, rect.bottom);
      if (rect.height > 0 && rect.bottom <= limit) bottom = Math.max(bottom, rect.bottom);
    }
    const walker = document.createTreeWalker(viewport, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('[data-ft-owned="translation"],[data-ft-original-hidden]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.height > 0) contentBottom = Math.max(contentBottom, rect.bottom);
        if (rect.height > 0 && rect.bottom <= limit) bottom = Math.max(bottom, rect.bottom);
      }
    }
    const height = Math.max(0, Math.ceil(bottom - top));
    const overflowing = contentBottom - top > height + 1;
    const value = overflowing ? `${height}px` : 'none';
    if (viewport.style.getPropertyValue('--ft-long-post-height') !== value) viewport.style.setProperty('--ft-long-post-height', value);
    const ellipsis = viewport.nextElementSibling;
    if (ellipsis instanceof HTMLElement) ellipsis.hidden = !overflowing;
    const button = viewport.parentElement?.querySelector<HTMLElement>(':scope > [data-ft-owned="long-post-toggle"]');
    if (button) button.hidden = !overflowing;
  });
}
interface ExpandedPost {
  source: HTMLElement; body: HTMLElement; wrapper: HTMLElement; more: HTMLElement;
  signature: string; identity: string;
}

// Keep the native React text untouched. Our complete copy shares the normal
// paragraph translator; clipping is purely visual and never limits its input.
export class XLongPosts {
  private posts = new Map<HTMLElement, ExpandedPost>();
  constructor() { window.addEventListener('resize', this.resize); }
  private resize = (): void => { for (const post of this.posts.values()) updateXLongPostFold(post.body); };
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
    const text = fullPostText(source);
    if (!text) return source;
    const wrapper = document.createElement('div'); wrapper.dataset.ftLongPost = '';
    const viewport = document.createElement('div'); viewport.className = 'ft-long-post-viewport';
    const body = document.createElement('div'); body.dataset.testid = 'tweetText'; body.lang = source.lang;
    body.textContent = text;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.ftOwned = 'long-post-toggle';
    button.textContent = 'Show more'; button.setAttribute('aria-expanded', 'false');
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      const expanded = wrapper.toggleAttribute('data-expanded');
      button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? 'Show less' : 'Show more';
    };
    const ellipsis = document.createElement('div'); ellipsis.dataset.ftOwned = 'long-post-ellipsis'; ellipsis.textContent = '…'; ellipsis.setAttribute('aria-hidden', 'true');
    viewport.append(body); wrapper.append(viewport, ellipsis, button); source.after(wrapper);
    updateXLongPostFold(body);
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
  destroy(): void { window.removeEventListener('resize', this.resize); for (const post of this.posts.values()) this.remove(post); }
}
