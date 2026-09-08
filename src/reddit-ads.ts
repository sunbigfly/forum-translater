const adContainerSelector = 'shreddit-ad-post,shreddit-comments-page-ad';
const postSelector = `${adContainerSelector},shreddit-post,[data-testid="post-container"],.thing.link`;
const promotionAttributes = ['promoted', 'is-promoted', 'is-sponsored', 'data-promoted'];

export function isRedditAd(post: Element): boolean {
  if (post.matches(`${adContainerSelector},.thing.link.promoted`)) return true;
  if (promotionAttributes.some(name => post.hasAttribute(name) && !/^(false|0)$/i.test(post.getAttribute(name)?.trim() ?? ''))) return true;
  // Text labels count only in the post credit bar, never in titles, bodies or comments.
  for (const marker of post.querySelectorAll('[slot="credit-bar"] :is(span,a),[data-testid="promoted-label"],.promoted-tag')) {
    if (marker.closest(postSelector) !== post || marker.closest('[data-ft-owned]')) continue;
    if (marker.matches('[data-testid="promoted-label"],.promoted-tag') || /^(Ad|Promoted|Sponsored|广告|廣告|推广|推廣|赞助|贊助)$/i.test(marker.textContent?.trim() ?? '')) return true;
  }
  return false;
}

export class RedditAds {
  private hidden = new Set<HTMLElement>();
  private observer: MutationObserver | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return;
    this.observer = new MutationObserver(() => {
      this.timer ??= setTimeout(() => { this.timer = undefined; this.reconcile(); }, 150);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: [...promotionAttributes, 'class', 'slot', 'data-testid'] });
    this.reconcile();
  }

  private reconcile(): void {
    const next = new Set<HTMLElement>();
    for (const post of document.querySelectorAll<HTMLElement>(postSelector)) {
      if (post.closest('[data-ft-owned]') || !isRedditAd(post)) continue;
      // Detail-page ads may be nested inside a normal post. Skip only when an
      // already identified ad ancestor is being hidden, not any post ancestor.
      if ([...next].some(ancestor => ancestor.contains(post))) continue;
      next.add(post);
    }
    for (const post of this.hidden) if (!next.has(post)) post.removeAttribute('data-ft-reddit-ad');
    for (const post of next) if (!post.hasAttribute('data-ft-reddit-ad')) post.setAttribute('data-ft-reddit-ad', '');
    this.hidden = next;
  }

  destroy(): void {
    this.observer?.disconnect(); clearTimeout(this.timer);
    for (const post of this.hidden) post.removeAttribute('data-ft-reddit-ad');
    this.hidden.clear();
  }
}
