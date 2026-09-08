import { contentIdentity, discover, sourceSnapshot } from './reddit';
import type { Kind } from './settings';
const POST = 'shreddit-post,.thing.link,[data-testid="post-container"]';
const COMMENT = 'shreddit-comment,.thing.comment,[data-testid="comment"]';
export interface RedditThreadContext { title: string; body: string; parents: string[] }
const original = (element: HTMLElement | undefined, limit: number): string => element ? (sourceSnapshot(element).textContent ?? '').trim().slice(0, limit) : '';
export function redditContext(element: HTMLElement, kind: Kind): RedditThreadContext | undefined {
  if (element.closest('article[data-testid="tweet"]')) return;
  let post = element.closest<HTMLElement>(POST);
  if (!post && kind === 'comment') {
    const id = location.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
    if (id) post = [...document.querySelectorAll<HTMLElement>(POST)].find(candidate => contentIdentity(candidate) === `t3_${id}` || candidate.getAttribute('permalink')?.includes(`/comments/${id}/`)) ?? null;
  }
  const parts = post ? discover(post).filter(item => item.element.closest(POST) === post) : [];
  const title = kind === 'title' ? '' : original(parts.find(item => item.kind === 'title')?.element, 500);
  const body = kind === 'body' ? '' : original(parts.find(item => item.kind === 'body')?.element, 4000);
  const parents: string[] = [];
  let parent = element.closest(COMMENT)?.parentElement?.closest(COMMENT);
  while (parent && parents.length < 2) {
    const content = discover(parent).find(item => item.kind === 'comment' && item.element.closest(COMMENT) === parent);
    const text = original(content?.element, 1200);
    if (text) parents.unshift(text);
    parent = parent.parentElement?.closest(COMMENT);
  }
  return title || body || parents.length ? { title, body, parents } : undefined;
}
