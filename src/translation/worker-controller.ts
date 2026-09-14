import type { AiProfile } from '../settings';
import { AiBatcher } from './ai-batcher';
import { validateTranslation } from './provider';
import { TranslationTaskManager } from './translation-task-manager';

// Split without cutting protected tokens or Unicode characters.
export function splitText(text: string, limit = 900): string[] {
  const chunks: string[] = []; let chunk = '';
  for (const token of text.match(/⟦\d+⟧|[^⟦]+|⟦/gu) ?? []) {
    if (/^⟦\d+⟧$/.test(token)) {
      if (chunk.length + token.length > limit && chunk) { chunks.push(chunk); chunk = ''; }
      chunk += token; continue;
    }
    for (const char of token) {
      if (chunk.length + char.length > limit) { chunks.push(chunk); chunk = ''; }
      chunk += char;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** Page-scoped async workers; userscript transport and DOM rendering stay on the main thread. */
export class TranslationWorkerController {
  readonly tasks = new TranslationTaskManager({ maxConcurrent: 6, maxPrefetchConcurrent: 2, maxVocabularyConcurrent: 2 });
  readonly batcher: AiBatcher;
  private paints = new Map<string | object, () => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resumeAt = 0;
  private touching = false;
  constructor(ai: AiProfile) {
    this.batcher = new AiBatcher(ai, this.tasks);
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
      window.addEventListener('wheel', this.onScroll, { passive: true });
      window.addEventListener('touchstart', this.onTouchStart, { capture: true, passive: true });
      window.addEventListener('touchend', this.onTouchEnd, { capture: true, passive: true });
      window.addEventListener('touchcancel', this.onTouchEnd, { capture: true, passive: true });
      window.addEventListener('blur', this.onBlur);
    }
  }
  private onScroll = (): void => { this.resumeAt = Date.now() + 160; };
  private onTouchStart = (): void => { this.touching = true; this.onScroll(); };
  private onTouchEnd = (event: TouchEvent): void => {
    this.touching = event.touches.length > 0; this.onScroll();
    if (this.paints.size && !this.touching) this.schedule(160);
  };
  private onBlur = (): void => {
    this.touching = false; this.onScroll();
    if (this.paints.size) this.schedule(160);
  };
  private schedule(delay: number): void {
    this.timer ??= setTimeout(() => this.paintNext(), delay);
  }
  preprocess(text: string, ai: boolean): string[] { return splitText(text, ai ? 6000 : 900); }
  format(source: string, value: unknown): string { return validateTranslation(source, value); }
  render(owner: string | object, paint: () => void, delay = 80): void {
    this.paints.set(owner, paint);
    this.schedule(delay);
  }
  private paintNext(): void {
    this.timer = undefined;
    // Network tasks continue while fingers or momentum scroll move the page.
    // Keep only the latest DOM update, including final results, until scrolling settles.
    if (this.touching || !this.paints.size) return;
    if (Date.now() < this.resumeAt) { this.schedule(this.resumeAt - Date.now()); return; }
    const next = this.paints.entries().next().value;
    if (!next) return;
    const [owner, update] = next;
    this.paints.delete(owner);
    // Yield between owners so scrolling can render between streamed updates.
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
      window.removeEventListener('blur', this.onBlur);
    }
    clearTimeout(this.timer); this.paints.clear(); this.batcher.destroy(); this.tasks.destroy();
  }
}
