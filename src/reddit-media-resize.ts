import { XVideoResize } from './x-video-resize';

// Only explicit post media slots: avatars, inline text images and vote bars stay outside.
const mediaSelector = 'shreddit-post [slot="post-media-container"],shreddit-post [slot="post-media"],[data-testid="post-container"] [data-click-id="media"],.thing.link > .entry .expando';
const videoSelector = 'shreddit-player,reddit-video-player,video,iframe';

export class RedditMediaResize {
  private videos: XVideoResize | undefined;
  private images: XVideoResize | undefined;
  private observer: MutationObserver | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private roots = new Set<HTMLElement>();

  constructor() {
    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return;
    this.videos = new XVideoResize('video', 'reddit');
    this.images = new XVideoResize('image', 'reddit');
    this.observer = new MutationObserver(() => {
      this.timer ??= setTimeout(() => { this.timer = undefined; this.reconcile(); }, 150);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['slot', 'src', 'data-click-id'] });
    this.reconcile();
  }

  private reconcile(): void {
    const videos = new Set<HTMLElement>(); const images = new Set<HTMLElement>();
    for (const root of document.querySelectorAll<HTMLElement>(mediaSelector)) {
      if (root.closest('[data-ft-owned],shreddit-ad-post') || root.parentElement?.closest(mediaSelector)) continue;
      if (root.matches(videoSelector) || root.querySelector(videoSelector)) videos.add(root);
      else if (root.matches('img,shreddit-gallery') || root.querySelector('img,shreddit-gallery')) images.add(root);
    }
    const desired = new Set([...videos, ...images]);
    for (const root of this.roots) if (!desired.has(root)) root.removeAttribute('data-ft-reddit-media');
    for (const root of desired) {
      const kind = videos.has(root) ? 'video' : 'image';
      if (root.getAttribute('data-ft-reddit-media') !== kind) root.setAttribute('data-ft-reddit-media', kind);
    }
    this.roots = desired;
    // Release image handles before a lazy player replaces its preview.
    this.images?.reconcile(images);
    this.videos?.reconcile(videos);
  }

  destroy(): void {
    this.observer?.disconnect(); clearTimeout(this.timer);
    this.images?.destroy(); this.videos?.destroy();
    for (const root of this.roots) root.removeAttribute('data-ft-reddit-media');
    this.roots.clear();
  }
}
