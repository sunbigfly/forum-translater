// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { VocabularyHighlights } from '../src/vocabulary-highlights';
import { sourceSnapshot } from '../src/reddit';
import { isOwnedMutation } from '../src/dom-mutations';

it('keeps mobile highlights without opening hover or focus cards', () => {
  vi.stubGlobal('innerWidth', 390);
  const root = document.createElement('p'); root.textContent = 'substantial effort'; document.body.append(root);
  const show = vi.fn(() => () => undefined); const highlights = new VocabularyHighlights(show);
  try {
    highlights.apply(root, [], [{ word: 'substantial', ipa: '', meaning: '大量的', example: '', level: 'CET6' }]);
    const mark = root.querySelector<HTMLElement>('[data-ft-word]');
    expect(mark?.textContent).toBe('substantial');
    mark?.dispatchEvent(new Event('pointerenter')); mark?.dispatchEvent(new Event('focus'));
    expect(show).not.toHaveBeenCalled(); expect(mark?.hasAttribute('tabindex')).toBe(false);
    expect(mark?.hasAttribute('title')).toBe(false);
  } finally { highlights.clear(); root.remove(); vi.unstubAllGlobals(); }
});

it('does not rescan the page for highlight insertion or removal but retains real source edits', () => {
  const root = document.createElement('p'); root.textContent = 'substantial effort'; document.body.append(root);
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  const highlights = new VocabularyHighlights();
  const word = { word: 'substantial', ipa: '', meaning: '大量的', example: '', level: 'CET6' as const };
  try {
    highlights.apply(root, [], [word]);
    const records = observer.takeRecords();
    expect(records.length).toBeGreaterThan(0); expect(records.every(isOwnedMutation)).toBe(true);
    const mark = root.querySelector('[data-ft-word]');
    highlights.apply(root, [], [{ ...word, example: 'Updated example.' }]);
    expect(root.querySelector('[data-ft-word]')).toBe(mark); expect(observer.takeRecords()).toHaveLength(0);
    highlights.clear(); expect(observer.takeRecords().every(isOwnedMutation)).toBe(true);
    root.textContent = 'Changed source';
    expect(observer.takeRecords().some(record => !isOwnedMutation(record))).toBe(true);
  } finally { observer.disconnect(); highlights.clear(); root.remove(); }
});

it('keeps original highlights and their popup while nested translations stream and complete', () => {
  const original = document.createElement('div'); original.textContent = 'substantial effort';
  const translated = document.createElement('div'); translated.dataset.ftOwned = 'translation'; translated.textContent = '大量的努力';
  original.append(translated); document.body.append(original);
  const dismiss = vi.fn(); const highlights = new VocabularyHighlights(() => dismiss);
  const word = { word: 'substantial', ipa: '', meaning: '大量的', example: '', level: 'CET6' as const, translatedTerm: '大量的' };
  highlights.apply(original, [translated], [word]);
  const originalMark = original.querySelector('[data-ft-word]'); originalMark?.dispatchEvent(new Event('pointerenter'));
  translated.setAttribute('data-ft-streaming', ''); translated.textContent = '大量的';
  highlights.apply(original, [translated], [word]);
  expect(original.querySelector('[data-ft-word]')).toBe(originalMark);
  expect(translated.querySelector('[data-ft-word]')).toBeNull(); expect(dismiss).not.toHaveBeenCalled();
  translated.removeAttribute('data-ft-streaming'); translated.textContent = '大量的投入';
  highlights.apply(original, [translated], [word]);
  expect(original.querySelector('[data-ft-word]')).toBe(originalMark);
  expect(translated.querySelector('[data-ft-word]')?.textContent).toBe('大量的'); expect(dismiss).not.toHaveBeenCalled();
  highlights.clear(); expect(dismiss).toHaveBeenCalledOnce(); original.remove();
});
it('retains existing highlights and their open popup while appending another word', () => {
  const original = document.createElement('div'); original.textContent = 'substantial coherent'; document.body.append(original);
  const close = () => undefined; let closed = false;
  const highlights = new VocabularyHighlights(() => () => { closed = true; close(); });
  const first = { word: 'substantial', ipa: '', meaning: '大量的', example: '', level: 'CET6' as const };
  const second = { ...first, word: 'coherent', meaning: '连贯的' };
  highlights.apply(original, [], [first]);
  const marked = original.querySelector('[data-ft-word]'); marked?.dispatchEvent(new Event('pointerenter'));
  highlights.apply(original, [], [first, second]);
  expect(original.querySelector('[data-ft-word]')).toBe(marked); expect(closed).toBe(false);
  highlights.clear(); expect(closed).toBe(true); original.remove();
});
it('marks exact source words and translated terms, preserves links and restores the DOM', () => {
  const original = document.createElement('div'); original.innerHTML = '<a href="https://example.com">ensures</a> ensures reassurance';
  const translated = document.createElement('div'); translated.textContent = '成本决定了市场存在。';
  const link = original.querySelector('a'); const before = sourceSnapshot(original).innerHTML;
  const highlights = new VocabularyHighlights();
  highlights.apply(original, [translated], [{ word: 'ensures', ipa: '', meaning: '确保', example: '', level: 'CET6', translatedTerm: '决定' }]);
  expect(original.querySelectorAll('[data-ft-word]')).toHaveLength(2);
  expect(translated.querySelector('[data-ft-word]')?.textContent).toBe('决定');
  expect(sourceSnapshot(original).innerHTML).toBe(before); expect(original.querySelector('a')).toBe(link);
  highlights.clear(); expect(original.querySelector('[data-ft-word]')).toBeNull(); expect(translated.textContent).toBe('成本决定了市场存在。');
});
it('rechecks the original when only Chinese initially matched and text arrives later', () => {
  const original = document.createElement('div'); original.textContent = 'Loading';
  const translated = document.createElement('div'); translated.textContent = '大量的';
  document.body.append(original, translated);
  const word = { word: 'substantial', ipa: '', meaning: '大量的', example: '', level: 'CET6' as const, translatedTerm: '大量的' };
  const highlights = new VocabularyHighlights();
  highlights.apply(original, [translated], [word]);
  expect(original.querySelector('[data-ft-word]')).toBeNull();
  expect(translated.querySelector('[data-ft-word]')).not.toBeNull();
  original.textContent = 'SUBSTANTIAL effort';
  highlights.apply(original, [translated], [word]);
  expect(original.querySelector('[data-ft-word]')?.textContent).toBe('SUBSTANTIAL');
  highlights.clear(); original.remove(); translated.remove();
});
