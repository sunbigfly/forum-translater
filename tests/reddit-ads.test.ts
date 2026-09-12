// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.reddit.com/r/popular/"}
import { afterEach, expect, it, vi } from 'vitest';
import { isRedditAd, RedditAds } from '../src/reddit-ads';

let ads: RedditAds | undefined;

it('does not rescan advertisements when owned translation text streams', async () => {
  vi.useFakeTimers(); ads = new RedditAds(); await vi.advanceTimersByTimeAsync(300);
  const scan = vi.spyOn(document, 'querySelectorAll');
  try {
    const translation = document.createElement('div'); translation.dataset.ftOwned = 'translation'; document.body.append(translation);
    const text = document.createTextNode('译文'); translation.append(text); text.data = '完整译文';
    await vi.advanceTimersByTimeAsync(300); translation.remove(); await vi.advanceTimersByTimeAsync(300);
    expect(scan).not.toHaveBeenCalled();
  } finally { scan.mockRestore(); }
});
afterEach(() => { ads?.destroy(); ads = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

it('hides sidebar ad slots including their heading while preserving recommendations and footer', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<aside id="right-sidebar"><section id="recommendations">Ad discussion</section><div id="right-rail-ad-slot"><header>AD</header><shreddit-display-ad></shreddit-display-ad></div><footer>Reddit Rules</footer></aside>';
  ads = new RedditAds();
  expect(document.querySelectorAll('[data-ft-reddit-ad]')).toHaveLength(1);
  expect(document.querySelector('#right-rail-ad-slot')?.hasAttribute('data-ft-reddit-ad')).toBe(true);
  expect(document.querySelector('#right-sidebar')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  expect(document.querySelector('#recommendations')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  expect(document.querySelector('footer')?.hasAttribute('data-ft-reddit-ad')).toBe(false);

  const host = document.createElement('shreddit-sidebar-ad');
  host.attachShadow({ mode: 'open' }).innerHTML = '<header>AD</header><img alt="Apple Event">';
  document.querySelector('aside')?.append(host);
  await vi.advanceTimersByTimeAsync(160);
  expect(host.hasAttribute('data-ft-reddit-ad')).toBe(true);
  ads.destroy();
  expect(document.querySelector('[data-ft-reddit-ad]')).toBeNull();
});

it('tracks late sidebar slot identification and releases recycled containers', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<aside><div id="pending"><span>AD</span><img></div></aside>';
  const slot = document.querySelector<HTMLElement>('#pending');
  if (!slot) throw new Error('Missing sidebar fixture');
  ads = new RedditAds();
  expect(slot.hasAttribute('data-ft-reddit-ad')).toBe(false);
  slot.id = 'right-rail-ad-slot';
  await vi.advanceTimersByTimeAsync(160);
  expect(slot.hasAttribute('data-ft-reddit-ad')).toBe(true);
  slot.id = 'recommendations';
  await vi.advanceTimersByTimeAsync(160);
  expect(slot.hasAttribute('data-ft-reddit-ad')).toBe(false);
});

it('hides detail-page ad hosts, including shadow content, without hiding the enclosing post or comments', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<shreddit-post id="detail"><h1>Normal post</h1><video></video><div id="actions">Vote</div><div id="ad-slot"></div><textarea></textarea><shreddit-comment>Ad discussion</shreddit-comment></shreddit-post>';
  ads = new RedditAds();
  const host = document.createElement('shreddit-comments-page-ad');
  host.attachShadow({ mode: 'open' }).innerHTML = '<div><span>Grok-by-SpaceXAI</span><span>Ad</span><button>Sign Up</button></div>';
  document.querySelector('#ad-slot')?.append(host);
  await vi.advanceTimersByTimeAsync(160);
  expect(host.hasAttribute('data-ft-reddit-ad')).toBe(true);
  expect(document.querySelectorAll('[data-ft-reddit-ad]')).toHaveLength(1);
  expect(document.querySelector('#detail')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  expect(document.querySelector('#ad-slot')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  expect(document.querySelector('shreddit-comment')?.textContent).toBe('Ad discussion');
  expect(document.querySelector('textarea')?.isConnected).toBe(true);
  host.remove();
  await vi.advanceTimersByTimeAsync(160);
  expect(host.hasAttribute('data-ft-reddit-ad')).toBe(false);
});

it('recognizes explicit ad posts and credit labels without treating ordinary post text as ads', () => {
  document.body.innerHTML = '<shreddit-ad-post></shreddit-ad-post><shreddit-post promoted></shreddit-post><shreddit-post is-promoted="true"></shreddit-post><div class="thing link promoted"></div><div data-testid="post-container"><span data-testid="promoted-label">Promoted</span></div><shreddit-post><div slot="credit-bar"><a>u/sponsor</a><span>Ad</span></div><h1>Email for Autonomous Agents</h1></shreddit-post><shreddit-post promoted="false"><div slot="credit-bar"><a>u/person</a></div><h1>Ad</h1><div slot="text-body"><span>Sponsored</span></div></shreddit-post>';
  expect([...document.body.children].map(isRedditAd)).toEqual([true, true, true, true, true, true, false]);
});

it('hides the whole ad while preserving neighbors and handles dynamically loaded or recycled posts', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="feed"><shreddit-ad-post><shreddit-post><h1>Paid</h1></shreddit-post></shreddit-ad-post><shreddit-post id="normal"><h1>Normal</h1></shreddit-post></div>';
  ads = new RedditAds();
  expect(document.querySelectorAll('[data-ft-reddit-ad]')).toHaveLength(1);
  expect(document.querySelector('shreddit-ad-post')?.hasAttribute('data-ft-reddit-ad')).toBe(true);
  expect(document.querySelector('#feed')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  expect(document.querySelector('#normal')?.hasAttribute('data-ft-reddit-ad')).toBe(false);
  const post = document.createElement('shreddit-post'); post.setAttribute('promoted', '');
  document.querySelector('#feed')?.append(post);
  await vi.advanceTimersByTimeAsync(160);
  expect(post.hasAttribute('data-ft-reddit-ad')).toBe(true);
  post.setAttribute('promoted', 'false');
  await vi.advanceTimersByTimeAsync(160);
  expect(post.hasAttribute('data-ft-reddit-ad')).toBe(false);
  post.innerHTML = '<div slot="credit-bar"><span>广告</span></div>';
  await vi.advanceTimersByTimeAsync(160);
  expect(post.hasAttribute('data-ft-reddit-ad')).toBe(true);
  ads.destroy();
  expect(document.querySelector('[data-ft-reddit-ad]')).toBeNull();
});
