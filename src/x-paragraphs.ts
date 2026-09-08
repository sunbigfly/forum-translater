import { OWNED, sourceSnapshot } from './reddit';
export interface XParagraphs { snapshot: HTMLDivElement; ranges: Range[]; separators: Range[] }
export function xParagraphs(root: HTMLElement): XParagraphs | undefined {
  if (!root.matches('[data-testid="tweetText"]')) return;
  const segments: { node: Text | HTMLBRElement; start: number; end: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node instanceof Element ? node : node.parentElement;
    if (element?.closest(`${OWNED},script,style,button,[contenteditable="true"]`)) continue;
    if (!(node instanceof Text) && !(node instanceof HTMLBRElement)) continue;
    const value = node instanceof Text ? node.data : '\n';
    segments.push({ node, start: text.length, end: text.length + value.length }); text += value;
  }
  const bounds: [number, number][] = []; const gaps: [number, number][] = [];
  let start = 0;
  for (const match of text.matchAll(/\n[\t \r]*\n(?:[\t \r]*\n)*/g)) { bounds.push([start, match.index]); start = match.index + match[0].length; gaps.push([match.index, start]); }
  bounds.push([start, text.length]);
  const paragraphs = bounds.filter(([from, to]) => text.slice(from, to).trim());
  if (paragraphs.length < 2) return;
  const point = (position: number): [Node, number] => {
    const segment = segments.find(item => item.end >= position && item.start <= position);
    if (!segment) throw new Error('Missing paragraph boundary');
    if (segment.node instanceof Text) return [segment.node, position - segment.start];
    const parent = segment.node.parentNode;
    if (!parent) throw new Error('Detached paragraph boundary');
    return [parent, [...parent.childNodes].indexOf(segment.node) + (position === segment.end ? 1 : 0)];
  };
  const snapshot = document.createElement('div'); const ranges: Range[] = [];
  for (const [from, to] of paragraphs) {
    const range = document.createRange(); range.setStart(...point(from)); range.setEnd(...point(to));
    const copy = document.createElement('div'); copy.append(range.cloneContents());
    const paragraph = document.createElement('p'); paragraph.append(...sourceSnapshot(copy).childNodes); snapshot.append(paragraph); ranges.push(range);
  }
  const separators = gaps.map(([from, to]) => { const range = document.createRange(); range.setStart(...point(from)); range.setEnd(...point(to)); return range; });
  return { snapshot, ranges, separators };
}
