// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_FONTS, fontStyles, mountFontStyles, normalizeFonts } from '../src/fonts';
import { createLocalFontQuery, localFontOptions, mountFontSettings } from '../src/font-settings';
import { loadSettings, normalizeSettings, saveSettings } from '../src/settings';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); document.querySelectorAll('[data-ft-owned="font-style"]').forEach(node => node.remove()); });
it('normalizes and persists independent font choices without mutating defaults', () => {
  const settings = normalizeSettings({ fonts: { title: { family: ' Microsoft YaHei ', size: 90 }, body: { family: 'serif', size: 18 } } });
  expect(settings.fonts).toEqual({ title: { family: 'Microsoft YaHei', size: 72 }, body: { family: 'serif', size: 18 } });
  expect(normalizeFonts({ title: { family: 'bad\nfont', size: NaN }, body: { size: -2 } })).toEqual(DEFAULT_FONTS);
  expect(DEFAULT_FONTS.title.size).toBe(0);
  const saved = new Map<string, unknown>();
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => saved.set(key, value));
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => saved.get(key) ?? fallback);
  saveSettings(settings); expect(loadSettings().fonts).toEqual(settings.fonts);
});
it('binds local font queries to the window, caches concurrent queries, and retries permission failures', async () => {
  let resolve: ((fonts: { family: string }[]) => void) | undefined;
  const native = vi.fn(function (this: Window) {
    expect(this).toBe(window);
    return new Promise<{ family: string }[]>(done => { resolve = done; });
  });
  vi.stubGlobal('queryLocalFonts', native);
  const query = createLocalFontQuery(document); expect(query).toBeDefined(); expect(native).not.toHaveBeenCalled();
  const first = query?.(); const second = query?.(); expect(native).toHaveBeenCalledTimes(1);
  resolve?.([{ family: 'Microsoft YaHei' }]);
  expect(await first).toEqual(['Microsoft YaHei']); expect(await second).toEqual(['Microsoft YaHei']);
  await query?.(); expect(native).toHaveBeenCalledTimes(1);
  native.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  const retry = createLocalFontQuery(document); await expect(retry?.()).rejects.toThrow('Denied');
  native.mockResolvedValueOnce([{ family: 'serif' }]); expect(await retry?.()).toEqual(['serif']);
});
it('deduplicates local families and supports Chinese and English search labels', () => {
  const options = localFontOptions(['Arial', 'Microsoft YaHei', ' microsoft yahei ', '宋体', '']);
  expect(options).toHaveLength(3);
  expect(options.find(option => option.family.toLowerCase() === 'microsoft yahei')?.searchText).toContain('微软雅黑');
  expect(options[2]?.family).toBe('Arial');
});
it('requests fonts once on activation and keeps manual selection, previews and reset usable after denial', async () => {
  const section = document.createElement('section'); document.body.append(section);
  const query = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  const controls = mountFontSettings(section, DEFAULT_FONTS, query);
  expect(query).not.toHaveBeenCalled();
  controls.activate(); controls.activate(); await Promise.resolve(); await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(1);
  expect(section.textContent).toContain('未能读取本机字体');
  expect(section.querySelector<HTMLButtonElement>('.font-catalog button')?.hidden).toBe(false);
  expect([...section.querySelectorAll<HTMLElement>('.font-preview')].map(node => node.style.fontSize)).toEqual(['18px']);
  section.querySelector<HTMLButtonElement>('#ft-font-scope-body')?.click();
  const family = section.querySelector<HTMLInputElement>('[name="font-body-family"]'); const size = section.querySelector<HTMLInputElement>('[name="font-body-size"]');
  if (!family || !size) throw new Error('Missing font controls');
  family.value = 'Microsoft YaHei'; family.dispatchEvent(new Event('input')); size.value = '19'; size.dispatchEvent(new Event('input'));
  expect(section.querySelector<HTMLElement>('[aria-label="正文字体预览"]')?.style.fontFamily).toContain('Microsoft YaHei');
  expect(controls.read().body).toEqual({ family: 'Microsoft YaHei', size: 19 });
  [...section.querySelectorAll('button')].find(button => button.textContent === '恢复正文默认')?.click();
  expect(controls.read()).toEqual(DEFAULT_FONTS);
  controls.destroy();
});
it('targets source and translated text while excluding code, drafts and controls, without replacing nodes', () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText" id="source"><span id="text">Text</span> <code id="code">const x</code><button id="button">Reply</button></div><div data-ft-owned="translation" id="translation">译文</div></article><div contenteditable="true"><div data-testid="tweetText" id="draft">Draft</div></div>';
  const heading = document.createElement('div'); heading.dataset.testid = 'longformRichTextComponent'; heading.innerHTML = '<h2 data-block="true" id="heading"><span id="heading-text">Article heading</span></h2>'; document.body.append(heading);
  const nodes = [...document.querySelectorAll('[id]')];
  const fonts = mountFontStyles({ title: { family: '', size: 0 }, body: { family: 'Microsoft YaHei', size: 18 } });
  const style = document.querySelector<HTMLStyleElement>('[data-ft-owned="font-style"]');
  const layer = style?.sheet?.cssRules[0] as CSSGroupingRule | undefined;
  const family = layer?.cssRules[0] as CSSStyleRule | undefined;
  expect(family?.selectorText).toBeTruthy();
  if (!family) throw new Error('Missing font rule');
  const size = layer?.cssRules[1] as CSSStyleRule | undefined;
  if (!size) throw new Error('Missing size rule');
  expect(document.querySelector('#text')?.matches(size.selectorText)).toBe(true);
  expect(document.querySelector('#heading-text')?.matches(size.selectorText)).toBe(false);
  expect(document.querySelector('#heading')?.matches(size.selectorText)).toBe(false);
  expect(document.querySelector('#source')?.matches(family.selectorText)).toBe(true);
  expect(document.querySelector('#translation')?.matches(family.selectorText)).toBe(true);
  for (const id of ['code', 'button', 'draft']) expect(document.querySelector(`#${id}`)?.matches(family.selectorText)).toBe(false);
  fonts.update(DEFAULT_FONTS); expect(style?.textContent).toBe(''); expect([...document.querySelectorAll('[id]')]).toEqual(nodes);
  fonts.destroy(); expect(style?.isConnected).toBe(false);
  expect(fontStyles(DEFAULT_FONTS)).toBe('');
});

it('reuses one editor across font tabs while retaining drafts, search and independent reset', () => {
  const section = document.createElement('section'); document.body.append(section);
  const controls = mountFontSettings(section, DEFAULT_FONTS);
  const family = section.querySelector<HTMLInputElement>('[name="font-title-family"]');
  const size = section.querySelector<HTMLInputElement>('[name="font-title-size"]');
  const search = section.querySelector<HTMLInputElement>('input[type="search"]');
  const preview = section.querySelector('.font-preview'); const list = section.querySelector('.font-options');
  if (!family || !size || !search) throw new Error('Missing shared editor');
  family.value = 'serif'; size.value = '28'; search.value = '宋体'; search.dispatchEvent(new Event('input'));
  section.querySelector<HTMLButtonElement>('#ft-font-scope-body')?.click();
  expect(section.querySelector('[name="font-body-family"]')).toBe(family);
  expect(family.value).toBe(''); expect(size.value).toBe(''); expect(search.value).toBe('');
  family.value = 'Microsoft YaHei'; size.value = '18';
  section.querySelector('#ft-font-scope-body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(family.value).toBe('serif'); expect(size.value).toBe('28'); expect(search.value).toBe('宋体');
  expect(section.querySelector('.font-preview')).toBe(preview); expect(section.querySelector('.font-options')).toBe(list);
  expect(section.querySelectorAll('.font-group,.font-preview,.font-options')).toHaveLength(3);
  section.querySelector<HTMLButtonElement>('.font-reset')?.click();
  expect(controls.read()).toEqual({ title: { family: '', size: 0 }, body: { family: 'Microsoft YaHei', size: 18 } });
  size.value = '9'; section.querySelector<HTMLButtonElement>('#ft-font-scope-body')?.click();
  expect(controls.valid()).toBe(false);
  expect(section.querySelector('#ft-font-scope-title')?.getAttribute('aria-selected')).toBe('true');
  expect(size.value).toBe('9'); controls.destroy();
});
