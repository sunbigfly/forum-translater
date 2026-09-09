// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { XLongPosts, fullPostText, updateXLongPostFold } from '../src/x-long-posts';
let posts: XLongPosts | undefined;
afterEach(() => { posts?.destroy(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function fixture(note: unknown = { text: 'First paragraph\n\nComplete final sentence beyond the preview.' }, id = '123'): HTMLElement {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div><div data-testid="tweetText" lang="en">First paragraph\n\nComplete</div><button data-testid="tweet-text-show-more-link">Show more</button></div></article>';
  const article = document.querySelector('article'); const source = document.querySelector<HTMLElement>('[data-testid="tweetText"]');
  if (!article || !source) throw new Error('Missing fixture');
  Object.assign(article, { __reactFiber$test: { return: { memoizedProps: { tweet: { id_str: id, note_tweet: note } } } } });
  return source;
}
it('reads normalized and GraphQL full notes only for the matching post', () => {
  expect(fullPostText(fixture())).toContain('beyond the preview.');
  expect(fullPostText(fixture({ note_tweet_results: { result: { text: 'GraphQL complete text' } } }))).toBe('GraphQL complete text');
  expect(fullPostText(fixture({ text: 'Unrelated quoted post' }, '456'))).toBeUndefined();
});
it('keeps the complete source available while the local button only toggles display', () => {
  const source = fixture(); const nativeContent = source.innerHTML; posts = new XLongPosts();
  const body = posts.prepare(source); expect(body.textContent).toContain('beyond the preview.');
  expect(source.innerHTML).toBe(nativeContent); expect(source.hasAttribute('data-ft-long-source')).toBe(true);
  const button = document.querySelector<HTMLButtonElement>('[data-ft-owned="long-post-toggle"]');
  expect(button?.getAttribute('aria-expanded')).toBe('false'); button?.click();
  expect(button?.getAttribute('aria-expanded')).toBe('true'); expect(posts.prepare(source)).toBe(body);
  button?.click(); expect(button?.getAttribute('aria-expanded')).toBe('false'); expect(body.textContent).toContain('beyond the preview.');
  posts.destroy(); expect(source.innerHTML).toBe(nativeContent); expect(source.hasAttribute('data-ft-long-source')).toBe(false);
  expect(document.querySelector('[data-ft-long-post]')).toBeNull();
});
it('leaves native content and expansion intact when the full data is unavailable', () => {
  const source = fixture({ is_expandable: true }); posts = new XLongPosts();
  expect(posts.prepare(source)).toBe(source); expect(source.hasAttribute('data-ft-long-source')).toBe(false);
  expect(document.querySelector('[data-ft-long-more]')).toBeNull();
});
it('preserves a detached feed and removes a stale copy when the host replaces its text', () => {
  const source = fixture(); posts = new XLongPosts(); const body = posts.prepare(source);
  const article = source.closest('article'); article?.remove(); posts.reconcile();
  if (article) document.body.append(article); expect(posts.prepare(source)).toBe(body);
  source.remove(); posts.reconcile(); expect(body.isConnected).toBe(false);
});

it('cuts before a partial translation card and keeps complete original lines', () => {
  document.body.innerHTML = '<div class="ft-long-post-viewport"><div class="source">Original text</div><div data-ft-owned="translation">译文</div></div><div>…</div><button data-ft-owned="long-post-toggle">Show more</button>';
  const viewport = document.querySelector<HTMLElement>('.ft-long-post-viewport');
  const source = document.querySelector<HTMLElement>('.source'); const card = document.querySelector<HTMLElement>('[data-ft-owned="translation"]');
  if (!viewport || !source || !card) throw new Error('Missing fixture');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, width: 500 } as DOMRect);
  const cardRect = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 220, bottom: 450, height: 230 } as DOMRect);
  vi.spyOn(document, 'createRange').mockReturnValue({ selectNodeContents: vi.fn(), getClientRects: () => [{ top: 160, bottom: 180, height: 20 }, { top: 185, bottom: 205, height: 20 }] } as unknown as Range);
  Object.defineProperty(viewport, 'scrollHeight', { value: 500 });
  updateXLongPostFold(source);
  expect(viewport.style.getPropertyValue('--ft-long-post-height')).toBe('105px');
  expect((viewport.nextElementSibling as HTMLElement).hidden).toBe(false);
  expect(document.querySelector<HTMLButtonElement>('[data-ft-owned="long-post-toggle"]')?.hidden).toBe(false);
  cardRect.mockReturnValue({ top: 220, bottom: 400, height: 180 } as DOMRect);
  updateXLongPostFold(source);
  expect(viewport.style.getPropertyValue('--ft-long-post-height')).toBe('none');
  expect((viewport.nextElementSibling as HTMLElement).hidden).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[data-ft-owned="long-post-toggle"]')?.hidden).toBe(true);
});
