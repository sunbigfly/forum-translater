// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { loadTranslationOnly, saveTranslationOnly } from '../src/settings';
import { OriginalVisibility } from '../src/original-visibility';
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('persists translation-only for reddit.com/* across posts and supported subdomains', () => {
  const store = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  saveTranslationOnly(true, 'https://www.reddit.com/r/test/comments/one#first');
  expect(loadTranslationOnly('https://www.reddit.com/r/test/comments/one#second')).toBe(true);
  expect(loadTranslationOnly('https://www.reddit.com/r/test/comments/two')).toBe(true);
  expect(loadTranslationOnly('https://old.reddit.com/r/other')).toBe(true);
  expect(loadTranslationOnly('https://new.reddit.com/r/other')).toBe(true);
  expect(loadTranslationOnly('https://reddit.com/')).toBe(true);
  expect(loadTranslationOnly('https://example.com/')).toBe(false);
  saveTranslationOnly(false, 'https://www.reddit.com/r/test/comments/one');
  expect(loadTranslationOnly('https://www.reddit.com/r/test/comments/one')).toBe(false);
  expect(loadTranslationOnly('https://old.reddit.com/r/other')).toBe(false);
});
it('preserves embedded media and translated children while restoring original text nodes', () => {
  const root = document.createElement('div'); root.append('Original text');
  const text = root.firstChild; const video = document.createElement('video'); root.append(video);
  const translation = document.createElement('div'); translation.dataset.ftOwned = 'translation'; translation.textContent = '译文'; root.append(translation); document.body.append(root);
  const visibility = new OriginalVisibility(); visibility.hide(root);
  expect(root.hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(video.hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(translation.hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(root.querySelector('[data-ft-original-hidden]')?.textContent).toBe('Original text');
  visibility.restore(); expect(root.firstChild).toBe(text); expect(root.querySelector('[data-ft-original-hidden]')).toBeNull();
});

it('migrates an existing page preference once without overriding the shared site preference', () => {
  const page = 'https://www.reddit.com/r/test/comments/one';
  const store = new Map<string, unknown>([[`ft:display:${page}`, true]]);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  expect(loadTranslationOnly(page)).toBe(true);
  expect(loadTranslationOnly('https://new.reddit.com/r/other')).toBe(true);
  saveTranslationOnly(false, 'https://old.reddit.com/');
  expect(loadTranslationOnly(page)).toBe(false);
});

it('shares X display preference with twitter.com while keeping Reddit independent', () => {
  const store = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => store.set(key, value));
  saveTranslationOnly(true, 'https://x.com/home');
  expect(loadTranslationOnly('https://www.x.com/user/status/123')).toBe(true);
  expect(loadTranslationOnly('https://twitter.com/home')).toBe(true);
  expect(loadTranslationOnly('https://reddit.com/')).toBe(false);
});
