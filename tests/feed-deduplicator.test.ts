// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { FeedDeduplicator } from '../src/feed-deduplicator';
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('hides repeated IDs, retains different posts with identical text, and promotes a remaining copy', () => {
  vi.stubGlobal('location', new URL('https://www.reddit.com/r/popular/'));
  document.body.innerHTML = '<main><shreddit-post id="t3_a">Same title</shreddit-post><shreddit-post post-id="t3_a">Same title</shreddit-post><shreddit-post id="t3_b">Same title</shreddit-post></main>';
  const feed = new FeedDeduplicator(); feed.reconcile();
  const posts = document.querySelectorAll('shreddit-post');
  expect(posts[0]?.hasAttribute('data-ft-duplicate')).toBe(false);
  expect(posts[1]?.hasAttribute('data-ft-duplicate')).toBe(true);
  expect(posts[2]?.hasAttribute('data-ft-duplicate')).toBe(false);
  posts[0]?.remove(); feed.reconcile(); expect(posts[1]?.hasAttribute('data-ft-duplicate')).toBe(false);
  feed.reset(); expect(document.querySelector('[data-ft-duplicate]')).toBeNull();
});
it('recognizes permalink duplicates and restores them on a post detail route', () => {
  vi.stubGlobal('location', new URL('https://old.reddit.com/r/test/'));
  document.body.innerHTML = '<div class="thing link"><a href="/r/test/comments/abc/title/">One</a></div><div class="thing link"><a href="/r/test/comments/abc/title/?sort=new">One</a></div>';
  const feed = new FeedDeduplicator(); feed.reconcile(); expect(document.querySelectorAll('[data-ft-duplicate]')).toHaveLength(1);
  vi.stubGlobal('location', new URL('https://old.reddit.com/r/test/comments/abc/title/'));
  feed.reconcile(); expect(document.querySelector('[data-ft-duplicate]')).toBeNull();
});
