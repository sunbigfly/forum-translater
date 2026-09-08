import { OWNED } from './reddit';
const MARKER = 'data-ft-duplicate';
export class FeedDeduplicator {
  private hidden = new Set<HTMLElement>();
  reconcile(): void {
    if (!/(^|\.)reddit\.com$/.test(location.hostname) || /\/comments\//.test(location.pathname)) { this.reset(); return; }
    const seen = new Set<string>();
    const duplicates = new Set<HTMLElement>();
    for (const post of (document.querySelector('main') ?? document.body).querySelectorAll<HTMLElement>('shreddit-post,.thing.link,[data-testid="post-container"]')) {
      if (post.closest(OWNED)) continue;
      const id = [post.getAttribute('post-id'), post.getAttribute('id'), post.getAttribute('data-fullname')].find(value => /^t3_[a-z0-9]+$/i.test(value ?? ''));
      const permalink = post.getAttribute('permalink') ?? post.getAttribute('content-href') ?? post.querySelector<HTMLAnchorElement>('a[href*="/comments/"]')?.getAttribute('href') ?? '';
      const key = id?.slice(3) ?? permalink.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1];
      if (!key) continue;
      if (seen.has(key)) duplicates.add(post); else seen.add(key);
    }
    for (const post of this.hidden) if (!duplicates.has(post)) post.removeAttribute(MARKER);
    for (const post of duplicates) post.setAttribute(MARKER, '');
    this.hidden = duplicates;
  }
  reset(): void { for (const post of this.hidden) post.removeAttribute(MARKER); this.hidden.clear(); }
}
