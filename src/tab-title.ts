// Reuse completed post translations; never request a separate translation for the tab.
export class TabTitle {
  private observer: MutationObserver;
  private candidate: { route: string; original: string; translated: string } | undefined;
  private applied: { original: string; translated: string } | undefined;
  constructor() {
    this.observer = new MutationObserver(() => this.apply());
    this.observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  update(original: string, translated: string): void {
    if (!/\/comments\/[^/]+/.test(location.pathname)) return;
    const source = original.trim();
    const nativeTitle = this.applied && document.title === this.applied.translated ? this.applied.original : document.title;
    if (!source || !nativeTitle.startsWith(source)) return;
    const suffix = nativeTitle.slice(source.length);
    if (suffix && !/^\s*[:|–—-]/.test(suffix)) return;
    this.candidate = { route: location.href, original: source, translated: translated.trim() };
    this.apply();
  }
  private apply(): void {
    const candidate = this.candidate;
    if (!candidate || candidate.route !== location.href || !candidate.original || !candidate.translated) return;
    const current = document.title;
    if (current === this.applied?.translated) return;
    // Only replace a matching post title, retaining Reddit's subreddit suffix.
    if (!current.startsWith(candidate.original)) return;
    const suffix = current.slice(candidate.original.length);
    if (suffix && !/^\s*[:|–—-]/.test(suffix)) return;
    const translated = candidate.translated + suffix;
    this.applied = { original: current, translated };
    if (current !== translated) document.title = translated;
  }
  reset(): void {
    this.candidate = undefined;
    if (this.applied && document.title === this.applied.translated) document.title = this.applied.original;
    this.applied = undefined;
  }
  destroy(): void { this.observer.disconnect(); this.reset(); }
}
