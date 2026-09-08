// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { XAds, isXAd } from '../src/x-ads';
afterEach(() => document.body.replaceChildren());
const post = (label: string, body: string): string => `<article data-testid="tweet"><header><div data-testid="User-Name">Author</div><span>${label}</span><button data-testid="caret">More</button></header><div data-testid="tweetText">${body}</div></article>`;
it('recognizes a header ad label but not ordinary text or video tracking', () => {
  document.body.innerHTML = post('广告', 'Sponsored post') + post('', '<span>广告</span><div data-testid="placementTracking">Video</div>') + post('Ad', 'Another sponsor');
  expect([...document.querySelectorAll('article')].map(isXAd)).toEqual([true, false, true]);
  document.body.innerHTML = post('', 'Normal post').replace('Author', '<span>Ad</span>');
  const namedAd = document.querySelector('article'); if (!namedAd) throw new Error('Missing post');
  expect(isXAd(namedAd)).toBe(false);
});
it('hides only the ad cell and restores it when the virtualized cell is reused or disabled', () => {
  document.body.innerHTML = `<div data-testid="primaryColumn"><div data-testid="cellInnerDiv">${post('广告', 'Paid')}</div><div data-testid="cellInnerDiv">${post('', 'Normal')}</div></div>`;
  const ads = new XAds(); ads.reconcile(true);
  expect(document.querySelectorAll('[data-ft-x-ad]')).toHaveLength(1);
  const cell = document.querySelector('[data-ft-x-ad]'); if (!cell) throw new Error('Missing ad');
  cell.innerHTML = post('', 'Reused organic post'); ads.reconcile(true);
  expect(cell.hasAttribute('data-ft-x-ad')).toBe(false);
  cell.innerHTML = post('Ad', 'Paid'); ads.reconcile(true); ads.reconcile(false);
  expect(cell.hasAttribute('data-ft-x-ad')).toBe(false); expect(cell.textContent).toContain('Paid');
});
