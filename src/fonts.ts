import { contentSelector } from './reddit';

export interface FontChoice { family: string; size: number }
export interface FontSettings { title: FontChoice; body: FontChoice }
export const DEFAULT_FONTS: FontSettings = { title: { family: '', size: 0 }, body: { family: '', size: 0 } };
export function normalizeFonts(raw: unknown): FontSettings {
  const result: FontSettings = { title: { ...DEFAULT_FONTS.title }, body: { ...DEFAULT_FONTS.body } };
  for (const scope of ['title', 'body'] as const) {
    const entry: unknown = raw && typeof raw === 'object' && scope in raw ? Reflect.get(raw, scope) : undefined;
    if (!entry || typeof entry !== 'object') continue;
    const family: unknown = Reflect.get(entry, 'family'); const size: unknown = Reflect.get(entry, 'size');
    if (typeof family === 'string' && !/\p{Cc}/u.test(family)) result[scope].family = family.trim().slice(0, 200);
    if (typeof size === 'number' && Number.isFinite(size) && size > 0) result[scope].size = Math.max(10, Math.min(72, Math.round(size)));
  }
  return result;
}
export function fontFamilyCss(family: string): string {
  if (!family) return 'inherit';
  if (['system-ui', 'sans-serif', 'serif', 'monospace'].includes(family)) return family;
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", system-ui, sans-serif`;
}
const headings = ':is([data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]) :is(h1,h2,h3,h4,h5,h6)';
const excluded = 'pre,code,kbd,samp,button,input,textarea,select,svg,[contenteditable]:not([contenteditable="false"]),[data-ft-owned]:not([data-ft-owned="translation"])';
export function fontTargets(scope: keyof FontSettings): string {
  const source = scope === 'title' ? `${contentSelector('title')},${headings}` : `${contentSelector('body')},${contentSelector('comment')}`;
  const translation = scope === 'title' ? '[data-ft-owned="translation"].ft-translation-title,[data-ft-owned="translation"][data-ft-font="title"]' : '[data-ft-owned="translation"]:not(.ft-translation-title):not([data-ft-font="title"])';
  return `:is(${source},${translation}):not(:is(${excluded},:is(${excluded}) *))`;
}
export function fontStyles(raw: FontSettings): string {
  const settings = normalizeFonts(raw); const rules: string[] = [];
  // Important declarations in this layer override the host and our fixed tweet
  // sizes, including inline style copies, without modifying the source nodes.
  for (const scope of ['body', 'title'] as const) {
    const target = fontTargets(scope); const choice = settings[scope];
    if (choice.family) rules.push(`:where(${target},${target} *):not(:where(${excluded},:is(${excluded}) *)){font-family:${fontFamilyCss(choice.family)}!important}`);
    if (choice.size) {
      const skip = scope === 'body' ? `${excluded},h1,h2,h3,h4,h5,h6,.ft-translation-title,[data-ft-font="title"]` : excluded;
      rules.push(`:where(${target},${target} *):not(:where(${skip},:is(${skip}) *)){font-size:${choice.size}px!important;line-height:1.6!important}`);
    }
  }
  return rules.length ? `@layer ft-typography {${rules.join('\n')}}` : '';
}
export function mountFontStyles(settings: FontSettings): { update: (next: FontSettings) => void; destroy: () => void } {
  const style = document.createElement('style'); style.dataset.ftOwned = 'font-style'; document.head.append(style);
  const update = (next: FontSettings): void => { const css = fontStyles(next); if (style.textContent !== css) style.textContent = css; };
  update(settings);
  return { update, destroy: () => style.remove() };
}
