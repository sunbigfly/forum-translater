export type Kind = 'title' | 'body' | 'comment';
export const TRANSLATION_THEMES = { quote: '淡灰引用', plain: '自然正文', weakening: '弱化译文', 'dividing-line': '分隔线', underline: '下划线', highlight: '柔和高亮', paper: '纸张卡片' } as const;
export type TranslationTheme = keyof typeof TRANSLATION_THEMES;
export interface AiProfile { baseUrl: string; apiKey: string; model: string; prompt: string; requestsPerMinute: number; tokensPerMinute: number; reasoningEffort?: 'none' | 'low'; fastMode?: boolean }
export interface Settings {
  xCollapseSidebar: boolean; xHideFloatingIcons: boolean; xHideRightSidebar: boolean; xHideAds: boolean;
  translationOnly: boolean; enabled: boolean; title: boolean; body: boolean; comment: boolean; vocabulary: boolean;
  before: number; after: number; provider: 'google' | 'microsoft' | 'ai'; ai: AiProfile; translationTheme: TranslationTheme;
}
export const DEFAULTS: Settings = { xHideAds: true, xCollapseSidebar: true, xHideFloatingIcons: true, xHideRightSidebar: true, translationTheme: 'quote', translationOnly: false, enabled: true, title: true, body: true, comment: true, vocabulary: true, before: 600, after: 1200, provider: 'google', ai: { baseUrl: '', apiKey: '', model: '', prompt: '', requestsPerMinute: 30, tokensPerMinute: 0, reasoningEffort: 'low', fastMode: false } };
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const value = { ...DEFAULTS, ai: { ...DEFAULTS.ai } };
  value.ai.reasoningEffort = raw.ai?.reasoningEffort === 'none' ? 'none' : 'low';
  value.ai.fastMode = raw.ai?.fastMode === true;
  for (const key of ['baseUrl', 'apiKey', 'model', 'prompt'] as const) if (typeof raw.ai?.[key] === 'string') value.ai[key] = raw.ai[key].trim();
  for (const key of ['requestsPerMinute', 'tokensPerMinute'] as const) {
    const number = raw.ai?.[key];
    if (typeof number === 'number' && Number.isFinite(number)) value.ai[key] = Math.max(key === 'requestsPerMinute' ? 1 : 0, Math.min(1000000, Math.round(number)));
  }
  for (const key of ['enabled', 'title', 'body', 'comment', 'translationOnly', 'vocabulary', 'xCollapseSidebar', 'xHideFloatingIcons', 'xHideRightSidebar', 'xHideAds'] as const) if (typeof raw[key] === 'boolean') value[key] = raw[key];
  for (const key of ['before', 'after'] as const) {
    const number = raw[key];
    if (typeof number === 'number' && Number.isFinite(number)) value[key] = Math.min(5000, Math.max(0, Math.round(number)));
  }
  if (raw.provider === 'google' || raw.provider === 'microsoft' || raw.provider === 'ai') value.provider = raw.provider;
  if (raw.translationTheme && Object.hasOwn(TRANSLATION_THEMES, raw.translationTheme)) value.translationTheme = raw.translationTheme;
  return value;
}

// Adapted from HN settings-store: only explicit local services may use HTTP.
export function normalizeAiBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('AI 地址必须使用 HTTPS；本机服务可使用 HTTP');
  if (url.search || url.hash) throw new Error('AI 地址不能包含查询参数或片段');
  return url.href.replace(/\/+$/, '');
}
export function validateAiProfile(ai: AiProfile): void {
  normalizeAiBaseUrl(ai.baseUrl);
  if (!ai.apiKey.trim() || !ai.model.trim()) throw new Error('请填写 AI API Key 和模型');
}
export function loadSettings(): Settings {
  const settings = normalizeSettings(GM_getValue<Partial<Settings>>('ft:settings:v1', {}));
  settings.ai.apiKey = GM_getValue<string>('ft:ai-key:v1', '');
  settings.translationOnly = loadTranslationOnly();
  return settings;
}
export function saveSettings(settings: Settings): void {
  GM_setValue('ft:ai-key:v1', settings.ai.apiKey);
  GM_setValue('ft:settings:v1', { ...settings, translationOnly: false, ai: { ...settings.ai, apiKey: '' } });
}

export function isXSite(host = location.hostname): boolean { return /(^|\.)(x|twitter)\.com$/.test(host); }

function displayKey(url = location.href): string {
  const page = new URL(url);
  const host = page.hostname === 'reddit.com' || page.hostname.endsWith('.reddit.com') ? 'reddit.com' : isXSite(page.hostname) ? 'x.com' : page.hostname;
  return `ft:display-site:${host}/*`;
}
export function loadTranslationOnly(url = location.href): boolean {
  const key = displayKey(url);
  const stored = GM_getValue<unknown>(key, null);
  if (typeof stored === 'boolean') return stored;
  // Migrate an existing page preference once; the site preference wins thereafter.
  const page = new URL(url); page.hash = '';
  const legacy = GM_getValue<unknown>(`ft:display:${page.href}`, null);
  if (typeof legacy === 'boolean') { GM_setValue(key, legacy); return legacy; }
  return false;
}
export function saveTranslationOnly(value: boolean, url?: string): void { GM_setValue(displayKey(url), value); }
