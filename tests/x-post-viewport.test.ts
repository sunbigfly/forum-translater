// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { XPostViewport } from '../src/x-post-viewport';
let view: XPostViewport; let y: number; let path: { pathname: string; search: string }; let scroll: ReturnType<typeof vi.fn>;
function article(documentTop: number, height: number): HTMLElement {
  document.body.innerHTML = '<main data-testid="primaryColumn"><article data-testid="tweet"><a href="/person/status/123"><time>now</time></a><span>post text</span></article></main>';
  const node = document.querySelector<HTMLElement>('article'); if (!node) throw new Error('Missing article');
  node.getBoundingClientRect = () => ({ top: documentTop - y, bottom: documentTop - y + height, height, left: 0, right: 600, width: 600, x: 0, y: documentTop - y, toJSON: () => ({}) }); return node;
}
beforeEach(() => {
  vi.useFakeTimers(); y = 500; path = { pathname: '/home', search: '' }; vi.stubGlobal('location', path);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  scroll = vi.fn((options: ScrollToOptions) => { y = options.top ?? y; }); vi.stubGlobal('scrollTo', scroll);
  view = new XPostViewport();
});
afterEach(() => { view.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function enter(): void { article(520, 180).querySelector('span')?.click(); path.pathname = '/person/status/123'; }
it('restores the same post offset once without changing row height or chasing later scrolling', async () => {
  enter(); view.restore(); await vi.advanceTimersByTimeAsync(100); expect(scroll).not.toHaveBeenCalled();
  path.pathname = '/home'; y = 0; const returned = article(900, 60); returned.style.minHeight = '12px';
  const measure = vi.spyOn(returned, 'getBoundingClientRect');
  await vi.advanceTimersByTimeAsync(300); expect(y).toBe(880); expect(returned.style.minHeight).toBe('12px');
  expect(measure).toHaveBeenCalledTimes(1); expect(scroll).toHaveBeenCalledTimes(1);
  y = 100; await vi.advanceTimersByTimeAsync(5000); expect(y).toBe(100); expect(measure).toHaveBeenCalledTimes(1);
});
it('cancels the pending correction as soon as the user scrolls', async () => {
  enter(); view.restore(); path.pathname = '/home'; article(900, 60);
  await vi.advanceTimersByTimeAsync(100); window.dispatchEvent(new WheelEvent('wheel'));
  y = 100; await vi.advanceTimersByTimeAsync(5000); expect(scroll).not.toHaveBeenCalled();
});
it('does not jump to an old scroll coordinate while the original post is missing', async () => {
  enter(); view.restore(); path.pathname = '/home'; document.body.replaceChildren(); y = 0;
  await vi.advanceTimersByTimeAsync(1000); expect(scroll).not.toHaveBeenCalled();
  article(900, 60); await vi.advanceTimersByTimeAsync(400); expect(y).toBe(880); expect(scroll).toHaveBeenCalledTimes(1);
});
it('does not restore unrelated routes, modified clicks or a viewport of a different width', async () => {
  article(520, 180).querySelector('span')?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); path.pathname = '/person/status/123'; view.restore();
  await vi.advanceTimersByTimeAsync(100); expect(scroll).not.toHaveBeenCalled();
  path.pathname = '/home'; enter(); view.restore(); path.pathname = '/notifications'; await vi.advanceTimersByTimeAsync(100); expect(scroll).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('resize')); path.pathname = '/home'; await vi.advanceTimersByTimeAsync(100); expect(scroll).not.toHaveBeenCalled();
});
it('expires without modifying the page if the feed never returns', async () => {
  enter(); view.restore(); await vi.advanceTimersByTimeAsync(2500);
  path.pathname = '/home'; article(900, 60); await vi.advanceTimersByTimeAsync(5000);
  expect(scroll).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
