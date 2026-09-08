// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { VocabularyHighlights } from '../src/vocabulary-highlights';
import { sourceSnapshot } from '../src/reddit';
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
