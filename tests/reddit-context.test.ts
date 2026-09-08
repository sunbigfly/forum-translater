// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { redditContext } from '../src/reddit-context';
afterEach(() => { document.body.replaceChildren(); history.replaceState(null, '', '/'); });
it('shares the owning post and only the ancestor reply chain, excluding translations and siblings', () => {
  history.replaceState(null, '', '/r/test/comments/abc/title/');
  document.body.innerHTML = '<shreddit-post id="t3_wrong"><h1>Unrelated</h1></shreddit-post><shreddit-post id="t3_abc"><h1>Post title</h1><div slot="text-body">Post body<div data-ft-owned="translation">旧译文</div></div></shreddit-post><shreddit-comment><div slot="comment">Parent</div><shreddit-comment><div slot="comment">Sibling</div></shreddit-comment><shreddit-comment><div id="reply" slot="comment">Current reply</div></shreddit-comment></shreddit-comment>';
  const reply = document.getElementById('reply'); if (!reply) throw new Error('Missing reply');
  expect(redditContext(reply, 'comment')).toEqual({ title: 'Post title', body: 'Post body', parents: ['Parent'] });
});
it('does not duplicate the current body and keeps list posts separate', () => {
  document.body.innerHTML = '<shreddit-post><h1>First title</h1><div id="body" slot="text-body">First body</div></shreddit-post><shreddit-post><h1>Second title</h1><div slot="text-body">Second body</div></shreddit-post>';
  const body = document.getElementById('body'); if (!body) throw new Error('Missing body');
  expect(redditContext(body, 'body')).toEqual({ title: 'First title', body: '', parents: [] });
});
it('bounds parent and post context without including child replies', () => {
  history.replaceState(null, '', '/r/test/comments/abc/title/');
  document.body.innerHTML = `<shreddit-post id="t3_abc"><h1>Title</h1><div slot="text-body">${'a'.repeat(6000)}</div></shreddit-post><shreddit-comment><div slot="comment">Grandparent</div><shreddit-comment><div slot="comment">${'b'.repeat(2000)}</div><shreddit-comment><div id="reply" slot="comment">Current</div><shreddit-comment><div slot="comment">Child</div></shreddit-comment></shreddit-comment></shreddit-comment></shreddit-comment>`;
  const reply = document.getElementById('reply'); if (!reply) throw new Error('Missing reply');
  const context = redditContext(reply, 'comment');
  expect(context?.body).toHaveLength(4000); expect(context?.parents).toEqual(['Grandparent', 'b'.repeat(1200)]);
});
