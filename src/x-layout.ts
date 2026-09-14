import { XPostViewport } from './x-post-viewport';
import { isXPostPath, XPostModal } from './x-post-modal';
import { isXSite, type Settings } from './settings';
import { XAds } from './x-ads';
import { XVideoResize } from './x-video-resize';
import { isOwnedMutation } from './dom-mutations';
import { ScrollIdleQueue } from './scroll-idle-queue';

type LayoutSettings = Pick<Settings, 'xCollapseSidebar' | 'xHideFloatingIcons' | 'xHideRightSidebar' | 'xHideAds'>;
const launchers = '[data-testid="GrokDrawer"],[data-testid="DMDrawer"],button[aria-label*="Grok"],[role="button"][aria-label*="Grok"],a[href="/i/grok"],[aria-label="Chat"],[aria-label="聊天"],[aria-label="Messages"],[aria-label="私信"]';

export class XLayout {
  private viewport: XPostViewport | undefined;
  private posts = new XPostModal();
  private observer: MutationObserver | undefined;
  private work: ScrollIdleQueue | undefined;
  private hidden = new Set<HTMLElement>();
  private ads = new XAds();
  private toggle: HTMLButtonElement | undefined;
  private brand: HTMLDivElement | undefined;
  private logo: HTMLElement | undefined;
  private rail: HTMLElement | undefined;
  private labels = new Set<HTMLElement>();
  private videos: XVideoResize | undefined;
  private images: XVideoResize | undefined;
  constructor(private settings: LayoutSettings, private readonly save: (collapsed: boolean) => void) {
    if (!isXSite()) return;
    this.work = new ScrollIdleQueue();
    this.viewport = new XPostViewport();
    this.videos = new XVideoResize();
    this.images = new XVideoResize('image');
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.dataset.ftOwned = 'x-sidebar-toggle';
    const svg = (path: string, viewBox: string): SVGSVGElement => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('viewBox', viewBox); node.setAttribute('aria-hidden', 'true');
      const shape = document.createElementNS(node.namespaceURI, 'path'); shape.setAttribute('d', path); node.append(shape); return node;
    };
    const brand = svg('M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.9-9L1 2h6.5l4.9 6.8L18.9 2ZM17.8 20h1.7L6.5 3.9H4.7L17.8 20Z', '0 0 24 24');
    brand.classList.add('ft-x-brand');
    const home = document.createElement('div'); home.dataset.ftOwned = 'x-sidebar-brand'; home.append(toggle); this.brand = home;
    const hint = document.createElement('span'); hint.setAttribute('aria-hidden', 'true');
    const state = svg('M6 4.5h12A2.5 2.5 0 0 1 20.5 7v10a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7A2.5 2.5 0 0 1 6 4.5ZM9 4.5v15M13.5 9l3 3-3 3', '0 0 24 24'); state.classList.add('ft-x-state'); hint.append(state); toggle.append(brand, hint);
    toggle.onclick = () => { const collapsed = !this.settings.xCollapseSidebar; this.update({ ...this.settings, xCollapseSidebar: collapsed }); this.save(collapsed); };
    this.toggle = toggle;
    this.observer = new MutationObserver(records => {
      if (records.every(isOwnedMutation)) return;
      // Host hydration and player updates must not trigger full-feed scans mid-swipe.
      this.work?.render('posts', () => { this.posts.reconcile(); this.viewport?.reconcile(); }, 150);
      this.work?.render('videos', () => this.videos?.reconcile(), 150);
      this.work?.render('images', () => this.images?.reconcile(), 150);
      this.work?.render('navigation', () => this.scanNavigation(), 150);
      this.work?.render('ads', () => this.ads.reconcile(this.settings.xHideAds), 150);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'data-testid'] });
    document.addEventListener('keydown', this.exitPost, true);
    window.addEventListener('popstate', this.onRoute);
    this.update(settings);
  }
  update(settings: LayoutSettings): void {
    this.settings = settings; if (!this.toggle) return;
    document.documentElement.toggleAttribute('data-ft-x-sidebar-collapsed', settings.xCollapseSidebar);
    document.documentElement.toggleAttribute('data-ft-x-right-hidden', settings.xHideRightSidebar);
    document.documentElement.toggleAttribute('data-ft-x-hide-icons', settings.xHideFloatingIcons);
    this.toggle.title = settings.xCollapseSidebar ? '展开 X 侧栏' : '收起 X 侧栏';
    this.toggle.setAttribute('aria-label', this.toggle.title); this.toggle.setAttribute('aria-expanded', String(!settings.xCollapseSidebar));
    this.scan();
  }
  private scan(): void {
    this.posts.reconcile();
    this.videos?.reconcile();
    this.images?.reconcile();
    this.viewport?.reconcile();
    this.scanNavigation();
    this.ads.reconcile(this.settings.xHideAds);
  }
  private scanNavigation(): void {
    const nav = document.querySelector<HTMLElement>('header[role="banner"] nav');
    const rail = nav?.parentElement;
    if (rail && nav && this.toggle && this.brand) {
      if (this.rail !== rail) { this.rail?.removeAttribute('data-ft-x-rail'); this.rail = rail; rail.setAttribute('data-ft-x-rail', ''); }
      // Keep a visible control even when this host variant omits or hides its logo.
      if (this.brand.parentElement !== rail || this.brand.nextElementSibling !== nav) rail.insertBefore(this.brand, nav);
      // Hide only the logo link, never its heading/container: host variants can
      // put the navigation and our control inside that same container.
      const logo = [...document.querySelectorAll<HTMLElement>('header[role="banner"] h1 a[href="/home"],header[role="banner"] a[aria-label="X"][href="/home"]')]
        .find(node => !node.closest('nav,[data-ft-owned]') && !node.contains(nav) && !node.contains(this.toggle ?? null));
      if (this.logo !== logo) {
        this.logo?.removeAttribute('data-ft-x-native-logo'); this.logo = logo ?? undefined;
        logo?.setAttribute('data-ft-x-native-logo', '');
      }
      for (const node of this.labels) if (!node.isConnected || node.querySelector('svg,img')) { node.removeAttribute('data-ft-x-nav-label'); this.labels.delete(node); }
      for (const node of nav.querySelectorAll<HTMLElement>('a [dir],button [dir]')) {
        if (!node.textContent?.trim() || node.querySelector('svg,img') || node.closest('svg')) continue;
        if (!node.hasAttribute('data-ft-x-nav-label')) node.setAttribute('data-ft-x-nav-label', ''); this.labels.add(node);
      }
    }
    if (!this.settings.xHideFloatingIcons) { this.restoreIcons(); return; }
    for (const node of this.hidden) if (!node.isConnected) this.hidden.delete(node);
    // Verified host drawer roots use relative positioning and oversized wrappers.
    for (const node of document.querySelectorAll<HTMLElement>('[data-testid="GrokDrawer"],[data-testid="chat-drawer-root"]')) {
      node.setAttribute('data-ft-x-hidden-icon', ''); this.hidden.add(node);
    }
    for (const candidate of document.querySelectorAll<HTMLElement>(launchers)) {
      if (candidate.closest('header[role="banner"],article,[data-ft-owned]')) continue;
      // Hide only compact fixed launchers, never an open drawer or normal navigation.
      for (let node: HTMLElement | null = candidate; node && node !== document.body; node = node.parentElement) {
        if (this.hidden.has(node)) break;
        const rect = node.getBoundingClientRect();
        if (getComputedStyle(node).position !== 'fixed') continue;
        if (rect.width > 0 && rect.width <= 180 && rect.height > 0 && rect.height <= 180 && rect.left > innerWidth / 2 && rect.top > innerHeight / 2) {
          node.setAttribute('data-ft-x-hidden-icon', ''); this.hidden.add(node);
        }
        break;
      }
    }
  }
  private restoreIcons(): void { for (const node of this.hidden) node.removeAttribute('data-ft-x-hidden-icon'); this.hidden.clear(); }
  private onRoute = (): void => { this.viewport?.reconcile(); };
  private exitPost = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || event.isComposing
      || !isXPostPath(location.pathname ?? '') || document.fullscreenElement) return;
    const post = document.querySelector<HTMLElement>('[data-ft-x-native-post]');
    if (event.composedPath().some(node => node instanceof HTMLElement && (node.isContentEditable || node.matches('input,textarea,select,[contenteditable="true"],[role="menu"]')
      || node.matches('dialog,[role="dialog"]') && node !== post && !node.contains(post)))) return;
    if ([...document.querySelectorAll('[role="dialog"],dialog[open]')].some(node => node !== post && !node.contains(post))
      || document.querySelector('[role="menu"],[data-ft-owned="word-popup"],:popover-open')) return;
    const back = (post ?? document).querySelector<HTMLElement>('[data-testid="primaryColumn"] [data-testid="app-bar-back"]');
    if (!back) return;
    // Consume Escape before the host handles it too; only the native back click
    // should navigate, otherwise one keypress can trigger two route changes.
    event.preventDefault(); event.stopImmediatePropagation(); this.viewport?.restore(); back.click();
  };
  destroy(): void {
    this.posts.destroy();
    this.viewport?.destroy();
    this.videos?.destroy();
    this.images?.destroy();
    this.ads.destroy();
    this.observer?.disconnect(); this.work?.destroy(); this.restoreIcons(); this.toggle?.remove(); this.brand?.remove();
    document.removeEventListener('keydown', this.exitPost, true);
    window.removeEventListener('popstate', this.onRoute);
    this.logo?.removeAttribute('data-ft-x-native-logo'); this.rail?.removeAttribute('data-ft-x-rail');
    for (const node of this.labels) node.removeAttribute('data-ft-x-nav-label'); this.labels.clear();
    document.documentElement.removeAttribute('data-ft-x-sidebar-collapsed');
    document.documentElement.removeAttribute('data-ft-x-right-hidden'); document.documentElement.removeAttribute('data-ft-x-hide-icons');
  }
}
