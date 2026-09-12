// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { XLongPosts, fullPostText } from '../src/x-long-posts';
let posts: XLongPosts | undefined;
afterEach(() => { posts?.destroy(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function fixture(note: unknown = { text: 'First paragraph\n\nComplete final sentence beyond the preview. Hidden next sentence.\n\nHidden final paragraph.' }, id = '123'): HTMLElement {
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
it('completes only the preview sentence and mounts the remainder on the first expansion', () => {
  const source = fixture(); const nativeContent = source.innerHTML; posts = new XLongPosts();
  const body = posts.prepare(source); expect(body.textContent).toBe('First paragraph\n\nComplete final sentence beyond the preview.');
  expect(source.innerHTML).toBe(nativeContent); expect(source.hasAttribute('data-ft-long-source')).toBe(true);
  const remainder = document.querySelector<HTMLElement>('[data-ft-long-remainder]');
  expect(remainder?.childNodes).toHaveLength(0); expect(remainder?.hidden).toBe(true);
  const button = document.querySelector<HTMLButtonElement>('[data-ft-owned="long-post-toggle"]');
  expect(button?.hidden).toBe(false);
  expect(button?.getAttribute('aria-expanded')).toBe('false'); button?.click();
  expect(button?.getAttribute('aria-expanded')).toBe('true'); expect(posts.prepare(source)).toBe(body);
  expect(remainder?.textContent).toBe('Hidden next sentence.\n\nHidden final paragraph.'); expect(remainder?.hidden).toBe(false);
  const tail = remainder?.firstChild;
  button?.click(); expect(button?.getAttribute('aria-expanded')).toBe('false'); expect(body.textContent).toContain('beyond the preview.');
  expect(remainder?.hidden).toBe(true); button?.click(); expect(remainder?.firstChild).toBe(tail);
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

it.each([
  ['First sentence.', 'First sentence. Hidden sentence.', 'First sentence.'],
  ['Last sen…', 'Last sentence completes here. Hidden sentence.', 'Last sentence completes here.'],
  ['Last sen...', 'Last sentence completes here. Hidden sentence.', 'Last sentence completes here.'],
  ['Read Dr. Sm', 'Read Dr. Smith today. Hidden sentence.', 'Read Dr. Smith today.'],
  ['→ 503 lessons → 20', '→ 503 lessons → 20 phases → Completely free\n\nHidden paragraph.', '→ 503 lessons → 20 phases → Completely free'],
  ['First paragraph\n\n', 'First paragraph\n\nHidden paragraph.', 'First paragraph'],
])('extends preview %s through its own sentence without pulling in the next one', (preview, text, expected) => {
  const source = fixture({ text }); source.textContent = preview; posts = new XLongPosts();
  expect(posts.prepare(source).textContent).toBe(expected);
  expect(document.querySelector('[data-ft-long-remainder]')?.textContent).toBe('');
});

it('matches native line breaks and hides the toggle when completing the last sentence exhausts the note', () => {
  const source = fixture({ text: 'First paragraph\n\nComplete final sentence.' }); source.innerHTML = 'First paragraph<br><br>Complete'; posts = new XLongPosts();
  expect(posts.prepare(source).textContent).toBe('First paragraph\n\nComplete final sentence.');
  expect(document.querySelector<HTMLButtonElement>('[data-ft-owned="long-post-toggle"]')?.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('[data-ft-owned="long-post-ellipsis"]')?.hidden).toBe(true);
});

it('preserves native expansion when the preview cannot be matched to the note', () => {
  const source = fixture({ text: 'A different full text.' }); posts = new XLongPosts();
  expect(posts.prepare(source)).toBe(source); expect(source.hasAttribute('data-ft-long-source')).toBe(false);
  expect(document.querySelector('[data-ft-long-post]')).toBeNull();
});
