// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { XSearch } from '../src/x-search';

let search: XSearch | undefined;
const show = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
const hide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');
// jsdom models event ownership; actual top-layer visibility is checked in Chrome.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: vi.fn() });
});
afterAll(() => {
  if (show) Object.defineProperty(HTMLElement.prototype, 'showPopover', show); else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  if (hide) Object.defineProperty(HTMLElement.prototype, 'hidePopover', hide); else Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
});
afterEach(() => { search?.destroy(); search = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function required<K extends keyof HTMLElementTagNameMap>(selector: K, root: ParentNode = document): HTMLElementTagNameMap[K] {
  const node = root.querySelector(selector); if (!node) throw new Error(`Missing fixture: ${selector}`); return node;
}

function fixture(): { link: HTMLAnchorElement; form: HTMLFormElement; input: HTMLInputElement; surface: HTMLElement } {
  vi.stubGlobal('location', { hostname: 'x.com', href: 'https://x.com/home' });
  document.body.innerHTML = '<header role="banner"><nav><a data-testid="AppTabBar_Explore_Link" href="/explore">Explore</a></nav></header><main><div data-testid="sidebarColumn"><div><section id="surface" aria-label="Original"><form role="search"><input data-testid="SearchBox_Search_Input"><div role="listbox"><button type="button">Native suggestion</button></div></form></section><aside>Trends</aside></div></div></main>';
  search = new XSearch();
  return { link: required('a'), form: required('form'), input: required('input'), surface: required('section') };
}

it('keeps native search nodes and delegated input/suggestion events in place', () => {
  const { link, form, input, surface } = fixture(); const parent = surface.parentElement;
  const nativeInput = vi.fn(); const nativeClick = vi.fn();
  required('main').addEventListener('input', nativeInput);
  form.addEventListener('click', nativeClick);
  link.click();
  expect(surface.parentElement).toBe(parent); expect(document.activeElement).toBe(input);
  expect(surface.getAttribute('role')).toBe('dialog'); expect(surface.querySelector('form')).toBe(form);
  input.value = 'typescript'; input.dispatchEvent(new Event('input', { bubbles: true }));
  required('button', form).click();
  expect(nativeInput).toHaveBeenCalledOnce(); expect(nativeClick).toHaveBeenCalledOnce();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.activeElement).toBe(link); expect(input.value).toBe('typescript');
  expect(surface.getAttribute('aria-label')).toBe('Original'); expect(surface.hasAttribute('role')).toBe(false);
  expect(document.querySelector('[data-ft-x-search-path]')).toBeNull();
  expect(document.querySelector('[data-ft-owned="x-search-backdrop"]')).toBeNull();
});

it('lets native submission run before closing and handles later host replacement', async () => {
  vi.useFakeTimers(); const { link, form, surface } = fixture(); const submit = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submit); link.click();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(submit).toHaveBeenCalledOnce(); expect(surface.hasAttribute('data-ft-x-search-surface')).toBe(true);
  vi.runOnlyPendingTimers(); expect(surface.hasAttribute('data-ft-x-search-surface')).toBe(false);
  link.click(); surface.remove(); await Promise.resolve();
  expect(document.documentElement.hasAttribute('data-ft-x-search-open')).toBe(false);
  expect(document.querySelector('[data-ft-owned="x-search-backdrop"]')).toBeNull();
});

it('leaves modified clicks and pages without host search to native navigation', () => {
  const { link, surface } = fixture();
  // Prevent jsdom navigation after observing whether the capture listener intercepted it.
  const clicks: boolean[] = []; link.addEventListener('click', event => { clicks.push(event.defaultPrevented); event.preventDefault(); });
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  expect(surface.hasAttribute('data-ft-x-search-surface')).toBe(false);
  surface.remove(); link.click();
  expect(clicks).toEqual([false, false]);
});

it('closes on native route navigation and does not intercept after destruction', () => {
  const { link } = fixture(); link.click();
  vi.stubGlobal('location', { hostname: 'x.com', href: 'https://x.com/search?q=typescript' });
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(document.documentElement.hasAttribute('data-ft-x-search-open')).toBe(false);
  search?.destroy(); link.addEventListener('click', event => event.preventDefault()); link.click();
  expect(document.documentElement.hasAttribute('data-ft-x-search-open')).toBe(false);
});

it('does not alter search navigation on Reddit', () => {
  const { link } = fixture(); search?.destroy();
  vi.stubGlobal('location', { hostname: 'www.reddit.com' }); search = new XSearch();
  link.addEventListener('click', event => event.preventDefault()); link.click();
  expect(document.querySelector('[data-ft-x-search-surface]')).toBeNull();
});
