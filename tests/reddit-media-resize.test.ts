// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.reddit.com/r/popular/"}
import { afterEach, expect, it, vi } from 'vitest';
import { RedditMediaResize } from '../src/reddit-media-resize';

let resize: RedditMediaResize | undefined;
afterEach(() => { resize?.destroy(); resize = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('sizes media slots without replacing galleries, players, titles or action bars and remembers widths separately', () => {
  const store = new Map<string, unknown>([['ft:x-image-width:v1', 700], ['ft:reddit-image-width:v1', 360]]);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  document.body.innerHTML = '<shreddit-post><span slot="title">Title</span><img class="avatar"><div slot="post-media-container" id="photo"><a><img></a></div><div slot="action-row"><button>Vote</button></div></shreddit-post><shreddit-post><div slot="post-media-container" id="gallery"><shreddit-gallery><img><img></shreddit-gallery></div></shreddit-post><shreddit-post><div slot="post-media-container" id="movie"><shreddit-player><img><video></video></shreddit-player></div></shreddit-post>';
  const player = document.querySelector('shreddit-player');
  resize = new RedditMediaResize();
  expect(document.querySelectorAll('[data-ft-image-resizable]')).toHaveLength(2);
  expect(document.querySelectorAll('[data-ft-video-resizable]')).toHaveLength(1);
  expect(document.querySelector('shreddit-player')).toBe(player);
  expect(document.querySelectorAll('shreddit-post[data-ft-image-resizable],.avatar[data-ft-image-resizable]')).toHaveLength(0);
  const root = document.querySelector<HTMLElement>('#photo');
  if (!root?.parentElement) throw new Error('Missing photo');
  root.getBoundingClientRect = () => ({ width: 360, height: 180 } as DOMRect);
  root.parentElement.getBoundingClientRect = () => ({ width: 1000 } as DOMRect);
  const pointer = (type: string, y: number): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: 0, clientY: y }); return event;
  };
  root.querySelector('[data-edge="bottom"]')?.dispatchEvent(pointer('pointerdown', 180));
  window.dispatchEvent(pointer('pointermove', 230));
  window.dispatchEvent(pointer('pointerup', 230));
  expect(store.get('ft:reddit-image-width:v1')).toBe(460);
  expect(store.get('ft:x-image-width:v1')).toBe(700);
  expect(document.documentElement.style.getPropertyValue('--ft-reddit-video-width')).toBe('420px');
  resize.destroy();
  expect(document.querySelector('[data-ft-owned="video-resize"]')).toBeNull();
  expect(document.querySelector('[data-ft-reddit-media]')).toBeNull();
  resize = new RedditMediaResize();
  expect(document.documentElement.style.getPropertyValue('--ft-reddit-image-width')).toBe('460px');
});

it('observes new posts and replaces preview handles when a lazy video mounts', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  resize = new RedditMediaResize();
  document.body.innerHTML = '<shreddit-post><div slot="post-media-container"><img></div></shreddit-post>';
  await vi.advanceTimersByTimeAsync(160);
  const root = document.querySelector('[slot="post-media-container"]');
  expect(root?.hasAttribute('data-ft-image-resizable')).toBe(true);
  root?.append(document.createElement('shreddit-player'));
  await vi.advanceTimersByTimeAsync(160);
  expect(root?.hasAttribute('data-ft-image-resizable')).toBe(false);
  expect(root?.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(root?.querySelectorAll('[data-ft-owned="video-resize"]')).toHaveLength(1);
  root?.remove();
  await vi.advanceTimersByTimeAsync(160);
  expect(root?.querySelector('button')).toBeNull();
  expect(root?.hasAttribute('data-ft-reddit-media')).toBe(false);
});
