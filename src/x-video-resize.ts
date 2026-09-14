const DEFAULT_WIDTH = 420;

export class XVideoResize {
  private roots = new Map<HTMLElement, HTMLElement>();
  private cancelDrag: (() => void) | undefined;
  private width = DEFAULT_WIDTH;
  private contentListeners = new Map<HTMLElement, () => void>();
  private coarsePointer = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : undefined;

  private automatic(): boolean { return innerWidth <= 700 || !!this.coarsePointer?.matches; }

  private fitContent(root: HTMLElement): void {
    if (document.fullscreenElement || this.kind !== 'video' || this.site !== 'x') return;
    root.style.removeProperty('--ft-media-fit-width');
    if (this.automatic()) return;
    const player = root.querySelector<HTMLElement>('[data-testid="videoPlayer"],video');
    if (!player) return;
    const content = player.getBoundingClientRect(); const frame = root.getBoundingClientRect();
    if (content.width <= 0 || content.height <= 0 || frame.width - content.width < 3) return;
    const style = getComputedStyle(root);
    const border = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
    root.style.setProperty('--ft-media-fit-width', `${Math.ceil(content.width + border)}px`);
  }

  private unwatch(root: HTMLElement): void {
    this.contentListeners.get(root)?.(); this.contentListeners.delete(root);
    root.style.removeProperty('--ft-media-fit-width');
  }

  private readonly sizeKey: string;
  private readonly widthProperty: string;
  private readonly attribute: string;
  constructor(private readonly kind: 'video' | 'image' = 'video', private readonly site: 'x' | 'reddit' = 'x') {
    this.sizeKey = `ft:${site}-${kind}-width:v1`;
    this.widthProperty = `--ft-${site}-${kind}-width`;
    this.attribute = `data-ft-${kind}-resizable`;
    const saved: unknown = GM_getValue(this.sizeKey, DEFAULT_WIDTH);
    if (typeof saved === 'number' && Number.isFinite(saved)) this.width = Math.max(180, Math.min(2400, saved));
    this.applyWidth(this.width);
    window.addEventListener('resize', this.onViewportChange);
    this.coarsePointer?.addEventListener('change', this.onViewportChange);
  }

  reconcile(mediaRoots?: Iterable<HTMLElement>): void {
    for (const [root, controls] of this.roots) {
      // X can detach and reuse the feed tree during Post navigation.
      if (this.site === 'x' && !root.isConnected && root.contains(controls)) continue;
      if (!root.isConnected || !root.contains(controls) || this.kind === 'image' && (root.closest('[data-ft-video-resizable]') || root.querySelector('video,[data-testid="videoPlayer"],[data-testid="videoComponent"]'))) {
        controls.remove(); root.removeAttribute(this.attribute); this.unwatch(root); this.roots.delete(root);
      }
    }
    const selector = this.kind === 'video' ? '[data-testid="videoPlayer"],video' : '[data-testid="tweetPhoto"],img[src*="pbs.twimg.com/media/"],img[data-testid="card_img"],[data-testid="card.layoutLarge.media"] img';
    const articleContent = '[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"],[data-block="true"]';
    const containsPost = (node: HTMLElement): boolean => node.matches(articleContent) || [...node.querySelectorAll(`[data-testid="tweetText"],[data-testid="User-Name"],[data-testid^="UserAvatar"],time,[role="group"],${articleContent}`)]
      .some(item => !item.closest('[data-testid="videoPlayer"],[data-testid="videoComponent"],[data-ft-owned]'));
    const desired = new Set<HTMLElement>(mediaRoots);
    for (const player of mediaRoots ? [] : document.querySelectorAll<HTMLElement>(`[data-testid="primaryColumn"] article[data-testid="tweet"] :is(${selector})`)) {
      if (this.kind === 'image' && player.closest('[data-ft-video-resizable],[data-testid="videoComponent"],[data-testid="videoPlayer"]')) continue;
      let root = this.kind === 'video' ? player.closest<HTMLElement>('[data-testid="videoComponent"]') ?? player.parentElement : player.closest<HTMLAnchorElement>('a') ?? player;
      // A quoted post may itself be one large link. Keep its author and text outside the media root.
      if (root && containsPost(root)) root = player.parentElement;
      // Resize the outer media card, including its aspect-ratio spacer and border.
      for (let parent = root?.parentElement; parent && !parent.matches('article,[data-testid="cellInnerDiv"]'); parent = parent.parentElement) {
        if (containsPost(parent) || (this.kind === 'video' ? parent.querySelectorAll('[data-testid="videoPlayer"]').length > 1 || parent.querySelectorAll('video').length > 1 : !!parent.querySelector('video,[data-testid="videoPlayer"]'))) break;
        root = parent;
      }
      if (!root) continue;
      desired.add(root);
    }
    for (const root of desired) {
      if (this.roots.has(root)) continue;
      root.setAttribute(this.attribute, '');
      const controls = document.createElement('div'); controls.dataset.ftOwned = 'video-resize';
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
        const handle = document.createElement('button'); handle.type = 'button'; handle.dataset.edge = edge;
        handle.setAttribute('aria-label', `从${{ top: '上', right: '右', bottom: '下', left: '左' }[edge]}边调整${this.kind === 'video' ? '视频' : '图片'}大小`);
        handle.title = '拖动调整大小；方向键微调';
        handle.onclick = event => { event.preventDefault(); event.stopPropagation(); };
        handle.onkeydown = event => {
          if (this.automatic()) return;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          this.width = this.clamp(root, root.getBoundingClientRect().width + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 20 : -20));
          this.applyWidth(this.width); GM_setValue(this.sizeKey, this.width);
        };
        handle.onpointerdown = event => {
          if (event.button !== 0 || document.fullscreenElement || this.automatic() || event.pointerType === 'touch') return;
          event.preventDefault(); event.stopPropagation(); this.cancelDrag?.();
          const rect = root.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          // Measure before writing, then keep pointermove free of layout reads.
          const available = root.parentElement?.getBoundingClientRect().width || innerWidth;
          const previousWidth = root.style.getPropertyValue(this.widthProperty);
          const previousPriority = root.style.getPropertyPriority(this.widthProperty);
          const fitWidth = root.style.getPropertyValue('--ft-media-fit-width');
          let nextWidth = rect.width;
          let frame: number | undefined;
          const controller = new AbortController();
          controls.setAttribute('data-dragging', '');
          if (fitWidth) root.style.removeProperty('--ft-media-fit-width');
          const cleanup = (): void => {
            controller.abort(); if (frame !== undefined) cancelAnimationFrame(frame);
            if (previousWidth) root.style.setProperty(this.widthProperty, previousWidth, previousPriority);
            else root.style.removeProperty(this.widthProperty);
            if (fitWidth) root.style.setProperty('--ft-media-fit-width', fitWidth);
            controls.removeAttribute('data-dragging'); this.cancelDrag = undefined;
          };
          const cancel = (): void => { cleanup(); };
          this.cancelDrag = cancel;
          const move = (next: PointerEvent): void => {
            if (next.pointerId !== event.pointerId) return;
            const delta = edge === 'left' ? event.clientX - next.clientX : edge === 'right' ? next.clientX - event.clientX : (edge === 'top' ? event.clientY - next.clientY : next.clientY - event.clientY) * rect.width / rect.height;
            nextWidth = this.clampAvailable(available, rect.width + delta);
            frame ??= requestAnimationFrame(() => {
              frame = undefined;
              if (!root.isConnected || !root.contains(controls)) { cancel(); return; }
              const value = `${nextWidth}px`;
              if (root.style.getPropertyValue(this.widthProperty) !== value) root.style.setProperty(this.widthProperty, value);
            });
          };
          window.addEventListener('pointermove', move, { signal: controller.signal });
          window.addEventListener('pointerup', next => {
            if (next.pointerId !== event.pointerId) return;
            if (!root.isConnected || !root.contains(controls)) { cancel(); return; }
            move(next); this.width = nextWidth; cleanup();
            this.applyWidth(this.width); GM_setValue(this.sizeKey, this.width);
          }, { signal: controller.signal });
          window.addEventListener('pointercancel', next => { if (next.pointerId === event.pointerId) cancel(); }, { signal: controller.signal });
          window.addEventListener('blur', cancel, { signal: controller.signal });
          document.addEventListener('fullscreenchange', cancel, { signal: controller.signal });
        };
        controls.append(handle);
      }
      root.append(controls); this.roots.set(root, controls);
      if (this.kind === 'video' && this.site === 'x') {
        const fit = (): void => this.fitContent(root);
        // Only external changes trigger fitting. Observing the player's dimensions
        // while changing its parent's width creates a resize feedback loop.
        root.addEventListener('loadedmetadata', fit, true);
        this.contentListeners.set(root, () => root.removeEventListener('loadedmetadata', fit, true));
        this.fitContent(root);
      }
    }
    for (const [root, controls] of this.roots) if (!desired.has(root) && (this.site !== 'x' || root.isConnected)) {
      controls.remove(); root.removeAttribute(this.attribute); this.unwatch(root); this.roots.delete(root);
    }
    const detached = [...this.roots.keys()].filter(root => !root.isConnected);
    for (const root of detached.slice(0, Math.max(0, detached.length - 50))) {
      this.roots.get(root)?.remove(); root.removeAttribute(this.attribute); this.unwatch(root); this.roots.delete(root);
    }
  }

  private refit = (): void => { for (const root of this.roots.keys()) if (root.isConnected) this.fitContent(root); };
  private onViewportChange = (): void => { this.cancelDrag?.(); this.refit(); };
  private clamp(root: HTMLElement, width: number): number {
    const available = root.parentElement?.getBoundingClientRect().width || innerWidth;
    return this.clampAvailable(available, width);
  }
  private clampAvailable(available: number, width: number): number {
    return Math.max(Math.min(180, available), Math.min(2400, available, width));
  }
  private applyWidth(width: number): void {
    const next = `${width}px`;
    if (document.documentElement.style.getPropertyValue(this.widthProperty) === next) return;
    document.documentElement.style.setProperty(this.widthProperty, next);
    this.refit();
  }
  destroy(): void {
    window.removeEventListener('resize', this.onViewportChange);
    this.coarsePointer?.removeEventListener('change', this.onViewportChange);
    this.cancelDrag?.();
    for (const [root, controls] of this.roots) { controls.remove(); root.removeAttribute(this.attribute); this.unwatch(root); }
    this.roots.clear(); document.documentElement.style.removeProperty(this.widthProperty);
  }
}
