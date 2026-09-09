import { Converter } from 'opencc-js/t2cn';
let convert: ((value: string) => string) | undefined;
export function simplifiedChinese(value: string): string {
  convert ??= Converter({ from: 'tw', to: 'cn' });
  return convert(value);
}
export function chineseExampleParts(value: string, meanings: string[]): { text: string; marked: boolean }[] {
  const source = simplifiedChinese(value);
  // Dictionary glosses supply candidates, not a claimed word-for-word alignment.
  // Ignore single characters and explanatory parentheticals to avoid broad false matches.
  const terms = [...new Set(meanings.flatMap(meaning => simplifiedChinese(meaning)
    .replace(/[（(][^）)]*[）)]/g, '').match(/[\p{Script=Han}]{2,12}/gu) ?? []))]
    .filter(term => source.includes(term)).sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text: source, marked: false }];
  const parts: { text: string; marked: boolean }[] = []; let offset = 0;
  for (const match of source.matchAll(new RegExp(terms.join('|'), 'gu'))) {
    if (match.index > offset) parts.push({ text: source.slice(offset, match.index), marked: false });
    parts.push({ text: match[0], marked: true }); offset = match.index + match[0].length;
  }
  if (offset < source.length) parts.push({ text: source.slice(offset), marked: false });
  return parts;
}
