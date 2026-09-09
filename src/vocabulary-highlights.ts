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

export class VocabularyHighlights {
  private marks: HTMLElement[] = [];
  private dismiss: (() => void) | undefined;
  private original: HTMLElement | undefined;
  private translations: HTMLElement[] = [];
  private identities: string[] = [];
  private texts: (string | null)[] = [];
  constructor(private readonly show?: (anchor: HTMLElement, word: VocabularyWord) => () => void) {}
  apply(original: HTMLElement, translations: HTMLElement[], words: VocabularyWord[]): void {
    const identities = words.map(word => JSON.stringify(word));
    const texts = [original, ...translations].map(node => node.textContent);
    const append = this.original === original && translations.length === this.translations.length && translations.every((node, index) => node === this.translations[index])
      && texts.length === this.texts.length && texts.every((value, index) => value === this.texts[index])
      && this.identities.length <= identities.length && this.identities.every((value, index) => value === identities[index]) && this.marks.every(mark => mark.isConnected);
    const start = append ? this.identities.length : 0;
    if (!append) this.clear();
    this.original = original; this.translations = [...translations]; this.identities = identities; this.texts = texts;
    for (const [index, word] of words.entries()) {
      if (index < start) continue;
      this.mark(original, word.word, word.meaning, true, word, index);
      if (word.translatedTerm) for (const translation of translations) this.mark(translation, word.translatedTerm, word.word, false, word, index);
    }
  }
  private mark(root: HTMLElement, term: string, hint: string, english: boolean, word: VocabularyWord, index: number): void {
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
          const open = (): void => { this.dismiss?.(); this.dismiss = this.show?.(mark, word); };
          mark.addEventListener('pointerenter', open); mark.addEventListener('focus', open);
        }
        selected.before(mark); mark.append(selected); this.marks.push(mark);
      }
    }
  }
  clear(): void { this.dismiss?.(); this.dismiss = undefined; for (const mark of this.marks) mark.replaceWith(...mark.childNodes); this.marks = []; this.original = undefined; this.translations = []; this.identities = []; this.texts = []; }
}
