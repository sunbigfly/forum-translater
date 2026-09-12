// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { XLayout } from '../src/x-layout';
import { DEFAULTS, normalizeSettings } from '../src/settings';
let layout: XLayout | undefined;
beforeEach(() => { vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback); vi.stubGlobal('GM_setValue', vi.fn()); });
afterEach(() => { layout?.destroy(); layout = undefined; vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('uses the native post back button on Escape and respects editing and dialogs', () => {
  vi.stubGlobal('location', { hostname: 'x.com', pathname: '/someone/status/123' });
  document.body.innerHTML = '<main data-testid="primaryColumn"><button data-testid="app-bar-back">返回</button><input></main>';
  const back = document.querySelector('button'); const clicked = vi.fn(); back?.addEventListener('click', clicked);
  layout = new XLayout(DEFAULTS, vi.fn());
  const escape = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.querySelector('input')?.dispatchEvent(escape()); expect(clicked).not.toHaveBeenCalled();
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
  document.dispatchEvent(escape()); expect(clicked).not.toHaveBeenCalled(); dialog.remove();
  const host = document.createElement('div'); document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<dialog open><button>关闭设置</button></dialog>';
  shadow.querySelector('button')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  expect(clicked).not.toHaveBeenCalled(); host.remove();
  document.dispatchEvent(escape()); expect(clicked).toHaveBeenCalledOnce();
  layout.destroy(); document.dispatchEvent(escape()); expect(clicked).toHaveBeenCalledOnce();
});
it('consumes post Escape before host shortcuts can navigate a second time', () => {
  vi.stubGlobal('location', { hostname: 'x.com', pathname: '/someone/status/123' });
  document.body.innerHTML = '<main data-testid="primaryColumn"><button data-testid="app-bar-back">返回</button><span>Post</span></main>';
  const clicked = vi.fn();
  document.querySelector('button')?.addEventListener('click', clicked);
  const hostShortcut = vi.fn();
  document.addEventListener('keydown', hostShortcut);
  layout = new XLayout(DEFAULTS, vi.fn());
  const laterCaptureShortcut = vi.fn();
  document.addEventListener('keydown', laterCaptureShortcut, true);
  try {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.querySelector('span')?.dispatchEvent(event);
    expect(clicked).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(hostShortcut).not.toHaveBeenCalled();
    expect(laterCaptureShortcut).not.toHaveBeenCalled();
    layout.destroy();
    document.querySelector('span')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hostShortcut).toHaveBeenCalledOnce();
    expect(laterCaptureShortcut).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener('keydown', hostShortcut);
    document.removeEventListener('keydown', laterCaptureShortcut, true);
  }
});
it.each(['/someone/status/123', '/i/web/status/123', '/i/thread/123'])('closes a native Post modal at %s on Escape while respecting nested dialogs and editors', pathname => {
  vi.stubGlobal('location', { hostname: 'x.com', pathname });
  document.body.innerHTML = '<main data-testid="primaryColumn"><button data-testid="app-bar-back">Feed back</button></main><div role="dialog"><div role="dialog" data-ft-x-native-post><div data-testid="primaryColumn"><button data-testid="app-bar-back">Post back</button><input></div></div></div>';
  const back = document.querySelector('[data-ft-x-native-post] button'); const clicked = vi.fn(); back?.addEventListener('click', clicked);
  const feedBack = vi.fn(); document.querySelector('main button')?.addEventListener('click', feedBack);
  layout = new XLayout(DEFAULTS, vi.fn());
  const escape = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.querySelector('input')?.dispatchEvent(escape()); expect(clicked).not.toHaveBeenCalled();
  const nested = document.createElement('div'); nested.setAttribute('role', 'dialog'); back?.parentElement?.append(nested);
  document.dispatchEvent(escape()); expect(clicked).not.toHaveBeenCalled(); nested.remove();
  back?.dispatchEvent(escape()); expect(clicked).toHaveBeenCalledOnce(); expect(feedBack).not.toHaveBeenCalled();
});
it('collapses the X sidebar, restores it with the toggle and cleans up', () => {
  vi.stubGlobal('location', { hostname: 'x.com' }); const save = vi.fn();
  document.body.innerHTML = '<header role="banner"><h1><a href="/home">Home</a></h1><div><nav><a href="/home">Navigation</a></nav></div></header>';
  layout = new XLayout(DEFAULTS, save);
  expect(document.documentElement.hasAttribute('data-ft-x-sidebar-collapsed')).toBe(true);
  expect(document.querySelector('[data-ft-owned="x-sidebar-brand"] + nav')).not.toBeNull();
  expect(document.querySelector('[data-ft-owned="x-sidebar-toggle"]')?.parentElement).toBe(document.querySelector('[data-ft-owned="x-sidebar-brand"]'));
  expect(document.querySelector('h1 > a')?.hasAttribute('data-ft-x-native-logo')).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-ft-owned="x-sidebar-toggle"]')?.click();
  expect(save).toHaveBeenCalledWith(false);
  expect(document.documentElement.hasAttribute('data-ft-x-sidebar-collapsed')).toBe(false);
  layout.update(DEFAULTS); layout.destroy();
  expect(document.querySelector('[data-ft-owned="x-sidebar-toggle"]')).toBeNull();
  expect(document.querySelector('[data-ft-owned="x-sidebar-brand"]')).toBeNull();
  expect(document.querySelector('header a')?.textContent).toBe('Home');
  expect(document.querySelector('[data-ft-x-native-logo]')).toBeNull();
});
it('never marks a shared logo/navigation container for hiding and only marks text labels', () => {
  vi.stubGlobal('location', { hostname: 'x.com' });
  document.body.innerHTML = '<header role="banner"><h1><a href="/home" aria-label="X"><svg><path /></svg></a><div><nav><a href="/home"><div><div><svg><path /></svg></div><div dir="ltr"><span>Home</span></div></div></a></nav></div></h1></header>';
  layout = new XLayout(DEFAULTS, vi.fn());
  expect(document.querySelector('h1')?.hasAttribute('data-ft-x-native-logo')).toBe(false);
  const marked = document.querySelector('[data-ft-x-native-logo]');
  expect(marked?.tagName).toBe('A'); expect(marked?.querySelector('nav')).toBeNull();
  expect(document.querySelectorAll('[data-ft-x-nav-label]')).toHaveLength(1);
  expect(document.querySelector('[data-ft-x-nav-label]')?.textContent).toBe('Home');
  expect(document.querySelector('nav svg')?.closest('[data-ft-x-nav-label]')).toBeNull();
  expect(document.querySelector('[data-ft-owned="x-sidebar-toggle"]')?.closest('[data-ft-x-native-logo]')).toBeNull();
  layout.destroy(); expect(document.querySelector('[data-ft-x-nav-label]')).toBeNull();
});
it('provides the control without a native logo and reattaches after navigation replacement', async () => {
  vi.useFakeTimers(); vi.stubGlobal('location', { hostname: 'x.com' });
  document.body.innerHTML = '<header role="banner"><h1><div><nav><a href="/home">Home</a></nav></div></h1></header>';
  layout = new XLayout(DEFAULTS, vi.fn());
  const toggle = document.querySelector('[data-ft-owned="x-sidebar-toggle"]');
  const brand = document.querySelector('[data-ft-owned="x-sidebar-brand"]');
  expect(brand?.querySelector('.ft-x-brand')).not.toBeNull();
  expect(brand?.hasAttribute('data-ft-x-native-logo')).toBe(false);
  expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  const header = document.querySelector('header'); if (!header) throw new Error('Missing header');
  header.innerHTML = '<div><nav><a href="/home">Home</a></nav></div>';
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(150);
  expect(document.querySelector('[data-ft-owned="x-sidebar-brand"] + nav')?.previousElementSibling).toBe(brand);
  expect(document.querySelector('[data-ft-owned="x-sidebar-toggle"]')).toBe(toggle);
  layout.destroy(); vi.useRealTimers();
});
it('hides only compact fixed X launchers and restores the original nodes', () => {
  vi.stubGlobal('location', { hostname: 'x.com' });
  document.body.innerHTML = '<header role="banner"><a href="/i/grok">Grok</a></header><div id="launcher" style="position:fixed"><button aria-label="Grok">G</button></div><div id="other" style="position:fixed">History</div><article><button aria-label="Grok">Post action</button></article>';
  const launcher = document.querySelector<HTMLElement>('#launcher'); if (!launcher) throw new Error('Missing fixture');
  launcher.getBoundingClientRect = () => ({ left: 900, top: 650, width: 60, height: 60, right: 960, bottom: 710, x: 900, y: 650, toJSON: () => ({}) });
  layout = new XLayout(DEFAULTS, vi.fn());
  expect(launcher.hasAttribute('data-ft-x-hidden-icon')).toBe(true);
  expect(document.querySelectorAll('[data-ft-x-hidden-icon]')).toHaveLength(1);
  layout.update({ ...DEFAULTS, xHideFloatingIcons: false });
  expect(launcher.hasAttribute('data-ft-x-hidden-icon')).toBe(false);
  expect(document.querySelector('#launcher')).toBe(launcher);
});
it('does nothing on Reddit and retains explicit restoration preferences', () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com' });
  const settings = normalizeSettings({ xCollapseSidebar: false, xHideFloatingIcons: false });
  expect(settings.xCollapseSidebar).toBe(false); expect(settings.xHideFloatingIcons).toBe(false);
  layout = new XLayout(settings, vi.fn());
  expect(document.querySelector('[data-ft-owned="x-sidebar-toggle"]')).toBeNull();
});
it('targets the actual relative-positioned host drawers and restores all layout preferences', () => {
  vi.stubGlobal('location', { hostname: 'x.com' });
  document.body.innerHTML = '<div data-testid="GrokDrawer" style="position:relative;width:400px"></div><div data-testid="chat-drawer-root" style="position:relative;width:400px"></div><div data-testid="sidebarColumn">News</div>';
  layout = new XLayout(DEFAULTS, vi.fn());
  expect(document.querySelectorAll('[data-ft-x-hidden-icon]')).toHaveLength(2);
  expect(document.documentElement.hasAttribute('data-ft-x-right-hidden')).toBe(true);
  layout.update({ xCollapseSidebar: false, xHideFloatingIcons: false, xHideRightSidebar: false, xHideAds: false });
  expect(document.querySelectorAll('[data-ft-x-hidden-icon]')).toHaveLength(0);
  expect(document.documentElement.hasAttribute('data-ft-x-right-hidden')).toBe(false);
  expect(document.documentElement.hasAttribute('data-ft-x-hide-icons')).toBe(false);
});
