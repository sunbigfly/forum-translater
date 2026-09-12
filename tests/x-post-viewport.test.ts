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
  const completedMeasurements = measure.mock.calls.length;
  expect(completedMeasurements).toBeLessThanOrEqual(4); expect(scroll).toHaveBeenCalledTimes(1);
  y = 100; await vi.advanceTimersByTimeAsync(5000); expect(y).toBe(100); expect(measure).toHaveBeenCalledTimes(completedMeasurements);
});
it('cancels the pending correction as soon as the user scrolls', async () => {
  enter(); view.reconcile(); view.restore(); window.dispatchEvent(new WheelEvent('wheel'));
  path.pathname = '/home'; article(900, 60); view.reconcile();
  y = 100; await vi.advanceTimersByTimeAsync(5000); expect(scroll).not.toHaveBeenCalled(); expect(y).toBe(100);
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

it('restores as soon as the route is ready and corrects native restoration on the next frame', async () => {
  enter(); view.reconcile(); view.restore(); path.pathname = '/home'; y = 0; article(900, 60);
  view.reconcile(); expect(y).toBe(880); expect(scroll).toHaveBeenCalledOnce();
  await Promise.resolve();
  y = 200; await vi.advanceTimersByTimeAsync(20);
  expect(y).toBe(880); expect(scroll).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});

it.each([390, 1280])('waits for an ineffective native scroll lock to release at %i px without polling', async width => {
  vi.stubGlobal('innerWidth', width);
  enter(); view.restore(); path.pathname = '/home'; y = 0; const returned = article(900, 60);
  let locked = true; scroll.mockImplementation((options: ScrollToOptions) => { if (!locked) y = options.top ?? y; });
  view.reconcile(); expect(y).toBe(0);
  await vi.advanceTimersByTimeAsync(32); const lockedAttempts = scroll.mock.calls.length;
  await vi.advanceTimersByTimeAsync(400); expect(scroll).toHaveBeenCalledTimes(lockedAttempts); expect(y).toBe(0);
  locked = false; returned.parentElement?.style.setProperty('overflow', 'visible');
  await vi.advanceTimersByTimeAsync(0); expect(y).toBe(880);
  await vi.advanceTimersByTimeAsync(20); expect(scroll).toHaveBeenCalledTimes(lockedAttempts + 1); expect(vi.getTimerCount()).toBe(0);
});

it.each([390, 1280])('corrects a native overwrite in the same DOM batch at %i px without waiting for a frame', async width => {
  vi.stubGlobal('innerWidth', width);
  enter(); view.restore(); path.pathname = '/home'; y = 0; const returned = article(900, 60);
  const measure = vi.spyOn(returned, 'getBoundingClientRect'); view.reconcile(); expect(y).toBe(880);
  y = 200; await Promise.resolve(); expect(y).toBe(880); expect(scroll).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20); const completedMeasurements = measure.mock.calls.length;
  expect(completedMeasurements).toBeLessThanOrEqual(5);
  y = 100; await vi.advanceTimersByTimeAsync(2500); expect(y).toBe(100); expect(measure).toHaveBeenCalledTimes(completedMeasurements);
});

it.each([390, 1280])('cancels the queued same-batch correction at %i px when the user takes control', async width => {
  vi.stubGlobal('innerWidth', width);
  enter(); view.restore(); path.pathname = '/home'; y = 0; article(900, 60); view.reconcile();
  window.dispatchEvent(new Event('pointerdown')); y = 200; view.reconcile();
  await Promise.resolve(); expect(y).toBe(200);
  await vi.advanceTimersByTimeAsync(2500); expect(y).toBe(200); expect(scroll).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('does not override user scrolling during the final native-restoration frame', async () => {
  enter(); view.restore(); path.pathname = '/home'; y = 0; article(900, 60); view.reconcile();
  expect(y).toBe(880); window.dispatchEvent(new Event('touchstart')); y = 200;
  view.reconcile(); await vi.advanceTimersByTimeAsync(2500);
  expect(y).toBe(200); expect(scroll).toHaveBeenCalledOnce();
});

it('waits without polling and restores when the background becomes visible', async () => {
  enter(); view.restore(); path.pathname = '/home'; y = 0; document.body.replaceChildren();
  const queries = vi.spyOn(document, 'querySelectorAll');
  view.reconcile(); await vi.advanceTimersByTimeAsync(32); const waitingQueries = queries.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000); expect(queries).toHaveBeenCalledTimes(waitingQueries);
  const returned = article(900, 60); returned.parentElement?.setAttribute('aria-hidden', 'true');
  await vi.advanceTimersByTimeAsync(0); expect(scroll).not.toHaveBeenCalled();
  returned.parentElement?.removeAttribute('aria-hidden'); await vi.advanceTimersByTimeAsync(0);
  expect(y).toBe(880); expect(scroll).toHaveBeenCalledOnce();
});

it('finds the visible return anchor when a hidden retained surface has the same Post', () => {
  enter(); view.restore(); path.pathname = '/home'; y = 0;
  const hidden = article(900, 60).parentElement; if (!hidden) throw new Error('Missing primary');
  hidden.setAttribute('aria-hidden', 'true'); hidden.remove();
  article(1000, 60); document.body.prepend(hidden); view.reconcile();
  expect(y).toBe(980); expect(scroll).toHaveBeenCalledOnce();
});

it.each([390, 1280])('restores on native back clicks at %i px without consuming the parent snapshot twice', async width => {
  vi.stubGlobal('innerWidth', width);
  enter(); const nested = article(540, 180); nested.querySelector('span')?.click(); path.pathname = '/person/status/456';
  const back = document.createElement('button'); back.dataset.testid = 'app-bar-back'; document.body.append(back);
  view.restore(); back.click(); path.pathname = '/person/status/123'; y = 0; article(900, 60); view.reconcile();
  expect(y).toBe(860); await vi.advanceTimersByTimeAsync(20);
  const parentBack = document.createElement('button'); parentBack.dataset.testid = 'app-bar-back'; document.body.append(parentBack);
  parentBack.click(); path.pathname = '/home'; y = 0; article(1000, 60); view.reconcile();
  expect(y).toBe(980);
});

it('restores a browser-history return and abandons a pending return to another route', async () => {
  enter(); view.reconcile(); path.pathname = '/home'; y = 0; article(900, 60); view.reconcile();
  expect(y).toBe(880); await vi.advanceTimersByTimeAsync(20);
  enter(); view.reconcile(); view.restore(); path.pathname = '/notifications'; view.reconcile();
  path.pathname = '/home'; y = 0; article(900, 60); view.reconcile(); await vi.advanceTimersByTimeAsync(2500);
  expect(y).toBe(0); expect(scroll).toHaveBeenCalledOnce();
});

it('cancels restoration if the viewport width changes before the route is ready', async () => {
  enter(); view.restore(); vi.stubGlobal('innerWidth', innerWidth + 100);
  path.pathname = '/home'; y = 0; article(900, 60); view.reconcile(); await vi.advanceTimersByTimeAsync(2500);
  expect(y).toBe(0); expect(scroll).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it.each([390, 1280])('restores nested Post scrolling at %i px inside the modal and retains the feed snapshot for the next return', async width => {
  vi.stubGlobal('innerWidth', width);
  enter();
  const nested = article(540, 180);
  const surface = document.createElement('div'); surface.setAttribute('data-ft-x-native-post', '');
  const primary = nested.parentElement; if (!primary) throw new Error('Missing primary');
  surface.append(primary); document.body.append(surface);
  const measureNested = nested.getBoundingClientRect.bind(nested);
  nested.getBoundingClientRect = () => {
    const rect = measureNested(); const top = rect.top + 300 - surface.scrollTop;
    return { top, bottom: top + rect.height, height: rect.height, left: rect.left, right: rect.right, width: rect.width, x: rect.x, y: top, toJSON: () => ({}) };
  };
  const scrollModal = vi.fn((options?: ScrollToOptions | number, coordinateY?: number) => {
    surface.scrollTop = typeof options === 'number' ? coordinateY ?? surface.scrollTop : options?.top ?? surface.scrollTop;
  });
  surface.scrollTop = 300; surface.scrollTo = scrollModal;
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
