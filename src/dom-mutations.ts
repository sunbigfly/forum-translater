/** Changes made inside our UI must not rescan the host page. */
export function isOwnedMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest('[data-ft-owned]')) return true;
  if (record.type !== 'childList') return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  // Highlight wrapping/unwrapping preserves source text. Do not treat our spans
  // as new posts; actual host text edits and other markup still need reconciliation.
  if (changed.some(node => node instanceof Element && node.matches('[data-ft-word]'))
    && changed.every(node => node instanceof Text || node instanceof Element && node.matches('[data-ft-word]'))
    && [...record.addedNodes].map(node => node.textContent ?? '').join('') === [...record.removedNodes].map(node => node.textContent ?? '').join('')) return true;
  return changed.length > 0 && changed.every(node => node instanceof Element && node.matches('[data-ft-owned]'));
}
