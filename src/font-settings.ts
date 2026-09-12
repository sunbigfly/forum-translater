// Font labels, deduplication and native invocation adapted from HN Reader Lite (MIT, sunbigfly).
import { fontFamilyCss, normalizeFonts, type FontSettings } from './fonts';
export interface LocalFontOption { family: string; label: string; searchText: string }
interface LocalFontWindow extends Window { queryLocalFonts?: () => Promise<readonly { family?: string }[]> }
export type LocalFontQuery = () => Promise<readonly string[]>;
const CHINESE_FONT_LABELS = Object.freeze<Record<string, string>>({
  "alibaba puhuiti": "阿里巴巴普惠体",
  dengxian: "等线",
  fangsong: "仿宋",
  "harmonyos sans sc": "鸿蒙黑体",
  "heiti sc": "黑体-简",
  "heiti tc": "黑体-繁",
  "hiragino sans gb": "冬青黑体简体中文",
  kaiti: "楷体",
  "kaiti sc": "楷体-简",
  "kaiti tc": "楷体-繁",
  "lxgw wenkai": "霞鹜文楷",
  "microsoft jhenghei": "微软正黑体",
  "microsoft jhenghei ui": "微软正黑体 UI",
  "microsoft yahei": "微软雅黑",
  "microsoft yahei ui": "微软雅黑 UI",
  "noto sans cjk sc": "思源黑体",
  "noto sans cjk tc": "思源黑体繁体",
  "noto serif cjk sc": "思源宋体",
  "noto serif cjk tc": "思源宋体繁体",
  nsimsun: "新宋体",
  "pingfang hk": "苹方-港",
  "pingfang sc": "苹方-简",
  "pingfang tc": "苹方-繁",
  simfang: "仿宋",
  simhei: "黑体",
  simkai: "楷体",
  simsun: "宋体",
  "smiley sans": "得意黑",
  "songti sc": "宋体-简",
  "songti tc": "宋体-繁",
  "source han sans sc": "思源黑体",
  "source han sans tc": "思源黑体繁体",
  "source han serif sc": "思源宋体",
  "source han serif tc": "思源宋体繁体",
  stfangsong: "华文仿宋",
  stheiti: "华文黑体",
  stkaiti: "华文楷体",
  stsong: "华文宋体",
  "wenquanyi micro hei": "文泉驿微米黑",
  "wenquanyi zen hei": "文泉驿正黑",
});

export function localFontOptions(families: readonly string[]): LocalFontOption[] {
  const unique = new Map<string, string>();
  for (const value of families) {
    const family = value.replace(/\s+/gu, ' ').trim();
    if (family && family.length <= 200 && !unique.has(family.toLocaleLowerCase('en-US'))) unique.set(family.toLocaleLowerCase('en-US'), family);
  }
  return [...unique.values()].map(family => {
    const chinese = CHINESE_FONT_LABELS[family.toLocaleLowerCase('en-US')];
    const label = chinese ? `${chinese}（${family}）` : family;
    return { family, label, searchText: `${label} ${family}`.normalize('NFKC').toLowerCase() };
  }).sort((a, b) => Number(/\p{Script=Han}/u.test(b.label)) - Number(/\p{Script=Han}/u.test(a.label)) || a.label.localeCompare(b.label, 'zh-CN'));
}
export function createLocalFontQuery(doc: Document): LocalFontQuery | undefined {
  const browser = doc.defaultView as LocalFontWindow | null;
  let native: LocalFontWindow['queryLocalFonts'];
  try { native = browser?.queryLocalFonts; } catch { return; }
  if (!browser || typeof native !== 'function') return;
  let cached: readonly string[] | undefined;
  let pending: Promise<readonly string[]> | undefined;
  return async () => {
    if (cached) return cached;
    if (pending) return pending;
    pending = Promise.resolve(Reflect.apply(native, browser, [])).then(entries => entries.map(entry => entry.family ?? ''));
    try { cached = await pending; return cached; } finally { pending = undefined; }
  };
}
const PRESETS: LocalFontOption[] = [
  { family: '', label: '跟随网站', searchText: '默认 跟随网站 default' },
  { family: 'system-ui', label: '系统字体', searchText: '系统 system-ui' },
  { family: 'sans-serif', label: '无衬线字体', searchText: '无衬线 sans-serif' },
  { family: 'serif', label: '衬线字体', searchText: '衬线 serif' },
  ...localFontOptions(['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Noto Serif CJK SC', 'LXGW WenKai']),
];
export function mountFontSettings(section: HTMLElement, current: FontSettings, query?: LocalFontQuery): { activate: () => void; read: () => FontSettings; valid: () => boolean; destroy: () => void } {
  let alive = true; let attempted = false; let loading = false; let local: LocalFontOption[] = [];
  let scope: keyof FontSettings = 'title';
  const drafts = { title: { family: current.title.family, size: current.title.size ? String(current.title.size) : '', search: '', scroll: 0, valid: true, badInput: false }, body: { family: current.body.family, size: current.body.size ? String(current.body.size) : '', search: '', scroll: 0, valid: true, badInput: false } };
  const tabs = new Map<keyof FontSettings, HTMLButtonElement>();
  const hint = document.createElement('p'); hint.className = 'font-hint'; hint.textContent = '原文与译文同步生效。留空跟随网站，代码保留等宽字体。';
  const load = document.createElement('button'); load.type = 'button'; load.textContent = '重试读取'; load.hidden = true; load.disabled = !query;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = query ? '进入字体页后自动读取本机字体。' : '当前浏览器不支持读取字体列表，可使用预设或手动填写字体名。';
  const catalog = document.createElement('div'); catalog.className = 'font-catalog'; catalog.append(status, load); section.append(hint, catalog);
  const tablist = document.createElement('div'); tablist.className = 'font-scope-tabs'; tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', '字体范围'); section.append(tablist);
  const group = document.createElement('div'); group.className = 'font-group'; group.id = 'ft-font-editor'; group.setAttribute('role', 'tabpanel'); section.append(group);
  const title = '标题';
  const familyLabel = document.createElement('label'); familyLabel.textContent = '字体名称';
  const family = document.createElement('input'); family.name = `font-${scope}-family`; family.type = 'text'; family.maxLength = 200; family.value = current[scope].family; family.placeholder = '选择下方字体，或输入名称'; familyLabel.append(family);
  const sizeLabel = document.createElement('label'); sizeLabel.textContent = '字号（px）';
  const size = document.createElement('input'); size.name = `font-${scope}-size`; size.type = 'number'; size.min = '10'; size.max = '72'; size.step = '1'; size.placeholder = '跟随网站'; size.value = current[scope].size ? String(current[scope].size) : ''; sizeLabel.append(size);
  const preview = document.createElement('div'); preview.className = 'font-preview'; preview.textContent = '阅读与思考 · Read & explore 0123'; preview.lang = 'zh-CN'; preview.setAttribute('aria-label', `${title}字体预览`);
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索字体（中文或英文名称）'; search.setAttribute('aria-label', `搜索${title}字体`);
  const list = document.createElement('div'); list.className = 'font-options'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', `${title}可用字体`);
  const updatePreview = (): void => {
    preview.style.fontFamily = fontFamilyCss(normalizeFonts({ [scope]: { family: family.value } })[scope].family);
    preview.style.fontSize = `${size.value && size.checkValidity() ? Number(size.value) : 18}px`;
    for (const button of list.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.family === family.value));
  };
  const renderList = (): void => {
    list.replaceChildren();
    const choices = new Map([...PRESETS, ...local].map(option => [option.family.toLowerCase(), option]));
    const term = search.value.normalize('NFKC').toLowerCase().trim();
    const matches = [...choices.values()].filter(option => option.searchText.includes(term));
    for (const option of matches.slice(0, 120)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'font-option'; button.dataset.family = option.family; button.title = option.label; button.setAttribute('aria-pressed', String(option.family === family.value));
      const name = document.createElement('span'); name.className = 'font-name'; name.textContent = option.label;
      const sample = document.createElement('span'); sample.className = 'font-sample'; sample.textContent = '中文预览 · Aa 0123'; sample.style.fontFamily = fontFamilyCss(option.family);
      button.append(name, sample); button.onclick = () => { family.value = option.family; updatePreview(); }; list.append(button);
    }
    if (!matches.length || matches.length > 120) { const note = document.createElement('p'); note.textContent = matches.length ? '输入名称继续缩小范围。' : '未找到匹配字体，也可在上方手动填写。'; list.append(note); }
  };
  search.oninput = renderList; family.oninput = updatePreview; size.oninput = updatePreview;
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'font-reset'; reset.textContent = `恢复${title}默认`;
  group.append(familyLabel, sizeLabel, preview, search, list, reset);
  const stash = (): void => { drafts[scope] = { family: family.value, size: size.value, search: search.value, scroll: list.scrollTop, valid: size.checkValidity(), badInput: size.validity.badInput || !!size.validationMessage && size.value === '' }; };
  const sync = (): void => {
    const draft = drafts[scope]; const label = scope === 'title' ? '标题' : '正文';
    family.name = `font-${scope}-family`; size.name = `font-${scope}-size`;
    family.value = draft.family; size.value = draft.size; search.value = draft.search;
    size.setCustomValidity(draft.badInput ? '请输入有效字号，或清空以跟随网站。' : '');
    preview.setAttribute('aria-label', `${label}字体预览`); search.setAttribute('aria-label', `搜索${label}字体`); list.setAttribute('aria-label', `${label}可用字体`);
    reset.textContent = `恢复${label}默认`; group.setAttribute('aria-labelledby', `ft-font-scope-${scope}`);
    for (const [key, tab] of tabs) { tab.setAttribute('aria-selected', String(key === scope)); tab.tabIndex = key === scope ? 0 : -1; }
    renderList(); updatePreview(); list.scrollTop = draft.scroll;
  };
  const select = (next: keyof FontSettings): void => { stash(); scope = next; sync(); };
  for (const [key, label] of [['title', '标题'], ['body', '正文']] as const) {
    const tab = document.createElement('button'); tab.type = 'button'; tab.id = `ft-font-scope-${key}`; tab.textContent = label; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', group.id);
    tab.onclick = () => select(key); tablist.append(tab); tabs.set(key, tab);
  }
  tablist.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'title' : event.key === 'End' ? 'body' : scope === 'title' ? 'body' : 'title';
    select(next); tabs.get(next)?.focus();
  };
  size.oninput = () => { size.setCustomValidity(''); updatePreview(); };
  reset.onclick = () => { family.value = ''; size.value = ''; size.setCustomValidity(''); search.value = ''; renderList(); updatePreview(); list.scrollTop = 0; };
  sync();
  const loadFonts = async (): Promise<void> => {
    if (!query || loading || !alive) return;
    loading = true; load.hidden = true; load.disabled = true; status.textContent = '正在读取本机字体…';
    try {
      const families = await query(); if (!alive) return;
      local = localFontOptions(families); renderList();
      status.textContent = `已读取 ${local.length} 种本机字体，可按中文或英文名称搜索。`;
    } catch { if (alive) { status.textContent = '未能读取本机字体，仍可使用预设或手动填写。'; load.hidden = false; } }
    finally { loading = false; if (alive) load.disabled = false; }
  };
  load.onclick = () => { void loadFonts(); };
  return {
    activate: () => { if (!attempted) { attempted = true; void loadFonts(); } },
    read: () => { stash(); return normalizeFonts({ title: { family: drafts.title.family, size: Number(drafts.title.size) }, body: { family: drafts.body.family, size: Number(drafts.body.size) } }); },
    valid: () => { stash(); const invalid = (['title', 'body'] as const).find(key => !drafts[key].valid); if (!invalid) return true; select(invalid); return false; },
    destroy: () => { alive = false; },
  };
}
