// Hide only successfully translated text; retain the original nodes for restoration.
export class OriginalVisibility {
  private hidden = new Map<HTMLElement, string | null>();
  private wrappers = new Set<HTMLSpanElement>();
  hide(root: HTMLElement): void {
    if (root.matches('[data-ft-owned]')) return;
    if (!root.querySelector('[data-ft-owned],img,video,audio,iframe') && !root.matches('img,video,audio,iframe')) {
      if (!this.hidden.has(root)) { this.hidden.set(root, root.getAttribute('data-ft-original-hidden')); root.setAttribute('data-ft-original-hidden', ''); }
      return;
    }
    for (const node of [...root.childNodes]) {
      if (node instanceof HTMLElement && !node.matches('img,video,audio,iframe')) this.hide(node);
      else if (node instanceof Text && node.textContent?.trim()) {
        const wrapper = document.createElement('span'); node.before(wrapper); wrapper.append(node); this.wrappers.add(wrapper); this.hide(wrapper);
      }
    }
  }
  hideRange(range: Range): void {
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const nodes: Node[] = [root];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    const selected = nodes.filter(node => range.intersectsNode(node) && !(node instanceof Element ? node : node.parentElement)?.closest('[data-ft-owned],[data-ft-original-hidden]'));
    for (const node of selected.reverse()) {
      if (node instanceof HTMLBRElement) { this.hide(node); continue; }
      if (!(node instanceof Text)) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (to <= from) continue;
      if (to < node.length) node.splitText(to);
      const text = from ? node.splitText(from) : node;
      const wrapper = document.createElement('span'); text.before(wrapper); wrapper.append(text); this.wrappers.add(wrapper); this.hide(wrapper);
    }
  }
  restore(): void {
    for (const [element, value] of this.hidden) { if (value === null) element.removeAttribute('data-ft-original-hidden'); else element.setAttribute('data-ft-original-hidden', value); }
    for (const wrapper of this.wrappers) wrapper.replaceWith(...wrapper.childNodes);
    this.hidden.clear(); this.wrappers.clear();
  }
}
