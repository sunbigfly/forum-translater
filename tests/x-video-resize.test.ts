// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { XVideoResize } from '../src/x-video-resize';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); document.documentElement.style.removeProperty('--ft-x-video-width'); });
it('fits the outer frame to capped portrait content without replacing the saved width', () => {
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  const save = vi.fn(); vi.stubGlobal('GM_setValue', save);
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div class="frame" style="border:1px solid"><div data-testid="videoPlayer"></div></div></article></div>';
  const frame = document.querySelector<HTMLElement>('.frame');
  const player = frame?.querySelector<HTMLElement>('[data-testid="videoPlayer"]');
  if (!frame || !player) throw new Error('Missing fixture');
  frame.getBoundingClientRect = () => ({ width: 555, height: 509 } as DOMRect);
  player.getBoundingClientRect = () => ({ width: 229, height: 507 } as DOMRect);
  const resize = new XVideoResize(); resize.reconcile();
  expect(frame.style.getPropertyValue('--ft-media-fit-width')).toBe('231px');
  expect(save).not.toHaveBeenCalled();
  resize.destroy();
  expect(frame.style.getPropertyValue('--ft-media-fit-width')).toBe('');
});
it('resizes the shared photo gallery parent once and persists separately from videos', () => {
  const store = new Map<string, unknown>([['ft:x-video-width:v1', 600]]);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div data-testid="tweetText">Text stays full width</div><div class="gallery" style="overflow:hidden;border-radius:16px"><div class="spacer"></div><a><div data-testid="tweetPhoto"><img></div></a><a><div data-testid="tweetPhoto"><img></div></a></div><div data-testid="videoPlayer"><div data-testid="tweetPhoto"></div></div></article></div>';
  const root = document.querySelector<HTMLElement>('.gallery');
  if (!root?.parentElement) throw new Error('Missing gallery');
  root.getBoundingClientRect = () => ({ width: 420, height: 210 } as DOMRect);
  root.parentElement.getBoundingClientRect = () => ({ width: 1000 } as DOMRect);
  const resize = new XVideoResize('image'); resize.reconcile(); resize.reconcile();
  expect(document.querySelectorAll('[data-ft-image-resizable]')).toHaveLength(1);
  expect(root.hasAttribute('data-ft-image-resizable')).toBe(true);
  expect(root.querySelectorAll('button')).toHaveLength(4);
  root.querySelector('[data-edge="right"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.documentElement.style.getPropertyValue('--ft-x-image-width')).toBe('440px');
  expect(store.get('ft:x-image-width:v1')).toBe(440);
  expect(store.get('ft:x-video-width:v1')).toBe(600);
  resize.destroy();
  expect(root.querySelector('button')).toBeNull();
  const restored = new XVideoResize('image');
  expect(document.documentElement.style.getPropertyValue('--ft-x-image-width')).toBe('440px');
  restored.destroy();
});
it('adds four handles, saves a drag, restores its width and removes controls', () => {
  const store = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div class="media-card" style="overflow:hidden;border-radius:16px"><div data-testid="videoComponent"><div data-testid="videoPlayer"><video></video></div></div></div></article></div>';
  const root = document.querySelector<HTMLElement>('.media-card');
  if (!root?.parentElement) throw new Error('Missing video fixture');
  root.getBoundingClientRect = () => ({ width: 520, height: 260 } as DOMRect);
  root.parentElement.getBoundingClientRect = () => ({ width: 1000 } as DOMRect);
  const resize = new XVideoResize(); resize.reconcile(); resize.reconcile();
  expect(root.querySelectorAll('button')).toHaveLength(4);
  expect(root.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(root.querySelector('[data-testid="videoComponent"]')?.hasAttribute('data-ft-video-resizable')).toBe(false);
  const pointer = (type: string, x: number): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: 0 }); return event;
  };
  root.querySelector('[data-edge="right"]')?.dispatchEvent(pointer('pointerdown', 520));
  window.dispatchEvent(pointer('pointermove', 640));
  expect(document.documentElement.style.getPropertyValue('--ft-x-video-width')).toBe('420px');
  expect(store.size).toBe(0);
  window.dispatchEvent(pointer('pointerup', 640));
  expect(store.get('ft:x-video-width:v1')).toBe(640);
  resize.destroy(); expect(root.querySelector('button')).toBeNull();
  const restored = new XVideoResize(); restored.reconcile();
  expect(document.documentElement.style.getPropertyValue('--ft-x-video-width')).toBe('640px');
  root.querySelector('[data-edge="left"]')?.dispatchEvent(pointer('pointerdown', 0));
  window.dispatchEvent(pointer('pointermove', 100));
  window.dispatchEvent(pointer('pointercancel', 100));
  expect(document.documentElement.style.getPropertyValue('--ft-x-video-width')).toBe('640px');
  restored.destroy();
});

it('applies saved widths to quoted card images and native videos without resizing quote text', () => {
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => key === 'ft:x-image-width:v1' ? 360 : key === 'ft:x-video-width:v1' ? 500 : fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div data-testid="tweetText">Outer post</div><a class="quote"><div data-testid="User-Name">Quoted author</div><div data-testid="tweetText">Quoted body</div><div class="photo"><img data-testid="card_img" src="https://pbs.twimg.com/media/example.jpg"></div></a><div class="video-quote"><div data-testid="User-Name">Video author</div><div class="player" style="overflow:hidden;border-radius:16px"><video></video></div></div></article></div>';
  const images = new XVideoResize('image'); const videos = new XVideoResize();
  videos.reconcile(); images.reconcile(); images.reconcile(); videos.reconcile();
  expect(document.querySelector('.photo')?.hasAttribute('data-ft-image-resizable')).toBe(true);
  expect(document.querySelector('.player')?.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(document.querySelector('.quote')?.hasAttribute('data-ft-image-resizable')).toBe(false);
  expect(document.querySelector('.video-quote')?.hasAttribute('data-ft-video-resizable')).toBe(false);
  expect(document.querySelectorAll('[data-ft-owned="video-resize"]')).toHaveLength(2);
  expect(document.documentElement.style.getPropertyValue('--ft-x-image-width')).toBe('360px');
  expect(document.documentElement.style.getPropertyValue('--ft-x-video-width')).toBe('500px');
  const copy = document.querySelector('.quote')?.cloneNode(true) as HTMLElement;
  copy.querySelector('[data-ft-owned]')?.remove(); copy.querySelector('[data-ft-image-resizable]')?.removeAttribute('data-ft-image-resizable');
  document.querySelector('article')?.append(copy); images.reconcile();
  expect(copy.querySelector('.photo')?.hasAttribute('data-ft-image-resizable')).toBe(true);
  images.destroy(); videos.destroy();
});

it('keeps video controls and absolute placement layers inside the aspect-ratio frame', () => {
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div data-testid="tweetText">Post</div><div class="frame"><div style="padding-bottom:177.7%"></div><div data-testid="placementTracking" style="position:absolute;inset:0;overflow:hidden"><div data-testid="videoPlayer"><div data-testid="videoComponent"><video></video><div role="group"><button>Play</button></div></div></div></div></div></article></div>';
  const resize = new XVideoResize(); resize.reconcile();
  expect(document.querySelector('.frame')?.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(document.querySelector('[data-testid="placementTracking"]')?.hasAttribute('data-ft-video-resizable')).toBe(false);
  expect(document.querySelectorAll('[data-ft-video-resizable]')).toHaveLength(1);
  // A wrapper introduced by the host must replace the old root, not leave nested width limits.
  const frame = document.querySelector('.frame'); const wrapper = document.createElement('div');
  frame?.before(wrapper); if (frame) wrapper.append(frame);
  resize.reconcile();
  expect(wrapper.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(frame?.hasAttribute('data-ft-video-resizable')).toBe(false);
  expect(document.querySelectorAll('[data-ft-owned="video-resize"]')).toHaveLength(1);
  resize.destroy();
});

it('does not observe its own size and preserves media controls and widths across feed detachment', () => {
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  const observe = vi.fn(); vi.stubGlobal('ResizeObserver', observe);
  document.body.innerHTML = '<main data-testid="primaryColumn"><article data-testid="tweet"><div data-testid="tweetText">Post</div><div class="frame"><div data-testid="videoPlayer"><video></video></div></div><div class="photo"><img src="https://pbs.twimg.com/media/test.jpg"></div></article></main>';
  const feed = document.querySelector('main'); const frame = document.querySelector<HTMLElement>('.frame');
  const player = frame?.querySelector<HTMLElement>('[data-testid="videoPlayer"]');
  if (!feed || !frame || !player) throw new Error('Missing fixture');
  frame.getBoundingClientRect = vi.fn(() => ({ width: 555, height: 509 } as DOMRect));
  const measure = vi.fn(() => ({ width: 229, height: 507 } as DOMRect)); player.getBoundingClientRect = measure;
  const videos = new XVideoResize(); const images = new XVideoResize('image');
  videos.reconcile(); images.reconcile();
  const controls = [...feed.querySelectorAll('[data-ft-owned="video-resize"]')];
  const mutations = new MutationObserver(vi.fn()); mutations.observe(feed, { attributes: true, childList: true, subtree: true });
  feed.remove(); videos.reconcile(); images.reconcile();
  document.body.append(feed); videos.reconcile(); images.reconcile();
  for (let i = 0; i < 10; i++) { videos.reconcile(); images.reconcile(); }
  expect([...feed.querySelectorAll('[data-ft-owned="video-resize"]')]).toEqual(controls);
  expect(mutations.takeRecords()).toHaveLength(0);
  expect(observe).not.toHaveBeenCalled(); expect(measure).toHaveBeenCalledTimes(1);
  expect(frame.style.getPropertyValue('--ft-media-fit-width')).toBe('229px');
  player.querySelector('video')?.dispatchEvent(new Event('loadedmetadata'));
  expect(measure).toHaveBeenCalledTimes(2);
  mutations.disconnect(); videos.destroy(); images.destroy();
});

it('never treats an Article body or content block as a media frame', () => {
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  document.body.innerHTML = '<div data-testid="primaryColumn"><article data-testid="tweet"><div data-testid="twitterArticleRichTextView"><div data-testid="longformRichTextComponent"><div data-block="true">Article paragraph</div><section data-block="true"><div class="video-frame"><div data-testid="videoPlayer"><video></video></div></div></section><section data-block="true"><div class="image-frame"><img src="https://pbs.twimg.com/media/article.jpg"></div></section></div></div></article></div>';
  const videos = new XVideoResize(); const images = new XVideoResize('image');
  videos.reconcile(); images.reconcile();
  expect(document.querySelector('.video-frame')?.hasAttribute('data-ft-video-resizable')).toBe(true);
  expect(document.querySelector('.image-frame')?.hasAttribute('data-ft-image-resizable')).toBe(true);
  for (const node of document.querySelectorAll('[data-block],[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]')) {
    expect(node.hasAttribute('data-ft-video-resizable')).toBe(false);
    expect(node.hasAttribute('data-ft-image-resizable')).toBe(false);
  }
  videos.reconcile(); images.reconcile();
  expect(document.querySelectorAll('[data-ft-owned="video-resize"]')).toHaveLength(2);
  videos.destroy(); images.destroy();
  expect(document.querySelector('[data-ft-owned="video-resize"]')).toBeNull();
});
