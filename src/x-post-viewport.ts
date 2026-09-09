interface ViewportSnapshot { route: string; width: number; anchor: string; top: number }
const route = (): string => `${location.pathname}${location.search ?? ''}`;
function postId(article: HTMLElement): string | undefined {
  const timestamp = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time)');
  const link = timestamp ?? article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  return /\/status\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1];
}

// Restore the clicked post once after native navigation; never pin row heights or chase scrolling.
export class XPostViewport {
  private snapshot: ViewportSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
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
    const article = target?.closest<HTMLElement>('article[data-testid="tweet"]');
    if (!article || target?.closest('[data-ft-owned],button,[role="button"],input,textarea,video')) return;
    const link = target?.closest('a');
    if (link && !/^\/[^/]+\/status\/\d+\/?$/.test(link.getAttribute('href') ?? '')) return;
    this.cancel();
    const anchor = postId(article); const rect = article.getBoundingClientRect();
    if (!anchor || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) return;
    this.snapshot = { route: route(), width: innerWidth, anchor, top: rect.top };
  };
  restore(): void {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.route === route() || snapshot.width !== innerWidth) return;
    this.cancel(); this.snapshot = undefined;
    const deadline = Date.now() + 2000;
    const findAnchor = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[data-testid="primaryColumn"] article[data-testid="tweet"]')]
      .find(node => postId(node) === snapshot.anchor);
    const waitForFeed = (): void => {
      if (innerWidth !== snapshot.width || Date.now() >= deadline) { this.cancel(); return; }
      if (route() !== snapshot.route || !findAnchor()) {
        this.timer = setTimeout(waitForFeed, 100); return;
      }
      // Allow native route restoration and our media scan to finish before one correction.
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (route() !== snapshot.route || innerWidth !== snapshot.width) return;
        const anchor = findAnchor();
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        if (rect.height <= 0) return;
        const delta = rect.top - snapshot.top;
        if (Math.abs(delta) > 1) window.scrollTo({ top: Math.max(0, scrollY + delta), left: scrollX, behavior: 'instant' });
      }, 200);
    };
    this.timer = setTimeout(waitForFeed, 0);
  }
  private cancel = (): void => { clearTimeout(this.timer); this.timer = undefined; };

  private onKey = (event: KeyboardEvent): void => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) this.cancel(); };
  destroy(): void {
    this.cancel(); this.snapshot = undefined;
    document.removeEventListener('click', this.capture, true);
    window.removeEventListener('wheel', this.cancel); window.removeEventListener('touchstart', this.cancel);
    window.removeEventListener('pointerdown', this.cancel); window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('resize', this.cancel);
  }
}
