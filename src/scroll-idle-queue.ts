/** Coalesce page work and yield to touch gestures and momentum scrolling. */
export class ScrollIdleQueue {
  private paints = new Map<string | object, () => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resumeAt = 0;
  private touching = false;
  private pointers = new Set<number>();
  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('wheel', this.onScroll, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { capture: true, passive: true });
    window.addEventListener('touchcancel', this.onTouchEnd, { capture: true, passive: true });
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true, passive: true });
    window.addEventListener('pointerup', this.onPointerEnd, { capture: true, passive: true });
    window.addEventListener('pointercancel', this.onPointerEnd, { capture: true, passive: true });
    window.addEventListener('blur', this.onBlur);
  }
  private onScroll = (): void => { this.resumeAt = Date.now() + 160; };
  private onTouchStart = (): void => { this.touching = true; this.onScroll(); };
  private onTouchEnd = (event: TouchEvent): void => {
    this.touching = event.touches.length > 0; this.onScroll();
    if (this.paints.size && !this.touching && !this.pointers.size) this.schedule(160);
  };
  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    this.pointers.add(event.pointerId); this.onScroll();
  };
  private onPointerEnd = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    this.onScroll();
    if (this.paints.size && !this.touching && !this.pointers.size) this.schedule(160);
  };
  private onBlur = (): void => {
    this.touching = false; this.pointers.clear(); this.onScroll();
    if (this.paints.size) this.schedule(160);
  };
  private schedule(delay: number): void { this.timer ??= setTimeout(() => this.paintNext(), delay); }
  render(owner: string | object, paint: () => void, delay = 80): void {
    this.paints.set(owner, paint); this.schedule(delay);
  }
  private paintNext(): void {
    this.timer = undefined;
    if (this.touching || this.pointers.size || !this.paints.size) return;
    if (Date.now() < this.resumeAt) { this.schedule(this.resumeAt - Date.now()); return; }
    const next = this.paints.entries().next().value;
    if (!next) return;
    const [owner, update] = next; this.paints.delete(owner);
    try { update(); }
    finally { if (this.paints.size) this.schedule(16); }
  }
  release(owner: string | object): void { this.paints.delete(owner); }
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('wheel', this.onScroll);
      window.removeEventListener('touchstart', this.onTouchStart, true);
      window.removeEventListener('touchend', this.onTouchEnd, true);
      window.removeEventListener('touchcancel', this.onTouchEnd, true);
      window.removeEventListener('pointerdown', this.onPointerDown, true);
      window.removeEventListener('pointerup', this.onPointerEnd, true);
      window.removeEventListener('pointercancel', this.onPointerEnd, true);
      window.removeEventListener('blur', this.onBlur);
    }
    clearTimeout(this.timer); this.paints.clear(); this.pointers.clear();
  }
}
