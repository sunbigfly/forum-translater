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

it('restores nested Post scrolling inside the modal and retains the feed snapshot for the next return', async () => {
  enter();
  const nested = article(540, 180);
  const surface = document.createElement('div'); surface.setAttribute('data-ft-x-native-post', '');
  const primary = nested.parentElement; if (!primary) throw new Error('Missing primary');
  surface.append(primary); document.body.append(surface);
  const scrollModal = vi.fn(); surface.scrollTop = 300; surface.scrollTo = scrollModal;
  nested.querySelector('span')?.click(); path.pathname = '/person/status/456';
  view.restore(); path.pathname = '/person/status/123'; y = 480;
  await vi.advanceTimersByTimeAsync(400);
  expect(scrollModal).toHaveBeenCalledWith({ top: 320, left: 0, behavior: 'instant' });
  expect(scroll).not.toHaveBeenCalled();
  view.restore(); path.pathname = '/home'; y = 0; article(900, 60);
  await vi.advanceTimersByTimeAsync(400);
  expect(scroll).toHaveBeenCalledOnce(); expect(y).toBe(880);
});

function postModal() {
  const surface = document.createElement('div'); surface.setAttribute('data-ft-x-native-post', '');
  surface.innerHTML = '<main data-testid="primaryColumn"><header style="position:sticky"><button data-testid="app-bar-back"></button></header><article data-testid="tweet"><a href="/parent/status/111"><time>parent</time></a></article><article data-testid="tweet"><a href="/person/status/123"><time>target</time></a></article></main>';
  document.body.append(surface);
  const rect = (top: number, height: number): DOMRect => ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) });
  surface.getBoundingClientRect = () => rect(0, 800);
  const header = surface.querySelector('header'); if (!header) throw new Error('Missing header');
  header.getBoundingClientRect = () => rect(0, 60);
  const target = surface.querySelector<HTMLElement>('article:last-child'); if (!target) throw new Error('Missing target');
  target.getBoundingClientRect = () => rect(1000 - surface.scrollTop, 200);
  const scrollModal = vi.fn((options?: ScrollToOptions | number) => { surface.scrollTop = typeof options === 'number' ? options : options?.top ?? surface.scrollTop; });
  surface.scrollTo = scrollModal;
  return { surface, target, scrollModal };
}

it('opens the route target below the sticky header, ignoring the parent thread and retained background', async () => {
  article(520, 180); const { surface, scrollModal } = postModal();
  path.pathname = '/person/status/123'; view.reconcile();
  await vi.advanceTimersByTimeAsync(250);
  expect(scrollModal).toHaveBeenCalledExactlyOnceWith({ top: 928, left: 0, behavior: 'instant' });
  expect(scroll).not.toHaveBeenCalled();
  surface.scrollTop = 300; view.reconcile(); await vi.advanceTimersByTimeAsync(5000);
  expect(surface.scrollTop).toBe(300); expect(scrollModal).toHaveBeenCalledOnce();
});

it('waits for the modal and target to render and measures the final layout', async () => {
  path.pathname = '/person/status/123'; view.reconcile();
  await vi.advanceTimersByTimeAsync(300); const { surface, target, scrollModal } = postModal();
  const parent = target.parentElement; target.remove();
  await vi.advanceTimersByTimeAsync(300); expect(scrollModal).not.toHaveBeenCalled();
  parent?.append(target); await vi.advanceTimersByTimeAsync(100);
  surface.scrollTop = 100;
  await vi.advanceTimersByTimeAsync(250);
  expect(surface.scrollTop).toBe(928); expect(scrollModal).toHaveBeenCalledOnce();
});

it.each(['wheel', 'touchstart', 'pointerdown', 'resize', 'keydown'])('cancels entry positioning on %s', async event => {
  const { scrollModal } = postModal(); path.pathname = '/person/status/123'; view.reconcile();
  await vi.advanceTimersByTimeAsync(100);
  window.dispatchEvent(event === 'keydown' ? new KeyboardEvent('keydown', { key: 'PageDown' }) : new Event(event));
  view.reconcile(); await vi.advanceTimersByTimeAsync(5500);
  expect(scrollModal).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('positions another Post when the modal is reused for a nested route', async () => {
  const { surface, target, scrollModal } = postModal();
  path.pathname = '/person/status/123'; view.reconcile(); await vi.advanceTimersByTimeAsync(250);
  target.querySelector('a')?.setAttribute('href', '/person/status/456'); surface.scrollTop = 0;
  path.pathname = '/person/status/456'; view.reconcile(); await vi.advanceTimersByTimeAsync(250);
  expect(scrollModal).toHaveBeenCalledTimes(2); expect(surface.scrollTop).toBe(928);
});

it('lets return restoration keep the clicked row offset instead of focusing the parent Post', async () => {
  path.pathname = '/person/status/123'; const { surface, target, scrollModal } = postModal();
  view.reconcile(); await vi.advanceTimersByTimeAsync(250); scrollModal.mockClear();
  const reply = target.cloneNode(true) as HTMLElement;
  reply.querySelector('a')?.setAttribute('href', '/person/status/456');
  reply.getBoundingClientRect = () => Object.assign(target.getBoundingClientRect(), { top: 1200 - surface.scrollTop, bottom: 1400 - surface.scrollTop });
  target.parentElement?.append(reply); surface.scrollTop = 800; reply.click();
  path.pathname = '/person/status/456'; view.reconcile(); await vi.advanceTimersByTimeAsync(250);
  scrollModal.mockClear(); view.restore(); path.pathname = '/person/status/123'; surface.scrollTop = 300; view.reconcile();
  await vi.advanceTimersByTimeAsync(400);
  expect(scrollModal).toHaveBeenCalledExactlyOnceWith({ top: 800, left: 0, behavior: 'instant' });
});

it('abandons entry positioning on route changes, missing targets and teardown', async () => {
  const { target, scrollModal } = postModal(); path.pathname = '/person/status/123'; view.reconcile();
  await vi.advanceTimersByTimeAsync(100); path.pathname = '/notifications';
  await vi.advanceTimersByTimeAsync(300); expect(scrollModal).not.toHaveBeenCalled();
  view.reconcile(); target.remove(); path.pathname = '/person/status/456'; view.reconcile();
  await vi.advanceTimersByTimeAsync(5500); expect(scrollModal).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  path.pathname = '/person/status/123'; view.reconcile(); view.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
