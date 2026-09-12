import { createLocalFontQuery, mountFontSettings } from './font-settings';
import { isXSite, TRANSLATION_THEMES, type TranslationTheme } from './settings';
import { stopWordSpeech } from './vocabulary';
import { renderWordbook } from './vocabulary-ui';
import { readTranslationMetrics } from './translation/metrics';
import { OWNED } from './reddit';
import { requestJson } from './translation/provider';
import { normalizeAiBaseUrl, normalizeSettings, validateAiProfile, type Settings } from './settings';
export function mountControls(read: () => Settings, save: (settings: Settings) => void, clearCache: () => void, saveCredentials?: (baseUrl: string, apiKey: string) => void): () => void {
  const host = document.createElement('div'); host.dataset.ftOwned = 'controls'; host.hidden = true; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Layout and palette adapted from the WSL Image Insight settings panel.
  style.textContent = `
    :host{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#172033;color-scheme:light}
    *{box-sizing:border-box}[hidden]{display:none!important}
    dialog{width:min(1120px,calc(100vw - 48px));height:min(90dvh,900px);max-width:none;max-height:none;padding:0;border:1px solid #ddd8cf;border-radius:22px;background:#f7f5ef;color:#172033;box-shadow:0 28px 80px #0c111e57}
    dialog::backdrop{background:#17203394;backdrop-filter:blur(3px)}
    button,input,select,textarea{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #cbc7bd;border-radius:9px;background:white;padding:9px 14px}
    button:hover{background:#eeeffb}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #4758d6;outline-offset:2px}
    .panel{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;margin:0}
    header{display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 24px;background:#ffffffb8;border-bottom:1px solid #ddd8cf}
    .brand{background:#172033;color:white;border-radius:8px;width:32px;height:32px;display:grid;place-items:center;font-weight:700}
    h1{font-size:16px;margin:0}header small{color:#707788;font-size:11px}header button{margin-left:auto;border:0;background:transparent;font-size:22px;padding:2px 10px}
    .layout{display:grid;grid-template-columns:176px minmax(0,1fr);gap:22px;padding:28px 32px;overflow:auto;scrollbar-gutter:stable;align-items:start}
    nav{position:sticky;top:0;display:grid;border-left:1px solid #ddd8cf}
    nav button{text-align:left;min-height:62px;border:0;border-radius:0;border-left:2px solid transparent;margin-left:-1px;background:transparent;padding:10px 14px}
    nav strong,nav small{display:block}nav strong{font-size:13px}nav small{font-size:11px;color:#707788;margin-top:3px}
    nav button[aria-selected=true]{border-left-color:#4758d6;background:#eef0ff;color:#4758d6}
    .content{min-width:0}.section{padding:22px;border:1px solid #ddd8cf;border-radius:14px;background:#fffefa}
    h2{font-size:15px;margin:0 0 18px}label{display:block;font-size:12px;font-weight:600;color:#424b5f;margin:16px 0}
    label:has(input[type=checkbox]){display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #e3dfd6;border-radius:9px;font-size:13px}
    input:not([type=checkbox]),select,textarea{display:block;width:100%;min-height:40px;padding:8px 10px;margin-top:6px;border:1px solid #cbc7bd;border-radius:9px;background:white;color:#172033;font-size:13px}
    input[type=checkbox]{width:17px;height:17px;accent-color:#4758d6;flex-shrink:0}textarea{resize:vertical;min-height:120px;line-height:1.6}
    fieldset{border:0;padding:0;margin:0;min-width:0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    p{font-size:12px;color:#707788;line-height:1.8}footer{padding:14px 24px;border-top:1px solid #ddd8cf;background:#ffffffb8;display:flex;align-items:center;justify-content:flex-end;gap:16px}
    [role=status]{margin:0;margin-right:auto;color:#4758d6}.actions{display:flex;gap:10px}.primary{background:#4758d6;color:white;border-color:#4758d6}.primary:hover{background:#3948b8}
    .font-hint{margin:0 0 10px;font-size:12px}.font-catalog{display:flex;align-items:center;gap:12px;min-height:30px;margin-bottom:20px}.font-catalog [role=status]{font-size:12px;font-weight:400;color:#707788}.font-catalog button{flex:none;font-size:12px;padding:5px 10px}
    .font-scope-tabs{display:flex;gap:4px;padding:4px;width:fit-content;background:#eeece6;border-radius:9px;margin:0 0 16px}.font-scope-tabs button{min-width:84px;padding:7px 20px;border:0;border-radius:6px;background:transparent;font-size:13px;color:#707788}.font-scope-tabs button[aria-selected=true]{background:#fff;color:#172033;box-shadow:0 1px 4px #17203312;font-weight:600}.font-group{border:1px solid #e3dfd6;border-radius:12px;padding:18px;background:#fff}.font-group label{font-size:12px;font-weight:500;margin:0 0 14px}.font-group input{font-weight:400}.font-group input[type=search]{margin:0 0 10px;font-size:12px}
    .font-preview{height:104px;display:flex;align-items:safe center;padding:16px;margin:4px 0 16px;background:#f7f6f2;border:1px solid #eeebe5;border-radius:8px;overflow:auto;overflow-wrap:anywhere;line-height:1.6;color:#172033;font-weight:400}
    .font-options{height:236px;overflow:auto;scrollbar-gutter:stable;margin:0 0 14px;display:grid;grid-auto-rows:64px;align-content:start;gap:5px}.font-option{text-align:left;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:8px 11px;border:1px solid transparent;border-radius:7px;background:#faf9f6;min-width:0;line-height:1.4}.font-name{font-size:12px;font-weight:500;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.font-option:hover{background:#f0eee8}.font-option[aria-pressed=true]{border-color:#c4caf2;background:#eef0ff;box-shadow:inset 3px 0 #5966c7}.font-sample{font-size:15px;font-weight:400;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;color:#424b5f}.font-reset{padding:5px 0;border:0;background:transparent;font-size:12px;color:#707788}.font-reset:hover{background:transparent;color:#4758d6}

    @media(max-width:680px){dialog{width:calc(100vw - 20px);height:94dvh;border-radius:16px}.layout{display:block;padding:16px}nav{position:static;display:flex;overflow:auto;border-left:0;border-bottom:1px solid #ddd8cf;margin-bottom:16px}nav button{flex:1;white-space:nowrap;min-height:44px;border-left:0;border-bottom:2px solid transparent;padding:8px}nav button[aria-selected=true]{border-bottom-color:#4758d6}nav small{display:none}.section{padding:16px}.pair{grid-template-columns:1fr;gap:0}footer{padding:12px 16px;flex-wrap:wrap}header{padding:12px 16px}}
  `;
  shadow.append(style);
  const queryFonts = createLocalFontQuery(document);
  let fontControls: ReturnType<typeof mountFontSettings> | undefined;
  let disposeWordbook: (() => void) | undefined;
  let modelRequest: AbortController | undefined;
  let modelTimer: ReturnType<typeof setTimeout> | undefined;
  let previousFocus: HTMLElement | null = null;
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', `${isXSite() ? 'X' : 'Reddit'} 翻译设置`); shadow.append(dialog);
  const panel = document.createElement('form'); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', `${isXSite() ? 'X' : 'Reddit'} 翻译设置`); dialog.append(panel); panel.noValidate = true;
  function render(): void {
    panel.replaceChildren(); const current = read();
    const header = document.createElement('header');
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = '译';
    const title = document.createElement('div'); const heading = document.createElement('h1'); heading.textContent = 'forum-translator';
    const subtitle = document.createElement('small'); subtitle.textContent = '翻译设置'; title.append(heading, subtitle);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', '关闭设置'); dismiss.onclick = () => setOpen(false);
    header.append(brand, title, dismiss); panel.append(header);
    const layout = document.createElement('div'); layout.className = 'layout'; panel.append(layout);
    const nav = document.createElement('nav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '设置分类');
    const content = document.createElement('div'); content.className = 'content'; layout.append(nav, content);
    const sections = new Map<string, HTMLElement>(); const tabs = new Map<string, HTMLButtonElement>();
    const activate = (id: string): void => {
      if (id === 'fonts') fontControls?.activate();
      for (const [key, section] of sections) section.hidden = key !== id;
      for (const [key, tab] of tabs) { tab.setAttribute('aria-selected', String(key === id)); tab.tabIndex = key === id ? 0 : -1; }
    };
    for (const [id, name, description] of [['api', '接口', '地址、密钥与模型'], ['scope', '翻译范围', '内容与预加载'], ['fonts', '字体', '标题、正文与预览'], ['words', '单词本', '列表管理与词典详情'], ['cache', '缓存与说明', '本地数据与隐私']] as const) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.id = `ft-tab-${id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `ft-panel-${id}`);
      const strong = document.createElement('strong'); strong.textContent = name; const small = document.createElement('small'); small.textContent = description; tab.append(strong, small);
      tab.onclick = () => activate(id); nav.append(tab); tabs.set(id, tab);
      const section = document.createElement('section'); section.className = 'section'; section.id = `ft-panel-${id}`; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', tab.id);
      const sectionTitle = document.createElement('h2'); sectionTitle.textContent = name; section.append(sectionTitle); content.append(section); sections.set(id, section);
    }
    nav.onkeydown = event => {
      const all = [...tabs.entries()]; const index = all.findIndex(([, tab]) => tab === shadow.activeElement);
      if (index < 0 || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + all.length) % all.length;
      const entry = all[next]; if (entry) { activate(entry[0]); entry[1].focus(); }
    };
    const api = sections.get('api'); const scope = sections.get('scope'); const cache = sections.get('cache');
    if (!api || !scope || !cache) throw new Error('Missing settings sections');
    activate('api');
    const fontSection = sections.get('fonts');
    if (fontSection) fontControls = mountFontSettings(fontSection, current.fonts, queryFonts);
    let target = scope;
    const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    function input(name: string, text: string, type: string, value: string | boolean): HTMLInputElement {
      const label = document.createElement('label'); const field = document.createElement('input'); field.name = name; field.type = type;
      if (typeof value === 'boolean') field.checked = value; else field.value = value;
      if (type === 'number') { field.min = '0'; field.max = '5000'; field.step = '100'; }
      if (type === 'password') field.autocomplete = 'off';
      if (type === 'checkbox') label.append(field, ` ${text}`); else label.append(text, field);
      target.append(label); fields.set(name, field); return field;
    }
    input('translationOnly', `只显示译文（${isXSite() ? 'X' : 'Reddit'} 全站生效）`, 'checkbox', current.translationOnly);
    const themeLabel = document.createElement('label'); themeLabel.textContent = '译文样式';
    const theme = document.createElement('select'); theme.name = 'translationTheme';
    for (const [value, name] of Object.entries(TRANSLATION_THEMES)) { const option = document.createElement('option'); option.value = value; option.textContent = name; theme.append(option); }
    theme.value = current.translationTheme; themeLabel.append(theme); scope.append(themeLabel);
    input('enabled', '开启本页及后续页面自动翻译', 'checkbox', current.enabled);
    input('vocabulary', '整篇翻译完成后自动生成词汇学习（使用 AI 配置）', 'checkbox', current.vocabulary);
    const wordbook = sections.get('words'); if (wordbook) disposeWordbook = renderWordbook(wordbook);
    for (const [key, label] of [['title', '帖子标题'], ['body', '帖子正文'], ['comment', '评论']] as const) {
      const field = input(key, isXSite() && key === 'body' ? '推文、回复与引用推文' : label, 'checkbox', current[key]);
      if (isXSite() && key !== 'body' && field.parentElement) field.parentElement.hidden = true;
    }
    input('before', '向上预加载（像素）', 'number', String(current.before));
    input('after', '向下预加载（像素）', 'number', String(current.after));
    if (isXSite()) {
      input('xCollapseSidebar', 'X 左侧导航仅显示图标（悬停 X 标志可展开）', 'checkbox', current.xCollapseSidebar);
      input('xHideRightSidebar', '隐藏 X 右栏（左右栏收起时正文占页宽 70%，居中）', 'checkbox', current.xHideRightSidebar);
      input('xHideAds', '隐藏 X 信息流广告（取消勾选恢复）', 'checkbox', current.xHideAds);
      input('xHideFloatingIcons', '隐藏 X 右下角 Grok / 聊天悬浮入口（取消勾选恢复）', 'checkbox', current.xHideFloatingIcons);
    }
    target = api;
    const label = document.createElement('label'); label.textContent = '翻译服务';
    const provider = document.createElement('select'); provider.name = 'provider';
    for (const [value, name] of [['google', 'Google'], ['microsoft', 'Microsoft'], ['ai', 'AI（Responses）']]) {
      const option = document.createElement('option'); option.value = value ?? ''; option.textContent = name ?? ''; provider.append(option);
    }
    provider.value = current.provider; label.append(provider); api.append(label); fields.set('provider', provider);
    const aiFields = document.createElement('fieldset'); api.append(aiFields);
    for (const [name, title, type] of [
      ['baseUrl', 'AI Base URL（含 /v1，不含 /responses）', 'url'],
      ['apiKey', 'API Key（保存在当前脚本中）', 'password'],
      ['model', '模型名称', 'text'], ['prompt', '额外翻译要求', 'text'],
      ['requestsPerMinute', '每分钟请求数', 'number'], ['tokensPerMinute', '每分钟估算 Token 上限（0 不限制）', 'number'],
    ] as const) {
      const field = input(name, title, type, String(current.ai[name]));
      if (type === 'number') { field.min = name === 'requestsPerMinute' ? '1' : '0'; field.max = '1000000'; field.step = '1'; }
      if (field.parentElement) aiFields.append(field.parentElement);
      if (name === 'prompt') { const textarea = document.createElement('textarea'); textarea.name = name; textarea.value = current.ai.prompt; textarea.placeholder = '例如：保留技术术语，使用自然简洁的中文。'; field.replaceWith(textarea); fields.set(name, textarea); }
    }
    const originalModel = fields.get('model') as HTMLInputElement;
    const model = document.createElement('select'); model.name = 'model'; model.required = true;
    originalModel.replaceWith(model); fields.set('model', model);
    const resetModels = (hint: string): void => {
      const selected = model.value || current.ai.model;
      model.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = hint; placeholder.disabled = true; model.append(placeholder);
      if (selected) { const option = document.createElement('option'); option.value = selected; option.textContent = selected; model.append(option); }
      model.value = selected;
    };
    resetModels('请先获取模型列表');
    const effortLabel = document.createElement('label'); effortLabel.textContent = '思考深度';
    const effort = document.createElement('select'); effort.name = 'reasoningEffort';
    for (const [value, label] of [['none', 'none · 更快（需模型支持）'], ['low', 'low · 轻量思考']]) {
      const option = document.createElement('option'); option.value = value ?? ''; option.textContent = label ?? ''; effort.append(option);
    }
    effort.value = current.ai.reasoningEffort ?? 'low'; effortLabel.append(effort); aiFields.append(effortLabel);
    const fastLabel = document.createElement('label');
    const fast = document.createElement('input'); fast.type = 'checkbox'; fast.name = 'fastMode'; fast.checked = current.ai.fastMode === true;
    fastLabel.append(fast, 'Fast 模式（服务商支持时加速，可能增加费用或额度消耗）'); aiFields.append(fastLabel);
    const modelStatus = document.createElement('p'); modelStatus.setAttribute('aria-live', 'polite'); modelStatus.id = 'ft-model-status'; model.setAttribute('aria-describedby', modelStatus.id);
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = '刷新模型列表';
    model.parentElement?.after(modelStatus, refresh);
    const fetchModels = async (): Promise<void> => {
      modelRequest?.abort(); resetModels('正在获取模型…');
      if (provider.value !== 'ai') return;
      const base = fields.get('baseUrl')?.value.trim() ?? ''; const key = fields.get('apiKey')?.value.trim() ?? '';
      if (!base || !key) { resetModels('请填写地址和密钥'); modelStatus.textContent = '填写地址和密钥后自动获取模型。'; return; }
      const controller = new AbortController(); modelRequest = controller; modelStatus.textContent = '正在获取模型…';
      try {
        const baseUrl = normalizeAiBaseUrl(base);
        saveCredentials?.(baseUrl, key);
        modelStatus.textContent = '地址与密钥已保存，正在获取模型…';
        const data = await requestJson(`${baseUrl}/models`, controller.signal, undefined, key);
        if (controller.signal.aborted) return;
        const items: unknown = data && typeof data === 'object' && 'data' in data ? data.data : undefined;
        const ids = Array.isArray(items) ? [...new Set(items.flatMap((item: unknown) => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' && item.id.trim() ? [item.id.trim()] : []))].sort() : [];
        if (!ids.length) throw new Error('Empty model list');
        const selected = model.value; resetModels('请选择模型');
        for (const id of ids.slice(0, 500)) {
          if ([...model.options].some(option => option.value === id)) continue;
          const option = document.createElement('option'); option.value = id; option.textContent = id; model.append(option);
        }
        model.value = selected;
        modelStatus.textContent = `已获取 ${ids.length} 个模型，请从下拉列表选择。`;
      } catch (error) { if (!controller.signal.aborted) { resetModels('获取失败，请点击刷新'); modelStatus.textContent = error instanceof Error && /HTTP \d+|超时/.test(error.message) ? `模型获取失败：${error.message}` : '模型获取失败，请检查地址、密钥和油猴域名授权，再点击刷新。'; } }
    };
    const scheduleModels = (): void => {
      modelRequest?.abort(); clearTimeout(modelTimer); resetModels('等待获取模型…');
      modelTimer = setTimeout(() => { void fetchModels(); }, 500);
    };
    for (const name of ['baseUrl', 'apiKey']) {
      fields.get(name)?.addEventListener('input', scheduleModels);
      fields.get(name)?.addEventListener('change', scheduleModels);
    }
    refresh.onclick = () => { clearTimeout(modelTimer); void fetchModels(); };
    const updateProvider = (): void => { aiFields.hidden = provider.value !== 'ai'; aiFields.disabled = aiFields.hidden; clearTimeout(modelTimer); void fetchModels(); };
    provider.onchange = updateProvider; updateProvider();
    const notice = document.createElement('p'); notice.textContent = '译文显示在原文下方。只翻译网站已加载且靠近视口的内容；匹配文本会发送至所选服务。Google / Microsoft 无需密钥；AI 使用支持 Responses 的服务，按服务商规则计费。'; cache.append(notice);
    const footer = document.createElement('footer'); panel.append(footer);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); footer.append(status);
    const actions = document.createElement('div'); actions.className = 'actions'; footer.append(actions);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '保存并应用'; submit.className = 'primary'; actions.append(submit);
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '清除译文缓存'; clear.onclick = () => { clearCache(); status.textContent = '缓存已清除，已显示的译文保留。'; }; cache.append(clear);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => setOpen(false); actions.append(close);
    panel.onsubmit = event => {
      event.preventDefault(); const next = { ...current };
      if (fontControls && !fontControls.valid()) { activate('fonts'); fontSection?.querySelector<HTMLInputElement>('input:invalid')?.reportValidity(); return; }
      next.fonts = fontControls?.read() ?? current.fonts;
      next.translationTheme = theme.value as TranslationTheme;
      for (const name of ['xCollapseSidebar', 'xHideFloatingIcons', 'xHideRightSidebar', 'xHideAds'] as const) { const field = fields.get(name); if (field instanceof HTMLInputElement) next[name] = field.checked; }
      for (const name of ['enabled', 'title', 'body', 'comment', 'translationOnly', 'vocabulary'] as const) next[name] = (fields.get(name) as HTMLInputElement).checked;
      for (const name of ['before', 'after'] as const) next[name] = Number(fields.get(name)?.value);
      next.provider = provider.value === 'ai' ? 'ai' : provider.value === 'microsoft' ? 'microsoft' : 'google';
      next.ai = { ...current.ai };
      next.ai.reasoningEffort = effort.value === 'none' ? 'none' : 'low'; next.ai.fastMode = fast.checked;
      for (const name of ['baseUrl', 'apiKey', 'model', 'prompt'] as const) next.ai[name] = fields.get(name)?.value.trim() ?? '';
      for (const name of ['requestsPerMinute', 'tokensPerMinute'] as const) next.ai[name] = Number(fields.get(name)?.value);
      if (next.provider === 'ai') {
        try { validateAiProfile(next.ai); } catch (error) { activate('api'); status.textContent = error instanceof Error ? error.message : '请检查 AI 配置'; return; }
      }
      for (const field of fields.values()) {
        if (!field.matches(':disabled') && !field.checkValidity()) { activate(aiFields.contains(field) || field === provider ? 'api' : 'scope'); field.reportValidity(); return; }
      }
      save(normalizeSettings(next)); setOpen(false);
    };
  }
  function setOpen(open: boolean): void {
    disposeWordbook?.(); disposeWordbook = undefined; fontControls?.destroy(); fontControls = undefined;
    if (!open) stopWordSpeech(shadow);
    modelRequest?.abort(); clearTimeout(modelTimer);
    if (open) {
      if (panel.hidden) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render();
    }
    panel.hidden = !open; host.hidden = !open;
    if (open) { if (!dialog.open) dialog.showModal(); panel.querySelector<HTMLButtonElement>('header button')?.focus(); } else { dialog.close(); panel.replaceChildren(); panel.onsubmit = null; if (previousFocus?.isConnected) previousFocus.focus(); }
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); setOpen(false); });
  shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape' && !panel.hidden) setOpen(false); });
  const menu = GM_registerMenuCommand(`${isXSite() ? 'X' : 'Reddit'} 翻译设置`, () => setOpen(true));
  const metricsMenu = GM_registerMenuCommand('翻译性能统计（当前页面）', () => { alert(JSON.stringify(readTranslationMetrics(), null, 2)); });
  // Guard helps hot-reload owners distinguish this surface from host DOM.
  if (!host.matches(OWNED)) throw new Error('Missing UI ownership');
  return () => { fontControls?.destroy(); disposeWordbook?.(); stopWordSpeech(shadow); modelRequest?.abort(); clearTimeout(modelTimer); if (dialog.open) dialog.close(); GM_unregisterMenuCommand(menu); GM_unregisterMenuCommand(metricsMenu); host.remove(); };
}
