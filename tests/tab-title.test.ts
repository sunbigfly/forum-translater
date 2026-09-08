// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TabTitle } from '../src/tab-title';
let title: TabTitle;
beforeEach(() => {
  history.replaceState(null, '', '/r/test/comments/abc/post/');
  document.title = 'Is this seat taken? : r/test';
  title = new TabTitle();
});
afterEach(() => { title.destroy(); history.replaceState(null, '', '/'); document.title = ''; });
it('reuses the post translation and preserves subreddit and punctuation', () => {
  title.update('Is this seat taken?', '这个座位有人吗？');
  expect(document.title).toBe('这个座位有人吗？ : r/test');
  title.destroy(); expect(document.title).toBe('Is this seat taken? : r/test');
});
it('reapplies when Reddit restores the native title', async () => {
  title.update('Is this seat taken?', '这个座位有人吗？');
  title.update('Recommended unrelated post', '其他推荐帖子');
  document.title = 'Is this seat taken? : r/test';
  await Promise.resolve();
  expect(document.title).toBe('这个座位有人吗？ : r/test');
});
it('does not replace list pages or a different post title', () => {
  title.update('Other post', '其他帖子');
  expect(document.title).toBe('Is this seat taken? : r/test');
  history.replaceState(null, '', '/r/test/');
  title.update('Is this seat taken?', '这个座位有人吗？');
  expect(document.title).toBe('Is this seat taken? : r/test');
});
it('does not apply late translations or restore old titles over a new route', async () => {
  title.update('Is this seat taken?', '这个座位有人吗？');
  history.replaceState(null, '', '/r/test/comments/def/next/');
  document.title = 'Next post : r/test';
  await Promise.resolve(); title.reset();
  expect(document.title).toBe('Next post : r/test');
  title.update('Next post', '下一篇帖子');
  expect(document.title).toBe('下一篇帖子 : r/test');
});
