// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isOwnedMutation } from '../src/dom-mutations';

it('filters UI insertion, removal and nested text updates while retaining mixed host changes', () => {
  const host = document.createElement('div'); document.body.append(host);
  const observer = new MutationObserver(() => undefined);
  observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true });
  try {
    const translation = document.createElement('div'); translation.dataset.ftOwned = 'translation';
    host.append(translation);
    const text = document.createTextNode('等待'); translation.append(text); text.data = '译文'; translation.setAttribute('data-ft-streaming', '');
    translation.remove();
    const owned = observer.takeRecords();
    expect(owned.length).toBeGreaterThan(3); expect(owned.every(isOwnedMutation)).toBe(true);
    host.append(translation, document.createElement('video'));
    expect(observer.takeRecords().some(record => !isOwnedMutation(record))).toBe(true);
    host.append('host label');
    expect(observer.takeRecords().every(record => !isOwnedMutation(record))).toBe(true);
  } finally { observer.disconnect(); host.remove(); }
});
