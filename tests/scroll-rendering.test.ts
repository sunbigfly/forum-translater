// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { TranslationWorkerController } from '../src/translation/worker-controller';
import { DEFAULTS } from '../src/settings';

let worker: TranslationWorkerController | undefined;
afterEach(() => { worker?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); });

it('keeps requests running during nested scrolling and paints only their latest result after momentum stops', async () => {
  vi.useFakeTimers(); worker = new TranslationWorkerController(DEFAULTS.ai);
  const scroller = document.createElement('div'); document.body.append(scroller);
  const partial = vi.fn(); const complete = vi.fn(); let finish!: () => void;
  const request = worker.tasks.request({ key: 'translation', serviceKey: 'test', priority: 'visible', signal: new AbortController().signal },
    () => new Promise<void>(resolve => { finish = resolve; }));
  await Promise.resolve();
  worker.render('post', partial);
  for (let i = 0; i < 5; i++) {
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    expect(partial).not.toHaveBeenCalled();
  }
  finish(); await request;
  expect(worker.tasks.snapshot()).toEqual({ active: 0, queued: 0 });
  worker.render('post', complete);
  scroller.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(159); expect(complete).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(complete).toHaveBeenCalledOnce(); expect(partial).not.toHaveBeenCalled();
});

it('waits for touch release and cancels detached or destroyed work', async () => {
  vi.useFakeTimers(); worker = new TranslationWorkerController(DEFAULTS.ai);
  const paint = vi.fn(); const removed = vi.fn();
  window.dispatchEvent(new TouchEvent('touchstart'));
  worker.render('post', paint); worker.render('removed', removed);
  await vi.advanceTimersByTimeAsync(2000); expect(paint).not.toHaveBeenCalled();
  worker.release('removed');
  window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
  await vi.advanceTimersByTimeAsync(160); expect(paint).toHaveBeenCalledOnce();
  expect(removed).not.toHaveBeenCalled();
  worker.render('destroyed', removed); worker.destroy();
  window.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(1000); expect(removed).not.toHaveBeenCalled();
});

it('recovers when the host stops touch propagation or focus is lost during a gesture', async () => {
  vi.useFakeTimers(); worker = new TranslationWorkerController(DEFAULTS.ai);
  const target = document.createElement('div'); document.body.append(target);
  target.addEventListener('touchend', event => event.stopPropagation());
  const paint = vi.fn();
  target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); worker.render('post', paint);
  await vi.advanceTimersByTimeAsync(200);
  target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [] }));
  await vi.advanceTimersByTimeAsync(160); expect(paint).toHaveBeenCalledOnce();
  target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); worker.render('post', paint);
  await vi.advanceTimersByTimeAsync(200); expect(paint).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(160); expect(paint).toHaveBeenCalledTimes(2);
});
