import type { AiProfile } from '../settings';
import { AiBatcher } from './ai-batcher';
import { validateTranslation } from './provider';
import { TranslationTaskManager } from './translation-task-manager';
import { ScrollIdleQueue } from '../scroll-idle-queue';

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
export class TranslationWorkerController extends ScrollIdleQueue {
  readonly tasks = new TranslationTaskManager({ maxConcurrent: 6, maxPrefetchConcurrent: 2, maxVocabularyConcurrent: 2 });
  readonly batcher: AiBatcher;
  constructor(ai: AiProfile) {
    super();
    this.batcher = new AiBatcher(ai, this.tasks);
  }
  preprocess(text: string, ai: boolean): string[] { return splitText(text, ai ? 6000 : 900); }
  format(source: string, value: unknown): string { return validateTranslation(source, value); }
  override destroy(): void {
    super.destroy(); this.batcher.destroy(); this.tasks.destroy();
  }
}
