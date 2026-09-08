import { isXSite } from './settings';

const searchInput = '[data-testid="SearchBox_Search_Input"]';
const exploreLink = 'header[role="banner"] a[data-testid="AppTabBar_Explore_Link"],header[role="banner"] a[href="/explore"]';
const focusable = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** Present the host search in place so React keeps its DOM and event ancestry. */
export class XSearch {
  private observer: MutationObserver | undefined;
  private surface: HTMLElement | undefined;
  private form: HTMLFormElement | undefined;
  private input: HTMLInputElement | undefined;
  private header: HTMLElement | undefined;
  private backdrop: HTMLElement | undefined;
  private previousFocus: HTMLElement | undefined;
  private path: HTMLElement[] = [];
  private savedAttributes = new Map<string, string | null>();
  private route = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (!isXSite()) return;
    document.addEventListener('click', this.click, true);
    document.addEventListener('keydown', this.keydown, true);
    window.addEventListener('popstate', this.routeChanged);
  }

  private click = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(exploreLink) : null;
    if (!target || !this.open(target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };

  private open(trigger: HTMLElement): boolean {
    if (this.surface) { this.input?.focus(); return true; }
    const input = document.querySelector<HTMLInputElement>(`[data-testid="sidebarColumn"] ${searchInput}`);
    const form = input?.closest('form');
    const surface = form?.parentElement;
    const sidebar = input?.closest<HTMLElement>('[data-testid="sidebarColumn"]');
    // Leave the normal Explore link available on routes without native search.
    if (!input || !form || !surface || !sidebar || surface === sidebar || typeof surface.showPopover !== 'function' || surface.hasAttribute('popover')) return false;
    this.surface = surface; this.form = form; this.input = input;
    this.previousFocus = trigger; this.route = location.href;
    for (const attribute of ['role', 'aria-modal', 'aria-label', 'popover']) this.savedAttributes.set(attribute, surface.getAttribute(attribute));
    surface.setAttribute('role', 'dialog'); surface.setAttribute('aria-modal', 'true'); surface.setAttribute('aria-label', '搜索 X');
    surface.setAttribute('data-ft-x-search-surface', '');
    for (let node = surface.parentElement; node; node = node.parentElement) {
      node.setAttribute('data-ft-x-search-path', ''); this.path.push(node);
      if (node === sidebar) break;
    }
    const backdrop = document.createElement('div'); backdrop.dataset.ftOwned = 'x-search-backdrop';
    backdrop.setAttribute('popover', 'manual'); surface.setAttribute('popover', 'manual');
    backdrop.addEventListener('click', () => this.close());
    const header = document.createElement('div'); header.dataset.ftOwned = 'x-search-header';
    const title = document.createElement('strong'); title.textContent = '搜索';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭搜索');
    close.onclick = () => this.close(); header.append(close, title);
    surface.prepend(header); document.body.append(backdrop); this.header = header; this.backdrop = backdrop;
    // Follow X's light, dim and dark themes, including an explicit site theme.
    const body = getComputedStyle(document.body);
    surface.style.setProperty('--ft-x-search-color', getComputedStyle(input).color);
    surface.style.setProperty('--ft-x-search-bg', body.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'Canvas' : body.backgroundColor);
    document.documentElement.setAttribute('data-ft-x-search-open', '');
    backdrop.showPopover(); surface.showPopover();
    form.addEventListener('submit', this.submitted);
    this.observer = new MutationObserver(() => {
      if (!surface.isConnected || !surface.contains(input) || location.href !== this.route) this.close(false);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    input.focus({ preventScroll: true });
    return true;
  }

  private submitted = (): void => {
    // Let the native submit and delegated React handlers finish first.
    this.timer = setTimeout(() => this.close(false), 0);
  };
  private routeChanged = (): void => { if (this.surface && location.href !== this.route) this.close(false); };
  private keydown = (event: KeyboardEvent): void => {
    if (!this.surface || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); this.close(); return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...this.surface.querySelectorAll<HTMLElement>(focusable)].filter(node =>
      !node.matches(':disabled,[tabindex="-1"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const first = controls[0]; const last = controls.at(-1);
    const active = document.activeElement;
    if (!first || !last) return;
    if (!this.surface.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  };

  close(restoreFocus = true): void {
    if (!this.surface) return;
    this.observer?.disconnect(); this.observer = undefined; clearTimeout(this.timer);
    this.form?.removeEventListener('submit', this.submitted);
    if (this.surface.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (this.surface.matches(':popover-open')) this.surface.hidePopover();
    if (this.backdrop?.matches(':popover-open')) this.backdrop.hidePopover();
    this.header?.remove(); this.backdrop?.remove();
    this.surface.removeAttribute('data-ft-x-search-surface');
    this.surface.style.removeProperty('--ft-x-search-color'); this.surface.style.removeProperty('--ft-x-search-bg');
    for (const [attribute, value] of this.savedAttributes) {
      if (value === null) this.surface.removeAttribute(attribute); else this.surface.setAttribute(attribute, value);
    }
    this.savedAttributes.clear();
    for (const node of this.path) node.removeAttribute('data-ft-x-search-path'); this.path = [];
    document.documentElement.removeAttribute('data-ft-x-search-open');
    this.surface = undefined; this.form = undefined; this.input = undefined; this.header = undefined; this.backdrop = undefined;
    if (restoreFocus && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = undefined;
  }

  destroy(): void {
    this.close(false);
    document.removeEventListener('click', this.click, true);
    document.removeEventListener('keydown', this.keydown, true);
    window.removeEventListener('popstate', this.routeChanged);
  }
}
