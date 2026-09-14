import type { Kind } from './settings';
export const OWNED = '[data-ft-owned]';
const X_ARTICLE = '[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]';
const X_ARTICLE_BLOCK = '[data-block="true"],p,h1,h2,h3,h4,h5,h6,li,blockquote';
const RULES: ReadonlyArray<readonly [Kind, string]> = [
  ['title', 'shreddit-post [slot="title"], shreddit-post h1, .thing.link > .entry a.title, [data-testid="post-container"] [data-adclicklocation="title"] h3'],
  ['title', '[data-testid="twitterArticleTitle"], [data-testid="twitter-article-title"]'],
  // Observe article blocks separately: a whole-article owner starts every
  // paragraph at once and rebuilds the entire document on each partial result.
  ['body', `[data-testid="tweetText"], :is(${X_ARTICLE}) :is(${X_ARTICLE_BLOCK}), :is(${X_ARTICLE}):not(:has(:is(${X_ARTICLE_BLOCK})))`],
  ['body', 'shreddit-post [slot="text-body"], shreddit-post [id$="-post-rtjson-content"], .thing.link > .entry .usertext-body > .md, [data-testid="post-container"] [data-click-id="text"]'],
  ['comment', 'shreddit-comment [slot="comment"], .thing.comment > .entry .usertext-body > .md, [data-testid="comment"]'],
];
const EXCLUDE = `${OWNED},[data-image-insight-host],textarea,input,[contenteditable]:not([contenteditable="false"]),[slot="credit-bar"],shreddit-ad-post`;
export function contentSelector(kind: Kind): string { return RULES.filter(([value]) => value === kind).map(([, selector]) => selector).join(','); }
export interface Candidate { element: HTMLElement; kind: Kind }
export function discover(root: ParentNode): Candidate[] {
  const found = new Map<HTMLElement, Kind>();
  for (const [kind, selector] of RULES) {
    const elements = [...root.querySelectorAll<HTMLElement>(selector)];
    if (root instanceof HTMLElement && root.matches(selector)) elements.unshift(root);
    for (const element of elements) {
      if (!element.closest(EXCLUDE)) found.set(element, kind);
    }
  }
  // Prefer outer content owner when two supported selectors match the same text.
  return [...found].filter(([element]) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (found.has(parent)) return false;
    return true;
  })
    .map(([element, kind]) => ({ element, kind }));
}
export function isReadable(element: HTMLElement, checkLayout = true): boolean {
  if (!element.isConnected || element.closest('[data-ft-duplicate],[hidden],[aria-hidden="true"],.collapsed,shreddit-comment[collapsed]:not([collapsed="false"]),shreddit-comment[aria-expanded="false"],details:not([open])')) return false;
  return !checkLayout || element.getClientRects().length > 0;
}
// Clone through an allowlist: never copy host handlers, custom elements, IDs or interactive controls.
export function sourceSnapshot(element: HTMLElement, origins?: Map<Node, HTMLElement>): HTMLDivElement {
  const result = element.ownerDocument.createElement('div');
  const skip = `${EXCLUDE},[hidden],[aria-hidden="true"],script,style,button,select,form,svg,img,video,audio,iframe,[slot="post-media-container"],[slot="post-media"],[data-click-id="media"],shreddit-player,reddit-video-player,shreddit-gallery`;
  const allowed = new Set(['p', 'br', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'b', 'i', 's', 'pre', 'code', 'kbd', 'samp', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tbody', 'tr', 'td', 'th']);
  function visit(node: Node, parent: Node): void {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(element.ownerDocument.createTextNode(node.textContent ?? '')); return; }
    if (!(node instanceof Element) || node.matches(skip)) return;
    const tag = node.localName;
    let clone: HTMLElement | null = null;
    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href) {
        try {
          const url = new URL(href, element.ownerDocument.baseURI);
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            clone = element.ownerDocument.createElement('a');
            clone.setAttribute('href', url.href); clone.setAttribute('rel', 'noopener noreferrer');
            // Link text can contain aria-hidden spans used only for visual display on X.
            const source = node.cloneNode(true) as Element;
            source.querySelectorAll(OWNED).forEach(owned => owned.remove());
            const label = (source.textContent || '').trim();
            // Image-only links have no translatable label and leave an empty card.
            if (!label) return;
            clone.textContent = label;
            clone.setAttribute('title', url.href);
            parent.appendChild(clone);
            origins?.set(clone, node as HTMLElement);
            return;
          }
        } catch { /* invalid link becomes plain text */ }
      }
    } else if (allowed.has(tag)) clone = element.ownerDocument.createElement(tag);
    // Draft.js renders article paragraphs as divs. Keep their boundaries and
    // origin mapping so inline translations follow the corresponding block.
    else if (tag === 'div' && node.matches('[data-block="true"],.public-DraftStyleDefault-block')
      && element.closest('[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]')) {
      clone = element.ownerDocument.createElement('div');
    }
    if (clone) { parent.appendChild(clone); origins?.set(clone, node as HTMLElement); }
    for (const child of node.childNodes) visit(child, clone ?? parent);
  }
  for (const child of element.childNodes) visit(child, result);
  // Media is deliberately omitted above; discard its now-empty paragraph/list
  // wrappers too, before section paths and translation placeholders are created.
  for (const block of [...result.querySelectorAll('p,blockquote,ul,ol,h1,h2,h3,h4,h5,h6')].reverse()) {
    if (!(block.textContent ?? '').trim() && !block.querySelector('pre,code,kbd,samp') && !block.closest('pre,code,kbd,samp')) block.remove();
  }
  while (result.lastChild && (result.lastChild instanceof Text && !result.lastChild.data.trim()
    || result.lastChild instanceof Element && result.lastChild.matches('br'))) result.lastChild.remove();
  return result;
}
export function contentIdentity(element: HTMLElement): string {
  const tweet = element.closest('article[data-testid="tweet"]');
  if (tweet) {
    const href = tweet.querySelector('time')?.closest('a')?.getAttribute('href') ?? '';
    const id = /\/status\/(\d+)(?:[/?#]|$)/.exec(href)?.[1];
    if (id) return `x:status:${id}`;
    if (href) return href;
  }
  // The expanded Article reader has no tweet/time owner. Its route carries
  // the same ID as the normal status view; retain the existing cache namespace.
  if (element.closest('[data-testid="twitterArticleReadView"],[data-testid="twitterArticleTitle"],[data-testid="twitter-article-title"],[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]')
    && /(^|\.)(x|twitter)\.com$/.test(location.hostname)) {
    const id = /^\/[^/]+\/(?:status|article)\/(\d+)(?:\/|$)/.exec(location.pathname)?.[1];
    if (id) return `x:status:${id}`;
  }
  const owner = element.closest('shreddit-comment,shreddit-post,.thing,[data-testid="post-container"],[data-testid="comment"]');
  return owner?.getAttribute('thingid') ?? owner?.getAttribute('post-id') ?? owner?.getAttribute('id') ?? '';
}
