export function isXAd(article: Element): boolean {
  const candidates = article.querySelectorAll('[data-testid="promotedIndicator"],span');
  for (const marker of candidates) {
    if (marker.closest('article') !== article || marker.closest('[data-testid="tweetText"],[data-testid="User-Name"],[data-ft-owned],a,time')) continue;
    if (marker.matches('[data-testid="promotedIndicator"]')) return true;
    if (!/^(广告|廣告|推广|推廣|Ad|Promoted|Sponsored)$/i.test(marker.textContent?.trim() ?? '')) continue;
    for (let header = marker.parentElement; header && header !== article; header = header.parentElement) {
      if (header.querySelector('[data-testid="tweetText"]')) break;
      if (header.querySelector('[data-testid="User-Name"]') && header.querySelector('[data-testid="caret"]')) return true;
    }
  }
  return false;
}

export class XAds {
  private hidden = new Set<HTMLElement>();
  reconcile(enabled: boolean): void {
    const next = new Set<HTMLElement>();
    if (enabled) for (const article of document.querySelectorAll<HTMLElement>('[data-testid="primaryColumn"] article[data-testid="tweet"]')) {
      if (article.parentElement?.closest('article') || !isXAd(article)) continue;
      next.add(article.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? article);
    }
    for (const node of this.hidden) if (!next.has(node)) node.removeAttribute('data-ft-x-ad');
    for (const node of next) node.setAttribute('data-ft-x-ad', '');
    this.hidden = next;
  }
  destroy(): void { for (const node of this.hidden) node.removeAttribute('data-ft-x-ad'); this.hidden.clear(); }
}
