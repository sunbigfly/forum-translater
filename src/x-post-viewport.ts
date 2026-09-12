import { isXPostPath } from './x-post-modal';

interface ViewportSnapshot { route: string; width: number; anchor: string; top: number; container: HTMLElement | null }
interface RestoreState { snapshot: ViewportSnapshot; origin: string; applied: boolean; microtaskChecked: boolean }
const route = (): string => `${location.pathname}${location.search ?? ''}`;
function postId(article: HTMLElement): string | undefined {
  const timestamp = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time)');
  const link = timestamp ?? article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  return /\/status\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1];
}

// Position the opened Post and restore the clicked row on return, once per navigation.
export class XPostViewport {
  private snapshots: ViewportSnapshot[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private restoreFrame: number | undefined;
  private restoreObserver: MutationObserver | undefined;
  private pendingRestore: RestoreState | undefined;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;
  private currentRoute = route();
  private returningRoute: string | undefined;
  constructor() {
    document.addEventListener('click', this.capture, true);
    window.addEventListener('wheel', this.cancel, { passive: true });
    window.addEventListener('touchstart', this.cancel, { passive: true });
    window.addEventListener('pointerdown', this.cancel, { passive: true });
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.cancel);
  }
  private capture = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (isXPostPath(location.pathname) && target?.closest('[data-testid="app-bar-back"]')) { this.restore(); return; }
    const article = target?.closest<HTMLElement>('article[data-testid="tweet"]');
    if (!article || target?.closest('[data-ft-owned],button,[role="button"],input,textarea,video')) return;
    const link = target?.closest('a');
    if (link && !isXPostPath(link.getAttribute('href') ?? '')) return;
    this.cancel();
    const anchor = postId(article); const rect = article.getBoundingClientRect();
    if (!anchor || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) return;
    const currentRoute = route(); const existing = this.snapshots.findIndex(snapshot => snapshot.route === currentRoute);
    if (existing >= 0) this.snapshots.splice(existing);
    this.snapshots.push({ route: currentRoute, width: innerWidth, anchor, top: rect.top, container: article.closest('[data-ft-x-native-post]') });
    if (this.snapshots.length > 20) this.snapshots.shift();
  };
  reconcile(): void {
    const currentRoute = route();
    this.restoreReady();
    if (currentRoute === this.currentRoute) return;
    this.currentRoute = currentRoute;
    clearTimeout(this.focusTimer); this.focusTimer = undefined;
    const snapshotIndex = this.snapshots.findIndex(snapshot => snapshot.route === currentRoute);
    const returning = this.returningRoute === currentRoute || snapshotIndex >= 0;
    if (snapshotIndex >= 0 && !this.pendingRestore) {
      const [snapshot] = this.snapshots.splice(snapshotIndex);
      if (snapshot && snapshot.width === innerWidth) this.beginRestore(snapshot);
    }
    this.returningRoute = undefined;
    if (returning || !isXPostPath(location.pathname)) return;
    const id = /\/(\d+)\/?$/.exec(location.pathname)?.[1];
    const deadline = Date.now() + 5000;
    const focus = (settled = false): void => {
      this.focusTimer = undefined;
      if (route() !== currentRoute || Date.now() >= deadline) return;
      const surface = document.querySelector<HTMLElement>('[data-ft-x-native-post]');
      const primary = surface?.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
      const anchor = [...(primary?.querySelectorAll<HTMLElement>('article[data-testid="tweet"]') ?? [])].find(node => postId(node) === id);
      if (!surface || !primary || !anchor || surface.getBoundingClientRect().height <= 0 || anchor.getBoundingClientRect().height <= 0) {
        this.focusTimer = setTimeout(() => focus(), 100); return;
      }
      // Let the native thread and media layout settle, then re-query the live target.
      if (!settled) { this.focusTimer = setTimeout(() => focus(true), 200); return; }
      let top = surface.getBoundingClientRect().top;
      for (let node = primary.querySelector<HTMLElement>('[data-testid="app-bar-back"]'); node && node !== primary; node = node.parentElement) {
        if (['sticky', 'fixed'].includes(getComputedStyle(node).position)) top = Math.max(top, node.getBoundingClientRect().bottom);
      }
      const delta = anchor.getBoundingClientRect().top - (top + 12);
      if (Math.abs(delta) > 1) surface.scrollTo({ top: Math.max(0, surface.scrollTop + delta), left: surface.scrollLeft, behavior: 'instant' });
    };
    this.focusTimer = setTimeout(() => focus(), 0);
  }
  restore(): void {
    if (this.pendingRestore) return;
    const snapshot = this.snapshots.at(-1);
    if (!snapshot || snapshot.route === route() || snapshot.width !== innerWidth) return;
    this.snapshots.pop();
    this.beginRestore(snapshot);
  }
  private beginRestore(snapshot: ViewportSnapshot): void {
    this.cancel();
    this.returningRoute = snapshot.route;
    this.pendingRestore = { snapshot, origin: route(), applied: false, microtaskChecked: false };
    this.restoreObserver = new MutationObserver(() => this.restoreReady());
    this.restoreObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'hidden', 'style', 'data-ft-x-native-post'] });
    this.timer = setTimeout(this.cancel, 2000);
    this.restoreReady();
    if (this.pendingRestore && this.restoreFrame === undefined) {
      this.restoreFrame = requestAnimationFrame(() => { this.restoreFrame = undefined; this.restoreReady(); });
    }
  }
  private restoreReady(): void {
    const pending = this.pendingRestore;
    if (!pending) return;
    if (innerWidth !== pending.snapshot.width || (route() !== pending.origin && route() !== pending.snapshot.route)) { this.cancel(); return; }
    if (pending.applied || route() !== pending.snapshot.route || !this.correctOffset(pending.snapshot)) return;
    pending.applied = true;
    if (this.restoreFrame !== undefined) cancelAnimationFrame(this.restoreFrame);
    this.restoreFrame = undefined;
    if (pending.microtaskChecked) { this.finishRestore(pending); return; }
    pending.microtaskChecked = true;
    // Recheck this native DOM batch without waiting for a potentially throttled frame.
    queueMicrotask(() => {
      if (this.pendingRestore !== pending) return;
      if (route() !== pending.snapshot.route || innerWidth !== pending.snapshot.width) { this.cancel(); return; }
      if (!this.correctOffset(pending.snapshot)) {
        pending.applied = false;
        this.restoreFrame = requestAnimationFrame(() => { this.restoreFrame = undefined; this.restoreReady(); });
        return;
      }
      this.finishRestore(pending);
    });
  }
  private finishRestore(pending: RestoreState): void {
    this.restoreObserver?.disconnect();
    // Keep one final frame check for a later native layout or scroll restoration.
    this.restoreFrame = requestAnimationFrame(() => {
      this.restoreFrame = undefined;
      if (this.pendingRestore !== pending) return;
      if (route() === pending.snapshot.route && innerWidth === pending.snapshot.width) this.correctOffset(pending.snapshot);
      this.cancel();
    });
  }
  private correctOffset(snapshot: ViewportSnapshot): boolean {
    const anchor = [...(snapshot.container?.isConnected ? snapshot.container : document).querySelectorAll<HTMLElement>('[data-testid="primaryColumn"] article[data-testid="tweet"]')]
      .find(node => postId(node) === snapshot.anchor && !node.closest('[aria-hidden="true"],[hidden]'));
    if (!anchor) return false;
    const rect = anchor.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const delta = rect.top - snapshot.top;
    if (Math.abs(delta) > 1) {
      const container = anchor.closest<HTMLElement>('[data-ft-x-native-post]');
      if (container) container.scrollTo({ top: Math.max(0, container.scrollTop + delta), left: container.scrollLeft, behavior: 'instant' });
      else window.scrollTo({ top: Math.max(0, scrollY + delta), left: scrollX, behavior: 'instant' });
      const corrected = anchor.getBoundingClientRect();
      return corrected.height > 0 && Math.abs(corrected.top - snapshot.top) <= 1;
    }
    return true;
  }
  private cancel = (): void => {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.restoreFrame !== undefined) cancelAnimationFrame(this.restoreFrame); this.restoreFrame = undefined;
    this.restoreObserver?.disconnect(); this.restoreObserver = undefined; this.pendingRestore = undefined;
    clearTimeout(this.focusTimer); this.focusTimer = undefined;
  };

  private onKey = (event: KeyboardEvent): void => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) this.cancel(); };
  destroy(): void {
    this.cancel(); this.snapshots = [];
    document.removeEventListener('click', this.capture, true);
    window.removeEventListener('wheel', this.cancel); window.removeEventListener('touchstart', this.cancel);
    window.removeEventListener('pointerdown', this.cancel); window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('resize', this.cancel);
  }
}
