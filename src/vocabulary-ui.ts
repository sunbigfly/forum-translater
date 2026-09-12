import { mountWordbook } from './wordbook';
import { collectVocabulary, readWordbook, saveWord, speakWord, stopWordSpeech, type VocabularyWord } from './vocabulary';
import type { TranslationService } from './translation/service';
import { applyVocabularyInk, VocabularyHighlights } from './vocabulary-highlights';

function button(text: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.onclick = event => { event.preventDefault(); event.stopPropagation(); action(); }; return node;
}
function soundButton(word: VocabularyWord, status: HTMLElement): HTMLButtonElement {
  const node = button('', () => speakWord(word.word, status, node));
  node.className = 'icon ft-audio'; node.title = `发音 ${word.ipa}`; node.setAttribute('aria-label', `朗读 ${word.word}`); node.setAttribute('aria-pressed', 'false');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
  path.classList.add('ft-speaker');
  const stop = document.createElementNS(svg.namespaceURI, 'path'); stop.setAttribute('d', 'M6 6h12v12H6z'); stop.setAttribute('fill', 'currentColor'); stop.classList.add('ft-stop');
  const style = document.createElementNS(svg.namespaceURI, 'style'); style.textContent = '.ft-audio .ft-stop{display:none}.ft-audio.is-speaking .ft-speaker{display:none}.ft-audio.is-speaking .ft-stop{display:block;animation:ft-audio-pulse .8s ease-in-out infinite}@keyframes ft-audio-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.ft-audio.is-speaking .ft-stop{animation:none}}';
  svg.append(style, path, stop); node.append(svg); return node;
}
type ExampleLoader = (word: VocabularyWord, target: HTMLElement) => void;
let exampleOwner = 0;
function exampleText(word: VocabularyWord): string { return word.memoryExample?.trim() || word.example; }
function exampleMeaning(word: VocabularyWord): string { return (word.memoryExample?.trim() ? word.memoryMeaning : word.exampleMeaning)?.trim() ?? ''; }
function createExampleLoader(service: TranslationService, signal: AbortSignal): ExampleLoader {
  const requests = new Map<string, Promise<string>>();
  const load: ExampleLoader = (word, target) => {
    const existing = exampleMeaning(word);
    if (existing) { target.textContent = existing; return; }
    target.textContent = '例句翻译中…';
    const text = exampleText(word);
    let request = requests.get(text);
    if (!request) {
      const owner = `vocabulary-example:${++exampleOwner}`;
      request = service.section(text, owner, 'visible', signal).then(value => {
        if (!value.trim()) throw new Error('Empty example translation');
        return value;
      }).finally(() => service.release(owner));
      requests.set(text, request);
      void request.catch(() => { requests.delete(text); });
    }
    void request.then(value => {
      if (signal.aborted) return;
      if (word.memoryExample?.trim()) word.memoryMeaning = value; else word.exampleMeaning = value;
      if (target.isConnected) target.textContent = value;
    }).catch(() => {
      if (signal.aborted || !target.isConnected) return;
      target.replaceChildren('例句翻译失败，', button('重试', () => load(word, target)));
    });
  };
  return load;
}

function wordDetails(word: VocabularyWord, status: HTMLElement, loadExample?: ExampleLoader): HTMLElement {
  const card = document.createElement('div'); card.className = 'word-card';
  const heading = document.createElement('strong'); heading.textContent = word.word;
  const pronunciation = document.createElement('span'); pronunciation.textContent = ` ${word.ipa} `;
  const meaning = document.createElement('p'); meaning.textContent = word.meaning;
  const example = document.createElement('p'); example.textContent = exampleText(word);
  const translation = document.createElement('p'); translation.className = 'example-translation'; translation.textContent = exampleMeaning(word) || '暂无例句翻译';
  if (loadExample) loadExample(word, translation);
  card.append(heading, soundButton(word, status), pronunciation, meaning, example, translation); return card;
}
function showWordPopup(anchor: HTMLElement, word: VocabularyWord, sourceUrl: string, loadExample: ExampleLoader): () => void {
  const host = document.createElement('div'); host.dataset.ftOwned = 'word-popup';
  host.style.cssText = 'position:fixed;z-index:2147483647;width:min(300px,calc(100vw - 16px));';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = `
    :host{color-scheme:light dark;font:13px/1.5 system-ui,sans-serif;color:CanvasText}
    section{max-height:calc(100vh - 40px);overflow-y:auto;background:Canvas;border:1px solid #8884;border-radius:10px;padding:12px;box-shadow:0 6px 24px #0002;overflow-wrap:anywhere}
    strong{font-size:15px}p{margin:6px 0;white-space:pre-wrap}span{color:#888}
    button{font:inherit;color:inherit;background:none;border:0;padding:4px;cursor:pointer}button:hover{background:#8882;border-radius:4px}
    .icon{display:inline-flex;vertical-align:middle}[role=status]:empty{display:none}
  `;
  const section = document.createElement('section'); section.setAttribute('role', 'dialog'); section.setAttribute('aria-label', `${word.word} 词汇详情`);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const add = button(readWordbook().some(item => item.word.toLowerCase() === word.word.toLowerCase()) ? '★' : '☆', () => {
    try { saveWord(word, sourceUrl); add.textContent = '★'; add.setAttribute('aria-label', '已收藏'); }
    catch { status.textContent = '收藏失败，请重试'; }
  }); add.setAttribute('aria-label', '收藏单词');
  section.append(wordDetails(word, status, loadExample), add, status); shadow.append(style, section); document.body.append(host);
  const position = (): void => {
    const rect = anchor.getBoundingClientRect(); const height = host.getBoundingClientRect().height;
    host.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - host.getBoundingClientRect().width - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - height - 8))}px`;
  };
  position();
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position);
  resize?.observe(host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    clearTimeout(timer); resize?.disconnect(); stopWordSpeech(shadow); host.remove();
    anchor.removeEventListener('pointerleave', leave); anchor.removeEventListener('blur', leave);
    document.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
  };
  const leave = (): void => { clearTimeout(timer); timer = setTimeout(close, 180); };
  const keep = (): void => { clearTimeout(timer); };
  const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
  anchor.addEventListener('pointerleave', leave); anchor.addEventListener('blur', leave);
  host.addEventListener('pointerenter', keep); host.addEventListener('pointerleave', leave); host.addEventListener('focusin', keep); host.addEventListener('focusout', leave);
  host.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('keydown', key); window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
  return close;
}
export function mountVocabulary(anchor: HTMLElement, source: string, sourceUrl: string, service: TranslationService, targets?: { original: HTMLElement; translations: HTMLElement[] }): () => void {
  const host = document.createElement('div'); host.dataset.ftOwned = 'learning'; host.hidden = true; anchor.after(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = `
    :host{display:block;margin:6px 0;font:12px/1.5 system-ui,sans-serif;color:#888}
    :host([hidden]),[hidden]{display:none!important}
    section::before{content:'';display:block;height:1px;margin-bottom:4px;background:linear-gradient(90deg,transparent,#8884 35%,#8884 65%,transparent)}
    .word-row{display:flex;align-items:center;gap:4px;min-width:0;padding:1px 0;cursor:pointer}
    .word{font-weight:400;white-space:nowrap;flex-shrink:0}
    .ipa{font-size:11px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .meaning{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;margin-inline-start:2px}
    button{font:inherit;color:inherit;background:transparent;border:0;padding:2px;cursor:pointer;opacity:.8}
    button:hover,button:focus-visible{opacity:1}button:focus-visible{outline:1px solid currentColor;border-radius:3px}
    .icon{display:inline-flex;align-items:center;justify-content:center;min-width:20px;min-height:20px;flex-shrink:0}
    .ft-bookmark{border-radius:50%}.ft-bookmark:hover,.ft-bookmark:focus-visible{color:#1d9bf0;background:#1d9bf014}
    .ft-bookmark svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .ft-bookmark[aria-pressed=true]{color:#1d9bf0;opacity:1}.ft-bookmark[aria-pressed=true] svg{fill:currentColor}
    .more{font-size:11px;padding:2px 0}.example{font-size:12px;padding:3px 0 6px 4px;overflow-wrap:anywhere}.example p{margin:2px 0}
    [role=status]{font-size:11px;margin:2px 0}[role=status]:empty{display:none}
  `; shadow.append(style);
  const section = document.createElement('section'); section.setAttribute('aria-label', '词汇学习');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const cards = document.createElement('div'); const actions = document.createElement('div');
  section.append(status, cards, actions); shadow.append(section);
  const controller = new AbortController();
  let queuedKey: string | undefined;
  const observed = targets?.original ?? anchor;
  const rect = observed.getBoundingClientRect();
  let visible = !document.hidden && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  const visibility = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (queuedKey) {
      if (visible) service.tasks.promote(queuedKey, 'visible'); else service.tasks.deprioritize(queuedKey);
    }
  });
  visibility?.observe(observed);
  const loadExample = createExampleLoader(service, controller.signal);
  const highlights = new VocabularyHighlights((target, word) => showWordPopup(target, word, sourceUrl, loadExample));
  let currentWords: VocabularyWord[] = [];
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  const observeTranslations = (): void => {
    if (targets) translationObserver.observe(targets.original, { childList: true, characterData: true, subtree: true });
    for (const target of targets?.translations ?? []) translationObserver.observe(target, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-ft-streaming'] });
  };
  const refreshHighlights = (): void => {
    if (!targets || controller.signal.aborted) return;
    clearTimeout(highlightTimer); highlightTimer = undefined;
    translationObserver.disconnect();
    try { highlights.apply(targets.original, targets.translations, currentWords); }
    finally { observeTranslations(); }
  };
  const translationObserver = new MutationObserver(records => {
    if (!currentWords.length || controller.signal.aborted) return;
    if (records.every(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return !!target?.closest('[data-ft-owned="translation"][data-ft-streaming]');
    })) return;
    highlightTimer ??= setTimeout(refreshHighlights, 120);
  });
  observeTranslations();
  let running = false;
  let stopCombined: (() => void) | undefined;
  const load = async (): Promise<void> => {
    if (running || controller.signal.aborted) return;
    running = true; actions.replaceChildren(); status.textContent = ''; host.hidden = true;
    stopWordSpeech(shadow); cards.replaceChildren(); currentWords = []; highlights.clear();
    section.setAttribute('aria-busy', 'true');
    let displayed = cards.children.length;
    let displayedWords: string[] = [];
    let expanded = false;
    const more = button('', () => {
      expanded = !expanded;
      [...cards.children].forEach((card, index) => { if (card instanceof HTMLElement) card.hidden = !expanded && index >= 3; });
      more.textContent = expanded ? '收起' : `展开其余 ${displayed - 3} 词`; more.setAttribute('aria-expanded', String(expanded));
    }); more.className = 'more'; more.setAttribute('aria-expanded', 'false');
    const fill = (result: VocabularyWord[]): void => {
      if (controller.signal.aborted) return;
      const identities = result.map(word => JSON.stringify(word));
      if (identities.length === displayedWords.length && identities.every((value, index) => value === displayedWords[index])) return;
      const openWords = new Set([...cards.querySelectorAll<HTMLButtonElement>('.word[aria-expanded="true"]')].map(node => node.textContent));
      const append = displayedWords.length <= identities.length && displayedWords.every((value, index) => value === identities[index]);
      if (!append) { stopWordSpeech(shadow); cards.replaceChildren(); displayed = 0; }
      displayedWords = identities;
      for (const [index, word] of result.entries()) {
        if (index < displayed) continue;
        const card = document.createElement('div'); card.hidden = !expanded && index >= 3;
        const row = document.createElement('div'); row.className = 'word-row';
        const example = document.createElement('div'); example.className = 'example'; example.hidden = true;
        const sentence = document.createElement('p');
        const text = exampleText(word);
        const escapedWord = word.word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let offset = 0;
        if (escapedWord) for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escapedWord}(?![\\p{L}\\p{N}_])`, 'giu'))) {
          sentence.append(text.slice(offset, match.index));
          const marked = document.createElement('u'); marked.textContent = match[0]; applyVocabularyInk(marked, index); sentence.append(marked);
          offset = match.index + match[0].length;
        }
        sentence.append(text.slice(offset));
        const explanation = document.createElement('p');
        const translatedExample = exampleMeaning(word);
        const translatedTerm = word.memoryExample?.trim() ? word.memoryTerm?.trim() ?? '' : '';
        const termIndex = translatedTerm ? translatedExample.indexOf(translatedTerm) : -1;
        if (termIndex >= 0) {
          const marked = document.createElement('u'); marked.textContent = translatedTerm; applyVocabularyInk(marked, index);
          explanation.append(translatedExample.slice(0, termIndex), marked, translatedExample.slice(termIndex + translatedTerm.length));
        } else explanation.textContent = translatedExample;
        example.append(sentence, explanation);
        const toggleDetails = (): void => { example.hidden = !example.hidden; if (!example.hidden && !translatedExample) loadExample(word, explanation); label.setAttribute('aria-expanded', String(!example.hidden)); };
        const label = button(word.word, toggleDetails); label.className = 'word'; label.title = `${word.ipa} · 点击展开例句`; label.setAttribute('aria-expanded', 'false');
        row.onclick = event => { event.preventDefault(); event.stopPropagation(); toggleDetails(); };
        const meaning = document.createElement('span'); meaning.className = 'meaning'; meaning.textContent = word.meaning; meaning.title = word.meaning;
        const pronunciation = document.createElement('span'); pronunciation.className = 'ipa'; pronunciation.textContent = word.ipa; pronunciation.title = word.ipa; pronunciation.setAttribute('aria-label', `音标 ${word.ipa}`); pronunciation.hidden = !word.ipa.trim();
        card.append(row, example);
        const saved = readWordbook().some(item => item.word.toLowerCase() === word.word.toLowerCase());
        const add = button('', () => {
          try { saveWord(word, sourceUrl); add.setAttribute('aria-pressed', 'true'); add.title = '已收藏'; add.setAttribute('aria-label', `${word.word} 已收藏`); } catch (error) { status.textContent = error instanceof Error ? error.message : '收藏失败'; }
        }); add.className = 'icon ft-bookmark'; add.title = saved ? '已收藏' : '加入单词本'; add.setAttribute('aria-label', `${saved ? '已收藏' : '收藏'} ${word.word}`); add.setAttribute('aria-pressed', String(saved));
        const bookmark = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); bookmark.setAttribute('viewBox', '0 0 24 24'); bookmark.setAttribute('aria-hidden', 'true');
        const outline = document.createElementNS(bookmark.namespaceURI, 'path'); outline.setAttribute('d', 'M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z'); bookmark.append(outline); add.append(bookmark);
        row.append(label, add, pronunciation, soundButton(word, status), meaning); cards.append(card);
        if (openWords.has(word.word)) toggleDetails();
      }
      displayed = result.length;
      if (displayed > 3) { more.textContent = expanded ? '收起' : `展开其余 ${displayed - 3} 词`; if (!more.isConnected) actions.append(more); }
      else more.remove();
      host.hidden = result.length === 0;
      currentWords = result; refreshHighlights();
    };
    try {
      if (service.settings.provider === 'ai') {
        stopCombined?.(); stopCombined = service.watchVocabulary(source, fill);
        return;
      }
      const result = await collectVocabulary(source, service.settings, service.tasks, controller.signal, '', fill, { priority: () => visible ? 'visible' : 'prefetch', queued: key => { queuedKey = key; } });
      if (controller.signal.aborted) return;
      fill(result);
      currentWords = result; refreshHighlights();
      status.textContent = ''; host.hidden = result.length === 0;
    } catch {
      if (!controller.signal.aborted) { host.hidden = false; status.textContent = '词汇生成失败，请检查设置中的 AI 地址、密钥和模型。'; actions.append(button('重试词汇生成', () => { void load(); })); }
    } finally { running = false; section.removeAttribute('aria-busy'); }
  };
  void Promise.resolve().then(load);
  return () => { controller.abort(); clearTimeout(highlightTimer); stopCombined?.(); visibility?.disconnect(); translationObserver.disconnect(); highlights.clear(); stopWordSpeech(shadow); host.remove(); };
}

export function renderWordbook(root: HTMLElement): () => void {
  return mountWordbook(root, soundButton);
}
