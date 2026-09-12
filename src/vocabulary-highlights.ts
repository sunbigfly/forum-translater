import type { VocabularyWord } from './vocabulary';

const INK_COLORS = ['#e995ab', '#dfa65c', '#c6b953', '#71b68a', '#65b6c7', '#829de0', '#b18bd1'];
export function applyVocabularyInk(mark: HTMLElement, index: number): void {
  const color = INK_COLORS[index % INK_COLORS.length] ?? INK_COLORS[0];
  const brush = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 16" preserveAspectRatio="none"><path d="M3 10 Q25 5 49 8 T97 6" fill="none" stroke="${color}" stroke-opacity=".24" stroke-width="8" stroke-linecap="round"/><path d="M5 12 Q40 9 65 11 T95 9" fill="none" stroke="${color}" stroke-opacity=".14" stroke-width="3" stroke-linecap="round"/></svg>`;
  mark.style.textDecoration = 'none';
  mark.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(brush)}")`;
  mark.style.backgroundSize = '100% 1.45em';
  mark.style.backgroundPosition = '0 45%';
  mark.style.backgroundRepeat = 'no-repeat';
  mark.style.setProperty('box-decoration-break', 'clone');
  mark.style.setProperty('-webkit-box-decoration-break', 'clone');
}

interface HighlightRoot {
  english: boolean;
  identities: string[];
  text: string | null;
  marks: HTMLElement[];
}

export class VocabularyHighlights {
  private roots = new Map<HTMLElement, HighlightRoot>();
  private dismiss: (() => void) | undefined;
  private popupAnchor: HTMLElement | undefined;
  constructor(private readonly show?: (anchor: HTMLElement, word: VocabularyWord) => () => void) {}
  apply(original: HTMLElement, translations: HTMLElement[], words: VocabularyWord[]): void {
    if (!words.length) { this.clear(); return; }
    const identities = words.map(word => JSON.stringify(word));
    const targets = new Map([[original, true], ...translations.map(root => [root, false] as const)]);
    for (const root of this.roots.keys()) if (!targets.has(root)) this.clearRoot(root);
    for (const [root, english] of targets) {
      // Do not rescan incomplete Chinese text on every streamed fragment.
      if (!english && root.hasAttribute('data-ft-streaming')) { this.clearRoot(root); continue; }
      const text = english ? this.originalText(root) : root.textContent;
      let state = this.roots.get(root);
      const append = state && state.english === english && state.text === text
        && state.identities.length <= identities.length && state.identities.every((value, index) => value === identities[index])
        && state.marks.every(mark => mark.isConnected && root.contains(mark));
      const start = append && state ? state.identities.length : 0;
      if (!append) {
        this.clearRoot(root);
        state = { english, identities, text, marks: [] };
        this.roots.set(root, state);
      }
      if (!state) continue;
      state.identities = identities;
      for (const [index, word] of words.entries()) {
        if (index < start) continue;
        const term = english ? word.word : word.translatedTerm;
        if (term) state.marks.push(...this.mark(root, term, english ? word.meaning : word.word, english, word, index));
      }
    }
  }
  private originalText(root: HTMLElement): string {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, {
      acceptNode: node => node instanceof Element && node.matches('[data-ft-owned]') ? NodeFilter.FILTER_REJECT
        : node instanceof Text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
    });
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
    return parts.join('');
  }
  private clearRoot(root: HTMLElement): void {
    const state = this.roots.get(root);
    if (!state) return;
    if (this.popupAnchor && state.marks.includes(this.popupAnchor)) {
      this.dismiss?.(); this.dismiss = undefined; this.popupAnchor = undefined;
    }
    for (const mark of state.marks) mark.replaceWith(...mark.childNodes);
    this.roots.delete(root);
  }
  private mark(root: HTMLElement, term: string, hint: string, english: boolean, word: VocabularyWord, index: number): HTMLElement[] {
    const marks: HTMLElement[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!(node instanceof Text) || parent?.closest('[data-ft-word],script,style,textarea,input,code,pre,[contenteditable="true"]')) continue;
      if (english && parent?.closest('[data-ft-owned]')) continue;
      texts.push(node);
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(english ? `(?<![a-z])${escaped}(?![a-z])` : escaped, english ? 'gi' : 'g');
    for (const text of texts) {
      for (const match of [...text.data.matchAll(pattern)].reverse()) {
        const start = match.index; const end = start + match[0].length;
        if (end < text.length) text.splitText(end);
        const selected = start ? text.splitText(start) : text;
        const mark = document.createElement('span'); mark.dataset.ftWord = ''; mark.title = hint;
        applyVocabularyInk(mark, index);
        if (this.show) {
          mark.removeAttribute('title'); mark.tabIndex = 0;
          mark.setAttribute('aria-label', `${word.word}：${word.meaning}`);
          const open = (): void => { this.dismiss?.(); this.popupAnchor = mark; this.dismiss = this.show?.(mark, word); };
          mark.addEventListener('pointerenter', open); mark.addEventListener('focus', open);
        }
        selected.before(mark); mark.append(selected); marks.push(mark);
      }
    }
    return marks;
  }
  clear(): void {
    this.dismiss?.(); this.dismiss = undefined; this.popupAnchor = undefined;
    for (const root of this.roots.keys()) this.clearRoot(root);
  }
}
