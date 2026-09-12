// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { VocabularyHighlights } from '../src/vocabulary-highlights';
import { sourceSnapshot } from '../src/reddit';

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
