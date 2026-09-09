import { chineseExampleParts, simplifiedChinese } from './wordbook-chinese';
import { localWord } from './wordbook-ecdict';
import { cachedWordData, persistWordData } from './wordbook-cache';
import { wordbookIcon } from './wordbook-icons';
import { readWordbook, removeWord, stopWordSpeech, type SavedWord, type VocabularyWord } from './vocabulary';
import { requestJson } from './translation/provider';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
function action(text: string, run: () => void): HTMLButtonElement {
  const element = node('button', text); element.type = 'button'; element.onclick = run;
  const icons: Record<string, Parameters<typeof wordbookIcon>[0]> = { '返回单词本': 'arrow-left', '上一页': 'chevron-left', '下一页': 'chevron-right', '移除': 'trash-2', '移除收藏': 'trash-2', '重试查询': 'rotate-cw' };
  const icon = icons[text]; if (icon) { element.className = 'wb-icon'; element.title = text; element.setAttribute('aria-label', text); element.replaceChildren(wordbookIcon(icon), node('span', text, 'wb-sr-only')); }
  return element;
}
function select(label: string, options: [string, string][]): HTMLSelectElement {
  const element = node('select'); element.setAttribute('aria-label', label);
  for (const [value, text] of options) { const option = node('option', text); option.value = value; element.append(option); }
  return element;
}
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value as unknown[] : []; }
function link(label: string, value: unknown): HTMLAnchorElement | undefined {
  try {
    const url = new URL(text(value)); if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    const element = node('a', label); element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer';
    if (label === '打开收藏来源' || label === '打开在线词典') { element.className = 'wb-icon'; element.title = label; element.setAttribute('aria-label', label); element.replaceChildren(wordbookIcon('external-link'), node('span', label, 'wb-sr-only')); }
    return element;
  } catch { return; }
}

function plainText(value: unknown): string {
  const template = document.createElement('template'); template.innerHTML = text(value); return template.content.textContent?.trim() ?? '';
}

// Bound each provider independently and cancel its underlying GM request before falling back.
async function dictionaryRequest(url: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController(); let timedOut = false;
  const abort = (): void => controller.abort(); signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
  try { return await requestJson(url, controller.signal); }
  catch (error) { if (timedOut && !signal.aborted) throw new Error('dictionary-timeout', { cause: error }); throw error; }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function validEntries(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(entry => array(record(entry).meanings).some(meaning => array(record(meaning).definitions).some(definition => text(record(definition).definition))));
}
export async function queryDictionary(word: string, signal: AbortSignal): Promise<unknown[]> {
  signal.throwIfAborted(); const hit = cachedWordData('wiktionary', word, validEntries); if (hit) return hit.value;
  const data = record(await dictionaryRequest(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, signal));
  const meanings = array(data.en).map(value => {
    const item = record(value);
    return { partOfSpeech: text(item.partOfSpeech), definitions: array(item.definitions).slice(0, 20).map(value => {
      const definition = record(value);
      const examples = array(definition.parsedExamples).map(value => plainText(record(value).example)).filter(Boolean);
      return { definition: plainText(definition.definition), example: examples.slice(0, 3).join('\n') || array(definition.examples).slice(0, 3).map(plainText).filter(Boolean).join('\n') };
    }).filter(item => item.definition) };
  });
  if (!meanings.some(item => item.definitions.length)) throw new Error('404');
  const entries = [{ meanings, sourceUrls: [`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`], provider: 'Wiktionary' }];
  signal.throwIfAborted(); persistWordData('wiktionary', word, entries); return entries;
}

interface BilingualExample { id: number; english: string; chinese: string; translationId: number; owner: string; translationOwner: string; license: string; translationLicense: string }
function validExamples(value: unknown): value is BilingualExample[] {
  return Array.isArray(value) && value.every(item => typeof record(item).id === 'number' && typeof record(item).translationId === 'number' && ['english', 'chinese', 'owner', 'translationOwner', 'license', 'translationLicense'].every(key => typeof record(item)[key] === 'string'));
}
export async function queryExamples(word: string, signal: AbortSignal): Promise<BilingualExample[]> {
  signal.throwIfAborted(); const hit = cachedWordData('tatoeba', word, validExamples);
  if (hit && (hit.value.length || Date.now() - hit.savedAt < 86400000)) return hit.value;
  const url = new URL('https://api.tatoeba.org/v1/sentences');
  for (const [key, value] of Object.entries({ sort: 'relevance', lang: 'eng', q: `"${word}"`, 'trans:lang': 'cmn', 'trans:is_direct': 'yes', 'trans:is_unapproved': 'no', 'trans:is_orphan': 'no', is_unapproved: 'no', is_orphan: 'no', showtrans: 'matching', limit: '10' })) url.searchParams.set(key, value);
  const data = record(await dictionaryRequest(url.href, signal));
  if (!Array.isArray(data.data)) throw new Error('例句响应格式错误');
  const examples = data.data.flatMap(value => {
    const sentence = record(value); const translation = array(sentence.translations).map(record).find(item => item.lang === 'cmn' && text(item.text));
    if (!translation || typeof sentence.id !== 'number' || typeof translation.id !== 'number' || !text(sentence.text)) return [];
    return [{ id: sentence.id, english: text(sentence.text), chinese: text(translation.text), translationId: translation.id, owner: text(sentence.owner), translationOwner: text(translation.owner), license: text(sentence.license), translationLicense: text(translation.license) }];
  }).sort((a, b) => a.english.length - b.english.length).slice(0, 3);
  signal.throwIfAborted(); persistWordData('tatoeba', word, examples); return examples;
}

export function mountWordbook(root: HTMLElement, sound: (word: VocabularyWord, status: HTMLElement) => HTMLButtonElement): () => void {
  stopWordSpeech(root); root.replaceChildren(); root.classList.add('ft-wordbook');
  const style = node('style'); style.textContent = `
    .ft-wordbook .wb-toolbar,.ft-wordbook .wb-pages,.ft-wordbook .wb-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .ft-wordbook .wb-heading{justify-content:space-between;margin-bottom:16px}.ft-wordbook h2{margin:0}.ft-wordbook h3{font-size:14px;margin:20px 0 8px}
    .ft-wordbook .wb-toolbar{margin:16px 0}.ft-wordbook .wb-toolbar input{flex:1 1 180px;width:auto;margin:0}.ft-wordbook .wb-toolbar select{flex:0 1 auto;width:auto;margin:0}
    .ft-wordbook .wb-list{list-style:none;margin:0;padding:0}.ft-wordbook .wb-row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #e3dfd6;padding:10px 0}
    .ft-wordbook .wb-open{flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:4px}.ft-wordbook .wb-open:hover{background:#eeeffb}
    .ft-wordbook .wb-open strong{font-size:15px}.ft-wordbook .wb-open span{display:block;color:#707788;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ft-wordbook .wb-meta{font-size:11px;color:#707788}.ft-wordbook .wb-pages{justify-content:flex-end;margin-top:18px}.ft-wordbook button:disabled{opacity:.45;cursor:default}
    .ft-wordbook .wb-detail{overflow-wrap:anywhere;isolation:isolate}.ft-wordbook .wb-detail p{white-space:pre-wrap}.ft-wordbook .wb-detail .word-card strong{font-size:24px;margin-right:12px}
    .ft-wordbook .wb-dictionary{min-height:120px}.ft-wordbook .wb-dictionary li{margin:10px 0;font-size:13px}
    .ft-wordbook a{color:#4758d6}.ft-wordbook [role=status]:empty{display:none}.ft-wordbook .wb-status{margin:10px 0}
    .ft-wordbook .wb-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:7px!important;flex-shrink:0;border:1px solid transparent;border-radius:7px;background:transparent;color:#707788;text-decoration:none}.ft-wordbook .wb-icon:hover{color:#4758d6;background:#eeeffb}.ft-wordbook .wb-icon[aria-label^="移除"]:hover{color:#b42318;background:#fff0ed}.ft-wordbook .wb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.ft-wordbook .wb-detail-actions{flex-direction:row;align-items:center}
    .ft-wordbook{overflow-anchor:none}.ft-wordbook .wb-detail-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-28px;z-index:2;background:#fffefa;border-radius:13px 13px 0 0;border-bottom:1px solid #e3dfd6;margin:-22px -22px 0;padding:8px 22px;color:#707788;font-size:12px}
    .ft-wordbook .wb-detail-nav button{padding:6px 10px}.ft-wordbook .wb-hero{padding:22px 0 18px}.ft-wordbook .wb-wordline{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ft-wordbook .wb-wordline strong{font-size:28px;line-height:1.2}.ft-wordbook .wb-wordline button{padding:6px;display:inline-flex}.ft-wordbook .wb-ipa{font-size:13px;color:#707788}.ft-wordbook .wb-meaning{font-size:16px;color:#172033;margin:12px 0 0}
    .ft-wordbook .wb-columns{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:24px;align-items:start}.ft-wordbook .wb-main{min-width:0}.ft-wordbook .wb-study{background:#f7f5ef;border-radius:10px;padding:16px}.ft-wordbook .wb-study h3,.ft-wordbook .wb-dictionary>h3{margin-top:0}
    .ft-wordbook .wb-study dl{font-size:12px}.ft-wordbook .wb-study dt{color:#707788;margin-top:12px}.ft-wordbook .wb-study dd{margin:3px 0}.ft-wordbook .wb-badge{font-size:11px;color:#4758d6;background:#eeeffb;border-radius:5px;padding:3px 7px;display:inline-block}
    .ft-wordbook .wb-detail-actions{display:flex;align-items:flex-start;flex-direction:row;gap:8px;font-size:12px;margin-top:18px}.ft-wordbook .wb-detail-actions button{padding:6px 10px}.ft-wordbook .wb-source-tabs{display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid #e3dfd6;padding-bottom:10px}.ft-wordbook .wb-source-tabs button{border:0;padding:7px 10px;font-size:12px;background:transparent}.ft-wordbook .wb-source-tabs button[aria-selected=true]{background:#eeeffb;color:#3948b8}.ft-wordbook mark{background:#eeeffb;color:#3948b8;border-radius:3px;padding:0 2px}.ft-wordbook .wb-example-source{font-size:10px}.ft-wordbook .wb-examples{border-top:1px solid #e3dfd6;margin-top:20px}.ft-wordbook .wb-examples p{color:#172033}.ft-wordbook .wb-examples .wb-muted{color:#707788}.ft-wordbook summary{cursor:pointer;font-size:12px;color:#4758d6;margin-top:14px}.ft-wordbook .wb-attribution{font-size:11px;border-top:1px solid #e3dfd6;margin:24px 0 0;padding-top:12px}.ft-wordbook .wb-dictionary>a{display:inline-block;margin:12px;font-size:12px}
    @media(max-width:900px){.ft-wordbook .wb-columns{grid-template-columns:1fr}.ft-wordbook .wb-study{margin-top:4px}.ft-wordbook .wb-detail-actions{flex-direction:row;align-items:center}}
    @media(max-width:680px){.ft-wordbook .wb-detail-nav{top:-16px;margin:-16px -16px 0;padding:8px 16px}.ft-wordbook .wb-row{gap:6px}.ft-wordbook .wb-row>button{padding:7px}.ft-wordbook .wb-meta{display:none}.ft-wordbook .wb-pages{justify-content:space-between}}
  `;
  const heading = node('div', '', 'wb-heading'); const title = node('h2', '单词本'); const info = node('p');
  const status = node('p', '', 'wb-status'); status.setAttribute('role', 'status');
  const toolbar = node('div', '', 'wb-toolbar'); const search = node('input'); search.type = 'search'; search.placeholder = '搜索单词或中文释义'; search.setAttribute('aria-label', '搜索单词本');
  const sort = select('排序', [['new', '最近收藏'], ['az', '单词 A–Z']]);
  const size = select('每页条数', [['10', '10 词 / 页'], ['20', '20 词 / 页'], ['50', '50 词 / 页']]);
  toolbar.append(search, sort, size);
  const list = node('ul', '', 'wb-list'); const pages = node('div', '', 'wb-pages'); pages.setAttribute('aria-label', '单词本分页');
  const detail = node('div', '', 'wb-detail'); detail.hidden = true;
  const scroller = root.closest<HTMLElement>('.layout');
  let listScroll = 0;
  let page = 1; let request: AbortController | undefined; let returnWord = ''; let exampleRequest: AbortController | undefined;
  const cancel = (): void => { exampleRequest?.abort(); request?.abort(); request = undefined; stopWordSpeech(root); };
  const showList = (): void => {
    cancel(); detail.hidden = true; detail.replaceChildren(); toolbar.hidden = false; search.hidden = false; list.hidden = false; pages.hidden = false; title.textContent = '单词本'; heading.hidden = false; info.hidden = false; status.textContent = ''; render();
    const target = [...list.querySelectorAll<HTMLButtonElement>('.wb-open')].find(item => item.dataset.word === returnWord); (target ?? search).focus({ preventScroll: true }); if (scroller) scroller.scrollTop = listScroll;
  };
  const enter = (name: string): void => {
    cancel(); status.textContent = ''; title.textContent = name; heading.hidden = true; info.hidden = true; toolbar.hidden = true; search.hidden = true; list.hidden = true; pages.hidden = true; detail.hidden = false; detail.replaceChildren();
    const bar = node('div', '', 'wb-detail-nav'); const back = action('返回单词本', showList); bar.append(back, node('span', name)); detail.append(bar); back.focus({ preventScroll: true }); if (scroller) scroller.scrollTop = 0;
  };
  const renderDictionary = (entries: unknown[]): void => {
    const target = node('div');
    for (const value of entries) {
      const entry = record(value);
      const pronunciation = array(entry.phonetics).map(item => text(record(item).text)).filter(Boolean);
      if (pronunciation.length) target.append(node('p', [...new Set(pronunciation)].join(' · ')));
      if (text(entry.origin)) target.append(node('p', `词源：${text(entry.origin)}`));
      for (const value of array(entry.meanings)) {
        const meaning = record(value); target.append(node('h3', text(meaning.partOfSpeech) || '释义'));
        const definitions = node('ol');
        for (const value of array(meaning.definitions)) {
          const definition = record(value); if (!text(definition.definition)) continue;
          const item = node('li', text(definition.definition));
          if (text(definition.example)) item.append(node('p', `例句：${text(definition.example)}`));
          for (const [key, label] of [['synonyms', '近义词'], ['antonyms', '反义词']] as const) {
            const values = array(definition[key]).map(text).filter(Boolean); if (values.length) item.append(node('p', `${label}：${values.join(', ')}`));
          }
          definitions.append(item);
        }
        target.append(definitions);
        for (const [key, label] of [['synonyms', '近义词'], ['antonyms', '反义词']] as const) {
          const values = array(meaning[key]).map(text).filter(Boolean); if (values.length) target.append(node('p', `${label}：${values.join(', ')}`));
        }
      }
      for (const url of array(entry.sourceUrls)) { const source = link('词条来源', url); if (source) target.append(source, document.createTextNode(' ')); }
      const license = record(entry.license); const attribution = link(text(license.name) || '许可', license.url); if (attribution) target.append(attribution);
    }
    dictionary.replaceChildren(node('h3', '英文释义'), node('p', entries.some(entry => record(entry).provider === 'Wiktionary') ? '来源：Wiktionary' : '来源：Free Dictionary API', 'wb-muted'), target);
  };
  let dictionary = node('div');
  const loadDictionary = async (word: SavedWord): Promise<void> => {
    request?.abort(); const controller = new AbortController(); request = controller;
    dictionary.replaceChildren(node('h3', '公开词典 · 英文详解'), node('p', '正在查询词典…')); dictionary.setAttribute('aria-busy', 'true');
    try {
      const entries = await queryDictionary(word.word, controller.signal);
      if (controller.signal.aborted) return;
      if (!entries.some(entry => array(record(entry).meanings).some(meaning => array(record(meaning).definitions).some(definition => text(record(definition).definition))))) throw new Error('没有有效词条');
      renderDictionary(entries);
      const cached = cachedWordData('wiktionary', word.word, validEntries); dictionary.append(node('p', cached ? `已缓存 · ${new Date(cached.savedAt).toLocaleDateString()}` : '本地缓存写入失败，下次打开将重新查询。', 'wb-attribution'));
    } catch (error) {
      if (controller.signal.aborted) return;
      const missing = error instanceof Error && error.message.includes('404');
      const timedOut = error instanceof Error && error.message === 'dictionary-timeout';
      dictionary.replaceChildren(node('h3', '公开词典 · 英文详解'), node('p', missing ? '词典暂未收录这个单词，收藏内容仍可查看。' : timedOut ? '词典服务未及时响应，请稍后重试或打开在线词典。' : '词典连接失败，请检查网络或油猴中的词典域名授权。'), action('重试查询', () => { void loadDictionary(word); }));
      const external = link('打开在线词典', `https://en.wiktionary.org/wiki/${encodeURIComponent(word.word)}`); if (external) dictionary.append(external);
    } finally { if (!controller.signal.aborted) dictionary.removeAttribute('aria-busy'); }
  };
  const open = (word: SavedWord): void => {
    listScroll = scroller?.scrollTop ?? 0; returnWord = word.word; enter('单词详情');
    const hero = node('div', '', 'wb-hero'); const line = node('div', '', 'wb-wordline');
    line.append(node('strong', word.word), sound(word, status), node('span', word.ipa, 'wb-ipa'), node('span', word.level, 'wb-badge'));
    hero.append(line, node('p', word.meaning, 'wb-meaning')); detail.append(hero);
    const localSection = node('section', '', 'wb-local'); localSection.append(node('p', '正在读取离线英汉词库…'));
    void localWord(word.word).then(local => {
      if (!hero.isConnected) return;
      if (!local) { localSection.replaceChildren(node('p', '离线核心词库暂未收录此词，可查看收藏释义及其他来源。')); return; }
      const meanings = node('details', '', 'wb-local-meaning'); meanings.open = true;
      meanings.append(node('summary', '英汉释义 · ECDICT（离线）'), node('p', simplifiedChinese(local.meaning)));
      const labels: Record<string, string> = { cet4: 'CET4', cet6: 'CET6', zk: '中考', gk: '高考', ky: '考研', ielts: 'IELTS', toefl: 'TOEFL', gre: 'GRE' };
      const tags = node('div', '', 'wb-wordline'); for (const tag of local.tags) tags.append(node('span', labels[tag] ?? tag, 'wb-badge'));
      meanings.append(tags);
      const forms: Record<string, string> = { p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称', s: '复数', r: '比较级', t: '最高级', '0': '原形' };
      const variants = local.exchange.split('/').flatMap(value => { const [key, form] = value.split(':'); return key && form && forms[key] ? [`${forms[key]} ${form}`] : []; });
      if (variants.length) meanings.append(node('p', variants.join(' · '))); localSection.replaceChildren(meanings);
    }).catch(() => { if (hero.isConnected) localSection.replaceChildren(node('p', '离线词库无法读取，收藏释义仍可查看。')); });
    const columns = node('div', '', 'wb-columns'); const main = node('div', '', 'wb-main'); const aside = node('aside', '', 'wb-study');
    dictionary = node('div', '', 'wb-dictionary'); main.append(dictionary);
    const examples = node('section', '', 'wb-examples'); examples.append(node('h3', '记忆例句'), node('p', word.memoryExample || word.example));
    const translation = word.memoryExample ? word.memoryMeaning : word.exampleMeaning; if (translation) examples.append(node('p', simplifiedChinese(translation), 'wb-muted'));
    if (word.memoryExample && word.example !== word.memoryExample) {
      const original = node('details'); original.append(node('summary', '查看收藏原文'), node('p', word.example)); if (word.exampleMeaning) original.append(node('p', simplifiedChinese(word.exampleMeaning))); examples.append(original);
    }
    main.append(examples);
    const bilingual = node('section', '', 'wb-examples');
    const learning = node('div'); learning.append(localSection, bilingual, examples);
    const sourceTabs = node('div', '', 'wb-source-tabs'); sourceTabs.setAttribute('role', 'tablist'); sourceTabs.setAttribute('aria-label', '词典来源');
    const panels = [learning, dictionary]; const names = ['双语学习', 'Wiktionary'];
    const controls = names.map((name, index) => {
      const tab = action(name, () => selectSource(index)); tab.setAttribute('role', 'tab');
      tab.id = `ft-wordbook-source-${index}`; tab.setAttribute('aria-controls', `ft-wordbook-source-panel-${index}`);
      const panel = panels[index]; if (panel) { panel.id = `ft-wordbook-source-panel-${index}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); }
      tab.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; selectSource(next); controls[next]?.focus(); } };
      sourceTabs.append(tab); return tab;
    });
    function selectSource(index: number): void { panels.forEach((panel, i) => { panel.hidden = i !== index; }); controls.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; }); }
    selectSource(0); main.replaceChildren(sourceTabs, learning, dictionary);
    const loadExamples = async (): Promise<void> => {
      exampleRequest?.abort(); const controller = new AbortController(); exampleRequest = controller;
      bilingual.replaceChildren(node('h3', '双语例句'), node('p', '正在读取双语例句…'));
      try {
        const [result, local] = await Promise.all([queryExamples(word.word, controller.signal), localWord(word.word).catch(() => undefined)]); if (controller.signal.aborted) return;
        bilingual.replaceChildren(node('h3', '双语例句'));
        for (const example of result) {
          const english = node('p'); const escaped = word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          let offset = 0; for (const match of example.english.matchAll(new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'gi'))) { english.append(example.english.slice(offset, match.index), node('mark', match[0])); offset = match.index + match[0].length; } english.append(example.english.slice(offset));
          const chinese = node('p', '', 'wb-muted'); chinese.lang = 'zh-Hans';
          for (const part of chineseExampleParts(example.chinese, [local?.meaning ?? '', word.meaning, word.memoryTerm ?? '', word.translatedTerm ?? ''])) chinese.append(part.marked ? node('mark', part.text) : document.createTextNode(part.text));
          bilingual.append(english, chinese);
          const attribution = node('p', '', 'wb-example-source');
          const original = link(`英文：${example.owner || 'Tatoeba'}`, `https://tatoeba.org/en/sentences/show/${example.id}`);
          const translated = link(`中文：${example.translationOwner || 'Tatoeba'}`, `https://tatoeba.org/en/sentences/show/${example.translationId}`);
          if (original) attribution.append(original, ' · '); if (translated) attribution.append(translated); attribution.append(` · ${example.license || '许可见来源'} / ${example.translationLicense || '许可见来源'}`); bilingual.append(attribution);
        }
        if (!result.length) bilingual.append(node('p', '暂未找到直接对应的中文例句。'));
        const cached = cachedWordData('tatoeba', word.word, validExamples);
        bilingual.append(node('p', cached ? `已缓存 · ${new Date(cached.savedAt).toLocaleDateString()}` : '本地缓存写入失败，下次打开将重新查询。', 'wb-attribution'));
      } catch { if (!controller.signal.aborted) bilingual.replaceChildren(node('h3', '双语例句'), node('p', '双语例句暂时无法获取，其他内容仍可查看。'), action('重试查询', () => { void loadExamples(); })); }
    }; void loadExamples();
    aside.append(node('h3', '收藏信息'));
    const dates = node('dl'); dates.append(node('dt', '收藏日期'), node('dd', new Date(word.addedAt).toLocaleDateString())); aside.append(dates);
    const actions = node('div', '', 'wb-detail-actions'); const source = link('打开收藏来源', word.sourceUrl); if (source) actions.append(source);
    actions.append(action('移除收藏', () => { try { removeWord(word.word); showList(); } catch { status.textContent = '移除失败，请重试。'; } })); aside.append(actions);
    columns.append(main, aside); detail.append(columns, node('p', '双语学习：ECDICT + Tatoeba · 英文详解：Wiktionary · 各来源独立缓存', 'wb-attribution'));
    if (scroller) scroller.scrollTop = 0;
    void loadDictionary(word);
  };
  heading.append(title); root.append(style, heading, info, status, toolbar, list, pages, detail);
  function render(): void {
    const book = readWordbook(); info.textContent = `已收藏 ${book.length} 词`;
    const query = search.value.trim().toLowerCase();
    const matches = book.filter(word => `${word.word} ${word.meaning}`.toLowerCase().includes(query));
    matches.sort((a, b) => sort.value === 'az' ? a.word.localeCompare(b.word) : b.addedAt - a.addedAt || b.word.localeCompare(a.word));
    const pageSize = Number(size.value); const count = Math.max(1, Math.ceil(matches.length / pageSize)); page = Math.min(page, count);
    list.replaceChildren();
    for (const word of matches.slice((page - 1) * pageSize, page * pageSize)) {
      const row = node('li', '', 'wb-row'); const entry = action('', () => open(word)); entry.className = 'wb-open'; entry.dataset.word = word.word;
      entry.append(node('strong', word.word), node('span', `${word.ipa} ${word.meaning}`));
      const remove = action('移除', () => { try { removeWord(word.word); render(); } catch { status.textContent = '移除失败，请重试。'; } }); remove.setAttribute('aria-label', `移除 ${word.word}`);
      row.append(entry, node('span', word.level, 'wb-meta'), sound(word, status), remove); list.append(row);
    }
    if (!matches.length) list.append(node('li', book.length ? '没有匹配的单词。' : '还没有收藏，在正文词汇区收藏后即可在这里学习。'));
    const previous = action('上一页', () => { stopWordSpeech(root); page--; render(); }); previous.disabled = page === 1;
    const next = action('下一页', () => { stopWordSpeech(root); page++; render(); }); next.disabled = page === count;
    const summary = node('span', `共 ${matches.length} 词 · 第 ${page} / ${count} 页`); summary.setAttribute('aria-live', 'polite'); pages.replaceChildren(previous, summary, next);
  }
  const reset = (): void => { stopWordSpeech(root); page = 1; render(); };
  search.oninput = reset; sort.onchange = reset; size.onchange = reset; render();
  return cancel;
}
