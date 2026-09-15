import { redditContext } from './reddit-context';
import { mountVocabulary } from './vocabulary-ui';
import { xParagraphs } from './x-paragraphs';
import { XLongPosts } from './x-long-posts';
import { isXPostBackground, isXPostBackgroundRoute, isXPostPath } from './x-post-modal';
import { FeedDeduplicator } from './feed-deduplicator';
import { TabTitle } from './tab-title';
import { contentIdentity, discover, isReadable, OWNED, sourceSnapshot } from './reddit';
import { OriginalVisibility } from './original-visibility';
import { isXSite, loadTranslationOnly, type Kind, type Settings, type TranslationTheme } from './settings';
import { TranslationService } from './translation/service';
import { renderTranslationText, TranslationSectionsRenderer, translationBlockNeedsTranslation, translationSectionPlans, translationTextPlan } from './translation/translation-text';
import { TRANSLATION_PROMPT_VERSION } from './translation/translation-prompt';
import { isOwnedMutation } from './dom-mutations';
interface Entry {
  element: HTMLElement; kind: Kind; box: HTMLDivElement | null; controller: AbortController | null;
  near: boolean; visible: boolean; state: 'idle' | 'loading' | 'done' | 'error';
  signature: string; sourceSignature: string | null; identity: string; owner: string; completed: Map<number, string>; inlineBoxes: HTMLDivElement[]; originals: OriginalVisibility; learning: (() => void) | null;
}
function matchTextStyle(target: HTMLElement, source: Element): void {
  const style = getComputedStyle(source);
  for (const property of ['font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing']) {
    const value = style.getPropertyValue(property);
    if (value) target.style.setProperty(property, value);
  }
}
export class RedditRuntime {
  private entries = new Map<HTMLElement, Entry>();
  private longPosts = new XLongPosts();
  private detached = new Map<Entry, number>();
  private completedParagraphs = new Map<string, string>();
  private nearObserver: IntersectionObserver;
  private visibleObserver: IntersectionObserver;
  private mutations: MutationObserver;
  private roots = new Set<ParentNode>();
  private sequence = 0;
  private destroyed = false;
  private route = location.href;
  private translationOnly: boolean;
  private tabTitle = new TabTitle();
  private feed = new FeedDeduplicator();
  setTranslationTheme(theme: TranslationTheme): void {
    this.settings.translationTheme = theme;
    for (const entry of this.entries.values()) for (const box of [entry.box, ...entry.inlineBoxes]) if (box) box.dataset.translationTheme = theme;
  }
  constructor(readonly settings: Settings, readonly service: TranslationService) {
    this.translationOnly = settings.translationOnly;
    this.nearObserver = new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = this.entries.get(change.target as HTMLElement);
        if (!entry) continue;
        entry.near = change.isIntersecting;
        if (entry.near) this.start(entry);
      }
    }, { rootMargin: `${settings.before}px 0px ${settings.after}px 0px` });
    this.visibleObserver = new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = this.entries.get(change.target as HTMLElement);
        if (!entry) continue;
        entry.visible = change.isIntersecting;
        if (entry.visible) { this.service.promote(entry.owner, 'visible'); this.start(entry); }
        else this.service.deprioritize(entry.owner);
      }
      this.updateForeground();
    });
    this.mutations = new MutationObserver(records => this.onMutations(records));
    this.mutations.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['hidden', 'collapsed', 'aria-hidden', 'aria-expanded', 'open', 'class', 'style', 'slot', 'id', 'thingid', 'post-id', 'lang', 'data-testid'] });
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('click', this.onCommentExpansion, true);
    document.addEventListener('toggle', this.onCommentExpansion, true);
    window.addEventListener('popstate', this.onRoute);
    this.roots.add(document); this.reconcile();
  }
  private onMutations(records: MutationRecord[]): void {
    let relevant = location.href !== this.route;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || isOwnedMutation(record)) continue;
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node instanceof Element && !node.matches(OWNED)) this.roots.add(node);
      }
      relevant = true;
      let owner: Entry | undefined;
      for (let node: Element | null = target; node && !owner; node = node.parentElement) {
        if (node instanceof HTMLElement) owner = this.entries.get(node);
      }
      if (owner) {
        if (record.type !== 'attributes' || !['class', 'style', 'collapsed', 'open', 'aria-expanded'].includes(record.attributeName ?? '')) owner.sourceSignature = null;
        this.roots.add(owner.element);
      } else if (record.type !== 'childList') this.roots.add(target);
    }
    if (relevant) this.schedule();
  }
  private sourceMatches(entry: Entry): boolean {
    // Catch host mutations even if a promise resolves before the observer callback.
    const pending = this.mutations.takeRecords();
    if (pending.length) this.onMutations(pending);
    entry.sourceSignature ??= sourceSnapshot(entry.element).innerHTML;
    return entry.sourceSignature === entry.signature;
  }
  private onCommentExpansion = (event: Event): void => {
    // Reddit's expansion controls can live in shadow DOM; use the composed path.
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      if (node.closest(OWNED)) return;
      const owner = node.closest('article[data-testid="tweet"],shreddit-comment,.thing.comment,[data-testid="comment"],details');
      if (!owner) continue;
      this.roots.add(owner); this.schedule(); return;
    }
  };
  private onRoute = (): void => { this.schedule(); };
  private onVisibility = (): void => {
    for (const entry of this.entries.values()) {
      if (!document.hidden) this.start(entry);
    }
  };
  private schedule(): void { this.service.worker.render('reconcile', () => this.reconcile(), 16); }
  private updateForeground(): void {
    // IntersectionObserver already supplies visibility. Reading rects while sorting
    // every visible post can force layout during a swipe, especially inside dialogs.
    let first: Entry | undefined;
    for (const entry of this.entries.values()) {
      if (!entry.visible || entry.state !== 'idle' && entry.state !== 'loading'
        || isXPostBackground(entry.element) || !isReadable(entry.element, false)) continue;
      if (!first || first.element.compareDocumentPosition(entry.element) & Node.DOCUMENT_POSITION_PRECEDING) first = entry;
    }
    this.service.setForeground(first?.owner);
  }
  private remove(entry: Entry): void {
    this.detached.delete(entry);
    entry.learning?.(); entry.learning = null;
    this.cancel(entry); entry.originals.restore(); for (const item of entry.inlineBoxes) item.remove(); entry.box?.remove(); this.nearObserver.unobserve(entry.element);
    this.visibleObserver.unobserve(entry.element); this.service.release(entry.owner); this.entries.delete(entry.element);
  }
  private reconcile(): void {
    if (this.destroyed) return;
    this.longPosts.reconcile();
    this.feed.reconcile();
    if (this.route !== location.href) {
      const nativePostNavigation = isXSite() && document.documentElement.hasAttribute('data-ft-x-post-layout')
        && (isXPostPath(new URL(this.route, location.href).pathname) || isXPostPath(location.pathname ?? ''));
      this.tabTitle.reset();
      this.route = location.href; this.translationOnly = loadTranslationOnly();
      // X may keep the feed tree while showing a Post. Do not tear down its
      // translations, vocabulary listeners, or task manager just because the URL changed.
      if (!isXSite()) {
        for (const entry of this.entries.values()) this.remove(entry);
        this.service.resetPending();
      }
      // Native Post navigation retains the background. Mutation roots already
      // identify new/changed content; route-only returns need no full rescan.
      if (!nativePostNavigation) { this.roots.clear(); this.roots.add(document); }
    }
    for (const entry of this.entries.values()) {
      if (entry.element.isConnected) { this.detached.delete(entry); continue; }
      // A completed feed subtree can be detached and reattached by X's router.
      // Keep its actual nodes briefly; cap retention to avoid collecting virtualized history.
      if (isXSite() && entry.state === 'done') {
        const since = this.detached.get(entry) ?? Date.now(); this.detached.set(entry, since);
        if (Date.now() - since < 60000) continue;
      }
      this.remove(entry);
    }
    while (this.detached.size > 50) { const oldest = this.detached.keys().next().value; if (oldest) this.remove(oldest); }
    for (const root of this.roots) {
      if (root instanceof Element && !root.isConnected) continue;
      for (const candidate of discover(root)) {
        // Native Post modals aria-hide the live feed. Keep its translation DOM
        // and in-flight work instead of treating the background as collapsed content.
        if (isXPostBackground(candidate.element)) continue;
        const { kind } = candidate;
        if (!this.settings[kind]) continue;
        const known = this.entries.get(candidate.element);
        if (known && known.sourceSignature === known.signature && known.identity === contentIdentity(candidate.element)
          && !/^zh(?:-|$)/i.test(candidate.element.lang) && (known.state !== 'done' || known.box?.isConnected)) {
          if (known.state !== 'done') { if (isReadable(known.element)) this.start(known); else this.cancel(known); }
          continue;
        }
        const element = this.longPosts.prepare(candidate.element);
        const snapshot = sourceSnapshot(element);
        const signature = snapshot.innerHTML;
        const identity = contentIdentity(element);
        const existing = this.entries.get(element);
        if (/^zh(?:-|$)/i.test(element.lang)) { if (existing) this.remove(existing); continue; }
        if (existing && (existing.signature !== signature || existing.identity !== identity || !existing.box?.isConnected && existing.state === 'done')) this.remove(existing);
        if (this.entries.has(element)) {
          const current = this.entries.get(element);
          if (current) {
            current.sourceSignature = signature;
            if (current.state !== 'done') { if (isReadable(element)) this.start(current); else this.cancel(current); }
          }
          continue;
        }
        if (!translationSectionPlans(snapshot).some(plan => translationBlockNeedsTranslation(plan.text, true))) continue;
        // A newly inserted parent owner supersedes a previously discovered child.
        for (const entry of this.entries.values()) if (element.contains(entry.element)) this.remove(entry);
        if ([...this.entries.keys()].some(other => other.contains(element))) continue;
        const sameContent = existing?.identity === identity;
        // Seed visibility now instead of waiting for the first observer callback.
        const rect = element.getBoundingClientRect();
        const visibleNow = !document.hidden && rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
        const entry: Entry = { element, kind, box: null, controller: null, near: sameContent ? existing.near : false, visible: sameContent ? existing.visible : false,
          state: 'idle', completed: new Map(), inlineBoxes: [], originals: new OriginalVisibility(), learning: null, signature, sourceSignature: signature, identity, owner: sameContent ? existing.owner : String(++this.sequence) };
        if (visibleNow) { entry.visible = true; entry.near = true; }
        this.entries.set(element, entry); this.nearObserver.observe(element); this.visibleObserver.observe(element);
        if (entry.near || entry.visible) this.start(entry);
      }
    }
    this.roots.clear();
    this.updateForeground();
  }
  private cancel(entry: Entry): void {
    this.service.worker.release(`start:${entry.owner}`);
    entry.controller?.abort(); entry.controller = null;
    if (entry.state === 'loading') {
      entry.state = 'idle';
      if (entry.completed.size && entry.box) {
        for (const placeholder of entry.box.querySelectorAll('.hnr-translation-placeholder')) placeholder.remove();
      } else { entry.box?.remove(); for (const item of entry.inlineBoxes) item.remove(); entry.inlineBoxes = []; entry.box = null; }
    }
    this.service.release(entry.owner);
  }
  private start(entry: Entry, manual = false): void {
    if (this.destroyed || entry.state !== 'idle' && !(manual && entry.state === 'error')) return;
    this.service.worker.render(`start:${entry.owner}`, () => this.begin(entry, manual), 0);
  }
  private begin(entry: Entry, manual = false): void {
    if (this.entries.get(entry.element) !== entry) return;
    if (this.destroyed || entry.state !== 'idle' && !(manual && entry.state === 'error')) return;
    if (!isReadable(entry.element) || (!entry.near && !entry.visible && !manual)) return;
    const controller = new AbortController(); entry.controller = controller; entry.state = 'loading';
    const origins = new Map<Node, HTMLElement>();
    const x = xParagraphs(entry.element);
    const snapshot = x?.snapshot ?? sourceSnapshot(entry.element, origins);
    const plans = translationSectionPlans(snapshot);
    // Reuse completed paragraphs across feed/detail navigation, even after a reload.
    // Expanded context is excluded; source text, protected content and provider remain scoped.
    const ai = this.settings.provider === 'ai' ? this.settings.ai : undefined;
    const paragraphKeys = plans.map(plan => {
      let node: Node | undefined = snapshot;
      for (const index of plan.path) node = node?.childNodes[index];
      const protectedNodes = node instanceof Element ? translationTextPlan(node).protectedNodes.map(item => item instanceof Element ? item.outerHTML : item.textContent) : [];
      return `paragraph:v1:${JSON.stringify([this.settings.provider, ai ? [ai.baseUrl.replace(/\/+$/, ''), ai.model, ai.prompt, TRANSLATION_PROMPT_VERSION, this.settings.vocabulary] : null, entry.identity || `node:${entry.owner}`, entry.kind, plan.text, protectedNodes])}`;
    });
    const postContext = plans.map(item => item.text).join('\n\n').slice(0, 24000);
    const previews = new Map<number, string>();
    const previous = entry.identity ? new Map([...this.service.cache.matching('paragraph:v1:'), ...this.completedParagraphs]) : new Map<string, string>();
    plans.forEach(plan => {
      const key = paragraphKeys[plan.index] ?? '';
      const cached = this.completedParagraphs.get(key) ?? (entry.identity ? this.service.cache.get(key) : undefined);
      if (cached !== undefined) { entry.completed.set(plan.index, cached); return; }
      let longest = 0;
      for (const [oldKey, value] of previous) {
        if (!oldKey.startsWith('paragraph:v1:')) continue;
        try {
          const parsed: unknown = JSON.parse(oldKey.slice('paragraph:v1:'.length));
          if (!Array.isArray(parsed)) continue;
          const parts: unknown[] = parsed;
          const source = parts[4];
          if (typeof source !== 'string' || !Array.isArray(parts[5]) || parts[5].length) continue;
          const prefix = source.replace(/(?:\.{3}|…)\s*$/, '').trimEnd();
          if (!prefix || prefix.length <= longest || plan.text.length <= prefix.length || !plan.text.startsWith(prefix)) continue;
          parts[4] = plan.text;
          if (`paragraph:v1:${JSON.stringify(parts)}` !== key) continue;
          longest = prefix.length; previews.set(plan.index, value);
        } catch { /* Ignore malformed optional cache entries. */ }
      }
    });
    const thread = redditContext(entry.element, entry.kind);
    const translations = new Map([...previews, ...entry.completed]);
    const pending = new Set(plans.filter(plan => !entry.completed.has(plan.index)).map(plan => plan.index));
    const failed = new Set<number>();
    const failureReasons = new Map<number, string>();
    const streaming = new Set<number>();
    const rendered = new Map<number, string>();
    let renderedState: string | undefined;
    let sectionRenderer: TranslationSectionsRenderer | undefined;
    const box = document.createElement('div'); box.dataset.ftOwned = 'translation'; box.className = `ft-translation${this.translationOnly ? ' ft-translation-only' : ''}${entry.kind === 'title' ? ' ft-translation-title' : ''}`;
    if (entry.kind === 'title') {
      const title = entry.element.querySelector('h1,h2,h3') ?? entry.element;
      const size = Number.parseFloat(getComputedStyle(title).fontSize);
      if (Number.isFinite(size) && size > 0) box.style.setProperty('--ft-title-size', `${size * 0.9}px`);
    }
    if (entry.kind !== 'title') matchTextStyle(box, entry.element);
    box.dataset.translationTheme = this.settings.translationTheme;
    box.dataset.ftFont = entry.kind === 'title' || entry.element.matches('h1,h2,h3,h4,h5,h6') ? 'title' : 'body';
    box.lang = 'zh-CN'; box.setAttribute('aria-label', '中文翻译');
    // Keep translations outside clickable title links without replacing host content.
    const anchor = entry.element.closest('a');
    const insertionAnchor = anchor ?? entry.element;
    const slot = insertionAnchor.getAttribute('slot');
    if (slot !== null) box.setAttribute('slot', slot);
    if (!anchor && entry.element.matches('li,td,th')) entry.element.append(box);
    else insertionAnchor.after(box);
    entry.box?.remove(); entry.box = box;
    for (const item of entry.inlineBoxes) item.remove(); entry.inlineBoxes = [];
    const placements = plans.map(plan => {
      let node: Node | undefined = snapshot;
      for (const index of plan.path) node = node?.childNodes[index];
      return { node, anchor: node ? origins.get(node) : undefined, range: x?.ranges[plan.index] };
    });
    const inline = plans.length > 1 && placements.every(item => (item.anchor || item.range) && item.node instanceof Element);
    if (inline) {
      box.hidden = true;
      for (const placement of placements) {
        const part = document.createElement('div'); part.dataset.ftOwned = 'translation'; part.className = `ft-translation${this.translationOnly ? ' ft-translation-only' : ''}`; part.lang = 'zh-CN'; part.setAttribute('aria-label', '本段中文翻译');
        matchTextStyle(part, placement.anchor ?? entry.element);
        part.dataset.translationTheme = this.settings.translationTheme;
        part.dataset.ftFont = placement.anchor?.matches('h1,h2,h3,h4,h5,h6') || box.dataset.ftFont === 'title' ? 'title' : 'body';
        if (placement.range) {
          const insertion = placement.range.cloneRange(); insertion.collapse(false);
          // Exit terminal inline ancestors so translations never become link labels.
          for (;;) {
            const node = insertion.startContainer;
            const end = node instanceof Text ? node.length : node.childNodes.length;
            if (node === entry.element || insertion.startOffset !== end || !entry.element.contains(node)) break;
            insertion.setStartAfter(node); insertion.collapse(true);
          }
          insertion.insertNode(part);
        }
        else if (placement.anchor?.matches('li,td,th')) placement.anchor.append(part); else placement.anchor?.after(part);
        entry.inlineBoxes.push(part);
      }
      for (const separator of x?.separators ?? []) entry.originals.hideRange(separator);
    }
    const current = (): boolean => !controller.signal.aborted && !this.destroyed
      && (this.route === location.href || isXPostBackground(entry.element) || isXPostBackgroundRoute(entry.element))
      && entry.element.isConnected && box.isConnected && contentIdentity(entry.element) === entry.identity
      && this.sourceMatches(entry);
    const running = new Set<number>();
    const render = (): void => {
      if (!current()) return;
      if (entry.kind !== 'title' && this.settings.vocabulary && !entry.learning) {
        const owner = entry.element.closest('article[data-testid="tweet"],shreddit-post,.thing.link,[data-testid="post-container"],[data-testid="search-post-with-content-preview"]');
        const permalink = owner?.querySelector('time')?.closest('a')?.getAttribute('href') ?? owner?.getAttribute('permalink') ?? owner?.querySelector('a[href*="/comments/"]')?.getAttribute('href') ?? location.href;
        const learningAnchor = entry.element.closest('[data-ft-long-post]')?.querySelector<HTMLElement>(':scope > [data-ft-owned="long-post-toggle"]') ?? box;
        entry.learning = mountVocabulary(learningAnchor, postContext, new URL(permalink, location.href).href, this.service, { original: entry.element, translations: entry.inlineBoxes.length ? entry.inlineBoxes : [box] });
      }
      if (inline) {
        for (const plan of plans) {
          const target = entry.inlineBoxes[plan.index]; const source = placements[plan.index]?.node;
          if (!target || !(source instanceof Element)) continue;
          target.hidden = !translationBlockNeedsTranslation(plan.text, true);
          if (this.translationOnly && entry.completed.has(plan.index)) { const placement = placements[plan.index]; if (placement?.anchor) entry.originals.hide(placement.anchor); else if (placement?.range) entry.originals.hideRange(placement.range); }
          const value = translations.get(plan.index);
          target.toggleAttribute('data-ft-streaming', streaming.has(plan.index));
          const stamp = JSON.stringify([value, pending.has(plan.index), failed.has(plan.index), streaming.has(plan.index), failureReasons.get(plan.index)]);
          if (rendered.get(plan.index) === stamp) continue;
          rendered.set(plan.index, stamp);
          if (value !== undefined) { const fragment = renderTranslationText(source, value, streaming.has(plan.index)); if (fragment) target.replaceChildren(fragment); }
          else if (pending.has(plan.index)) {
            const status = document.createElement('span'); status.className = failed.has(plan.index) ? 'hnr-translation-failure' : 'hnr-translation-placeholder';
            if (failed.has(plan.index)) status.textContent = `翻译失败：${failureReasons.get(plan.index) ?? '未知错误'}（已保留原文）`; target.replaceChildren(status);
          }
          if (failed.has(plan.index)) { const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试本段'; retry.onclick = event => { event.preventDefault(); event.stopPropagation(); void run(plan.index, true); }; target.append(retry); }
          else if (value === undefined && !pending.has(plan.index)) target.replaceChildren();
        }
        return;
      }
      const stamp = JSON.stringify(plans.map(plan => [translations.get(plan.index), pending.has(plan.index), failed.has(plan.index), streaming.has(plan.index), failureReasons.get(plan.index)]));
      if (renderedState === stamp) return;
      renderedState = stamp;
      box.toggleAttribute('data-ft-streaming', streaming.size > 0);
      if (this.translationOnly && pending.size === 0 && failed.size === 0) entry.originals.hide(entry.element);
      sectionRenderer ??= new TranslationSectionsRenderer(snapshot, box);
      sectionRenderer.render(translations, { pending, failed, streaming });
      for (const status of box.querySelectorAll(':scope > [data-ft-owned="translation-status"]')) status.remove();
      if (failed.size) {
        const reason = document.createElement('span'); reason.dataset.ftOwned = 'translation-status'; reason.className = 'hnr-translation-failure'; reason.setAttribute('role', 'status');
        reason.textContent = [...new Set(failureReasons.values())].join('；'); box.append(reason);
      }
      if (entry.kind === 'title' && pending.size === 0 && failed.size === 0) this.tabTitle.update(snapshot.textContent ?? '', box.textContent ?? '');
      if (failed.size) { const retry = document.createElement('button'); retry.dataset.ftOwned = 'translation-status'; retry.type = 'button'; retry.textContent = '翻译失败 · 点击重试'; retry.onclick = () => { for (const index of [...failed]) void run(index, true); }; box.append(retry); }
    };
    const priority = entry.visible ? 'visible' : manual ? 'interactive' : 'prefetch';
    const run = async (index: number, retry = false): Promise<void> => {
      const plan = plans[index];
      if (!plan || running.has(index) || entry.completed.has(index) || !current()) return;
      if (!translationBlockNeedsTranslation(plan.text.replace(/⟦\d+⟧/g, ''), true)) { pending.delete(index); this.service.worker.render(entry.owner, render); return; }
      running.add(index); failed.delete(index); failureReasons.delete(index); pending.add(index); if (!previews.has(index)) translations.delete(index);
      entry.controller = controller; entry.state = 'loading';
      if (retry || manual) this.service.promote(entry.owner, entry.visible ? 'visible' : 'interactive');
      if (retry) this.service.worker.render(entry.owner, render);
      try {
        const value = await this.service.section(plan.text, entry.owner, entry.visible ? 'visible' : retry ? 'interactive' : priority, controller.signal, partial => {
          if (controller.signal.aborted || !box.isConnected || previews.has(index)) return;
          translations.set(index, partial); streaming.add(index);
          this.service.worker.render(entry.owner, render);
        }, { before: '', after: '', post: postContext, index, ...(thread ? { thread } : {}) });
        if (!current()) return;
        previews.delete(index); streaming.delete(index); entry.completed.set(index, value); translations.set(index, value); pending.delete(index);
        const key = paragraphKeys[index];
        if (key) {
          if (entry.identity) this.service.cache.set(key, value);
          this.completedParagraphs.delete(key); this.completedParagraphs.set(key, value);
          while (this.completedParagraphs.size > 500) { const oldest = this.completedParagraphs.keys().next().value; if (oldest === undefined) break; this.completedParagraphs.delete(oldest); }
        }
        this.service.worker.render(entry.owner, render);
      } catch (error) {
        if (!current()) return;
        let message = error instanceof Error ? `${error.name}: ${error.message}` : '未知错误';
        if (this.settings.ai.apiKey) message = message.replaceAll(this.settings.ai.apiKey, '[已隐藏]');
        failureReasons.set(index, message.replace(/https?:\/\/\S+/g, '[服务地址]').slice(0, 180));
        streaming.delete(index); if (!previews.has(index)) translations.delete(index); failed.add(index); this.service.worker.render(entry.owner, render);
      } finally {
        running.delete(index);
        if (current() && !running.size) {
          entry.controller = null; entry.state = failed.size ? 'error' : 'done'; this.service.release(entry.owner); this.updateForeground();
          this.service.worker.render(entry.owner, render);
        }
        else if (!running.size && !controller.signal.aborted && entry.controller === controller) {
          // A route/DOM transition can invalidate the result before reconciliation.
          // Do not leave an entry permanently loading after its last request ends.
          this.cancel(entry); this.roots.add(entry.element); this.schedule();
        }
      }
    };
    render();
    for (const plan of plans) void run(plan.index);
    if (!running.size) { entry.controller = null; entry.state = failed.size ? 'error' : 'done'; this.service.release(entry.owner); }
  }

  destroy(): void {
    this.destroyed = true; this.tabTitle.destroy(); this.feed.reset(); this.mutations.disconnect(); this.nearObserver.disconnect(); this.visibleObserver.disconnect();
    document.removeEventListener('click', this.onCommentExpansion, true);
    document.removeEventListener('toggle', this.onCommentExpansion, true);
    document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('popstate', this.onRoute);
    for (const entry of this.entries.values()) { this.cancel(entry); entry.learning?.(); entry.originals.restore(); for (const item of entry.inlineBoxes) item.remove(); entry.box?.remove(); }
    this.entries.clear(); this.detached.clear(); this.longPosts.destroy(); this.completedParagraphs.clear(); this.roots.clear(); this.service.destroy();
  }
}
