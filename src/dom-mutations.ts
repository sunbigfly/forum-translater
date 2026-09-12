/** Changes made inside our UI must not rescan the host page. */
export function isOwnedMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest('[data-ft-owned]')) return true;
  if (record.type !== 'childList') return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.length > 0 && changed.every(node => node instanceof Element && node.matches('[data-ft-owned]'));
}
