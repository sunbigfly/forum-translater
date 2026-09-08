// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { discover, sourceSnapshot } from '../src/reddit';
import { normalizeSettings } from '../src/settings';

describe('Reddit content owners', () => {
  it('excludes injected translations from link labels in source snapshots', () => {
    const source = document.createElement('div'); source.innerHTML = '<a href="https://example.com">example.com</a>';
    const before = sourceSnapshot(source).innerHTML;
    const translated = document.createElement('div'); translated.dataset.ftOwned = 'translation'; translated.textContent = '译文';
    source.querySelector('a')?.append(translated);
    expect(sourceSnapshot(source).innerHTML).toBe(before);
  });
  it('preserves visually displayed link spans, ellipsis and destination without copying hidden semantics', () => {
    const source = document.createElement('div'); source.innerHTML = '<a href="https://github.com/user/project"><span aria-hidden="true">github.com/</span><span>user/…</span></a>';
    const anchor = sourceSnapshot(source).querySelector('a');
    expect(anchor?.textContent).toBe('github.com/user/…'); expect(anchor?.getAttribute('href')).toBe('https://github.com/user/project');
    expect(anchor?.getAttribute('title')).toBe('https://github.com/user/project');
  });
  it('finds modern title, body and separate nested comments without credits or generated content', () => {
    document.body.innerHTML = `<shreddit-post><a slot="title"><h1>Post title</h1></a><div slot="text-body"><div id="t3_x-post-rtjson-content"><p>Post body</p></div></div><span slot="credit-bar">user</span><div data-ft-owned slot="title">译文</div></shreddit-post><shreddit-comment><div slot="comment"><p>Parent text</p></div><shreddit-comment><div slot="comment"><p>Child text</p></div></shreddit-comment></shreddit-comment>`;
    expect(discover(document).map(item => [item.kind, item.element.textContent])).toEqual([
      ['title', 'Post title'], ['body', 'Post body'], ['comment', 'Parent text'], ['comment', 'Child text'],
    ]);
  });
  it('supports old Reddit without collecting nested replies twice', () => {
    document.body.innerHTML = `<div class="thing link"><div class="entry"><a class="title">Title</a><div class="usertext-body"><div class="md">Body</div></div></div></div><div class="thing comment"><div class="entry"><div class="usertext-body"><div class="md">Comment</div></div></div></div>`;
    expect(discover(document).map(item => item.kind)).toEqual(['title', 'body', 'comment']);
  });
  it('sanitizes copied structure and preserves original media and links', () => {
    const source = document.createElement('div');
    source.innerHTML = '<p id="x" onclick="bad()">Hello <strong>world</strong><a href="javascript:bad()">unsafe</a><a href="https://example.com">safe</a><code>npm run</code><img src="x"><button>vote</button><input value="secret"><div contenteditable="true">draft</div></p>';
    const before = source.innerHTML; const snapshot = sourceSnapshot(source);
    expect(snapshot.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
    expect(snapshot.querySelector('[id],[onclick],input,img,button,[contenteditable]')).toBeNull();
    expect(snapshot.textContent).not.toMatch(/vote|secret|draft/);
    expect(snapshot.querySelector('strong')?.textContent).toBe('world');
    expect(source.innerHTML).toBe(before);
  });
  it('rejects editor and ad owners and bounds settings', () => {
    document.body.innerHTML = '<shreddit-ad-post><shreddit-post><h1>Ad</h1></shreddit-post></shreddit-ad-post><div contenteditable="true"><shreddit-comment><p slot="comment">Draft</p></shreddit-comment></div>';
    expect(discover(document)).toEqual([]);
    expect(normalizeSettings({ before: -1, after: Infinity })).toMatchObject({ enabled: true, before: 0, after: 1200 });
  });
});

it('discovers X tweet, reply and quote text without usernames, controls or translated text', () => {
  document.body.innerHTML = '<nav>Explore</nav><article data-testid="tweet"><div data-testid="User-Name">Someone</div><div data-testid="tweetText"><span>Hello</span><br><a href="https://example.com">link</a></div><div role="link"><div data-testid="tweetText">Quoted post</div></div><button>Reply</button><div data-ft-owned="translation"><div data-testid="tweetText">旧译文</div></div></article><article data-testid="tweet"><div data-testid="tweetText">A reply</div></article><div data-testid="tweetText" contenteditable="true">Draft</div>';
  const candidates = discover(document);
  expect(candidates.map(item => [item.kind, item.element.textContent])).toEqual([['body', 'Hellolink'], ['body', 'Quoted post'], ['body', 'A reply']]);
  const first = candidates[0]; if (!first) throw new Error('Missing tweet');
  expect(sourceSnapshot(first.element).querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
  expect(sourceSnapshot(first.element).querySelector('br')).not.toBeNull();
});
