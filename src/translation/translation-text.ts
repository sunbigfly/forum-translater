export const TRANSLATION_PROTECT_SELECTOR = "a,pre,code,kbd,samp,script,style,textarea,button,input,select,img,svg,video,audio,iframe";
const PROTECTED_TEXT_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+|@[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,63}/giu;
const PROTECTED_TOKEN_PATTERN = /⟦(\d+)⟧/g;

export interface TranslationTextPlan {
  readonly text: string;
  readonly protectedNodes: readonly Node[];
}

export interface TranslationSectionPlan {
  readonly index: number;
  readonly path: readonly number[];
  readonly text: string;
}

export interface TranslationSectionVisualState {
  readonly pending: ReadonlySet<number>;
  readonly streaming: ReadonlySet<number>;
  readonly failed: ReadonlySet<number>;
}

export interface TranslationDigestPort {
  digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
}

function protectedClone(node: Node): Node {
  const clone = node.cloneNode(true);
  if (clone.nodeType === Node.ELEMENT_NODE) {
    const root = clone as Element;
    root.removeAttribute("id");
    for (const item of root.querySelectorAll("[id]")) item.removeAttribute("id");
  }
  return clone;
}

export function translationTextPlan(node: Element | null): TranslationTextPlan {
  if (!node) return Object.freeze({ text: "", protectedNodes: Object.freeze([]) });
  const protectedNodes: Node[] = [];
  const protect = (value: Node): string => {
    const index = protectedNodes.length;
    protectedNodes.push(protectedClone(value));
    return `⟦${index}⟧`;
  };
  const visitText = (value: Text): string => {
    const source = value.data ?? "";
    let output = "";
    let offset = 0;
    for (const match of source.matchAll(PROTECTED_TEXT_PATTERN)) {
      const start = match.index ?? 0;
      output += source.slice(offset, start);
      output += protect(value.ownerDocument.createTextNode(match[0]));
      offset = start + match[0].length;
    }
    return output + source.slice(offset);
  };
  const visit = (value: Node): string => {
    if (value.nodeType === Node.TEXT_NODE) return visitText(value as Text);
    if (value.nodeType !== Node.ELEMENT_NODE) return "";
    const element = value as Element;
    if (element.matches(TRANSLATION_PROTECT_SELECTOR)) return protect(element);
    const inner = [...element.childNodes].map(visit).join("");
    return /^(?:br|p|li|blockquote|h[1-6]|tr)$/i.test(element.localName) ? `${inner}\n` : inner;
  };
  const text = [...node.childNodes].map(visit).join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return Object.freeze({ text, protectedNodes: Object.freeze(protectedNodes) });
}

const SECTION_SELECTOR = "p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,td,th,figcaption,section,article,div";
const ROOT_BLOCK_SELECTOR = "p,div,blockquote,ul,ol,pre,table,h1,h2,h3,h4,h5,h6,dl,section,article";

function nodePath(root: Element, node: Element): readonly number[] {
  const path: number[] = [];
  let current: Node = node;
  while (current !== root) {
    const parent = current.parentNode;
    if (!parent) return Object.freeze([]);
    path.unshift([...parent.childNodes].indexOf(current as ChildNode));
    current = parent;
  }
  return Object.freeze(path);
}

function nodeAtPath(root: Element, path: readonly number[]): Element | null {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current.nodeType === Node.ELEMENT_NODE ? current as Element : null;
}

function wrapRootInlineRuns(root: Element): void {
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    if (run.some((node) => (node.textContent ?? "").trim() || node.nodeType === Node.ELEMENT_NODE)) {
      const paragraph = root.ownerDocument.createElement("p");
      root.insertBefore(paragraph, run[0] ?? null);
      paragraph.append(...run);
    }
    run = [];
  };
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).matches(ROOT_BLOCK_SELECTOR)) flush();
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).matches(ROOT_BLOCK_SELECTOR)) continue;
    run.push(child);
  }
  flush();
}

export function translationSectionPlans(node: Element): readonly TranslationSectionPlan[] {
  wrapRootInlineRuns(node);
  const candidates = [...node.querySelectorAll(SECTION_SELECTOR)]
    .filter((element) => !element.querySelector(SECTION_SELECTOR));
  const targets = candidates.length > 0 ? candidates : [node];
  return Object.freeze(targets.map((target, index) => Object.freeze({
    index,
    path: target === node ? Object.freeze([]) : nodePath(node, target),
    text: translationTextPlan(target).text,
  })));
}

function translationLoadingPlaceholder(document: Document): HTMLElement {
  const placeholder = document.createElement("span");
  placeholder.className = "hnr-translation-placeholder";
  placeholder.setAttribute("role", "status");
  placeholder.setAttribute("aria-label", "正在加载译文");
  placeholder.append(
    document.createElement("span"),
    document.createElement("span"),
    document.createElement("span"),
  );
  return placeholder;
}

function translationFailurePlaceholder(document: Document): HTMLElement {
  const failure = document.createElement("span");
  failure.className = "hnr-translation-failure";
  failure.setAttribute("role", "status");
  failure.textContent = "该段译文暂时未返回";
  return failure;
}

function applyTranslationVisualState(
  target: Element,
  index: number,
  visualState?: TranslationSectionVisualState,
): void {
  if (!visualState?.pending.has(index)) return;
  target.classList.add("hnr-translation-section");
  if (visualState.failed.has(index)) target.classList.add("is-failed");
  else if (visualState.streaming.has(index)) target.classList.add("is-streaming");
  else target.classList.add("is-loading");
}

export function renderTranslationSections(
  node: Element,
  translations: ReadonlyMap<number, string>,
  visualState?: TranslationSectionVisualState,
): DocumentFragment | null {
  const plans = translationSectionPlans(node);
  const clone = node.cloneNode(true) as Element;
  for (const plan of plans) {
    const translation = translations.get(plan.index);
    if (translation === undefined && !visualState?.pending.has(plan.index)) continue;
    const index = plan.index;
    const source = plan.path.length === 0 ? node : nodeAtPath(node, plan.path);
    const target = plan.path.length === 0 ? clone : nodeAtPath(clone, plan.path);
    if (!source || !target) return null;
    if (translation === undefined) target.replaceChildren(
      visualState?.failed.has(index)
        ? translationFailurePlaceholder(node.ownerDocument)
        : translationLoadingPlaceholder(node.ownerDocument),
    );
    else {
      const fragment = renderTranslationText(source, translation, visualState?.streaming?.has(index));
      if (!fragment) return null;
      target.replaceChildren(fragment);
    }
    applyTranslationVisualState(target, index, visualState);
  }
  const output = node.ownerDocument.createDocumentFragment();
  output.append(...clone.childNodes);
  return output;
}

export function renderBilingualSections(
  node: Element,
  translations: ReadonlyMap<number, string>,
  visualState?: TranslationSectionVisualState,
): DocumentFragment | null {
  const plans = translationSectionPlans(node);
  const clone = node.cloneNode(true) as Element;
  const output = node.ownerDocument.createDocumentFragment();
  if (plans.length === 1 && plans[0]?.path.length === 0) {
    const translation = translations.get(0);
    if (translation === undefined && !visualState?.pending.has(0)) {
      output.append(...clone.childNodes);
      return output;
    }
    const originalSection = node.ownerDocument.createElement("div");
    originalSection.className = "hnr-bilingual-original-section";
    originalSection.append(...clone.childNodes);
    const translatedSection = node.ownerDocument.createElement("div");
    translatedSection.className = "hnr-bilingual-translation-section";
    if (translation === undefined) translatedSection.append(
      visualState?.failed.has(0)
        ? translationFailurePlaceholder(node.ownerDocument)
        : translationLoadingPlaceholder(node.ownerDocument),
    );
    else {
      const translated = renderTranslationText(node, translation);
      if (!translated) return null;
      translatedSection.append(translated);
    }
    applyTranslationVisualState(translatedSection, 0, visualState);
    output.append(originalSection, translatedSection);
    return output;
  }
  const jobs: ({ readonly index: number; readonly target: Element; readonly translated: Node } | null | undefined)[] = plans.map((plan) => {
    const translation = translations.get(plan.index);
    if (translation === undefined && !visualState?.pending.has(plan.index)) return undefined;
    const source = nodeAtPath(node, plan.path);
    const target = nodeAtPath(clone, plan.path);
    if (!source || !target) return null;
    if (translation === undefined) return {
      index: plan.index,
      target,
      translated: visualState?.failed.has(plan.index)
        ? translationFailurePlaceholder(node.ownerDocument)
        : translationLoadingPlaceholder(node.ownerDocument),
    };
    const translated = renderTranslationText(source, translation);
    return translated ? { index: plan.index, target, translated } : null;
  });
  if (jobs.some((job) => job === null)) return null;
  for (const job of jobs) {
    if (job === undefined) continue;
    if (!job) return null;
    job.target.classList.add("hnr-bilingual-original-section");
    const translatedSection = job.target.cloneNode(false) as Element;
    translatedSection.removeAttribute("id");
    translatedSection.classList.remove("hnr-bilingual-original-section");
    translatedSection.classList.add("hnr-bilingual-translation-section");
    translatedSection.append(job.translated);
    applyTranslationVisualState(translatedSection, job.index, visualState);
    job.target.after(translatedSection);
  }
  output.append(...clone.childNodes);
  return output;
}

export function translationProtectedTokensMatch(source: string, translation: string): boolean {
  const tokens = (value: string): readonly string[] => Object.freeze(
    [...value.matchAll(PROTECTED_TOKEN_PATTERN)].map((match) => match[0]).sort(),
  );
  const expected = tokens(source);
  const actual = tokens(translation);
  return expected.length === actual.length && expected.every((token, index) => token === actual[index]);
}

export function renderTranslationText(node: Element, translation: string, partial = false): DocumentFragment | null {
  const plan = translationTextPlan(node);
  if (partial) translation = translation.replace(/⟦[^⟧]*$/, '');
  if (!partial && !translationProtectedTokensMatch(plan.text, translation)) return null;
  const counts = Array.from({ length: plan.protectedNodes.length }, () => 0);
  for (const match of translation.matchAll(PROTECTED_TOKEN_PATTERN)) {
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= counts.length) return null;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  if (counts.some((count) => partial ? count > 1 : count !== 1)) return null;
  const fragment = node.ownerDocument.createDocumentFragment();
  let offset = 0;
  for (const match of translation.matchAll(PROTECTED_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > offset) fragment.append(node.ownerDocument.createTextNode(translation.slice(offset, start)));
    fragment.append(plan.protectedNodes[Number(match[1])]?.cloneNode(true) ?? "");
    offset = start + match[0].length;
  }
  if (offset < translation.length) fragment.append(node.ownerDocument.createTextNode(translation.slice(offset)));
  return fragment;
}

export function translationTextIsChinese(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const han = text.match(/\p{Script=Han}/gu) ?? [];
  const kanaOrHangul = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
  return han.length >= 1 && kanaOrHangul.length === 0 && han.length / Math.max(1, letters.length) >= 0.45;
}

export function translationBlockNeedsTranslation(
  textValue: string,
  translateShortText = false,
): boolean {
  const text = textValue.replace(PROTECTED_TEXT_PATTERN, "").replace(/⟦\d+⟧/g, "").trim();
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < (translateShortText ? 1 : 2) || translationTextIsChinese(text)) return false;
  if (/^(?:RFC|ISO|IEC|IEEE|ECMA|W3C|WHATWG)\s*[-#:./]?\s*\d[\w./-]*$/i.test(text)) return false;
  if (/^(?:https?:\/\/|www\.|[@#])\S+$/i.test(text)) return false;
  if (translateShortText) return true;
  const words = text.match(/\p{L}+(?:['’.-]\p{L}+)*/gu) ?? [];
  return words.length >= 3 || text.length >= 24 || /[.!?。！？][”"'’)]?$/.test(text);
}

export async function translationTextFingerprint(texts: readonly string[], digest: TranslationDigestPort): Promise<string> {
  if (texts.length === 0) throw new Error("翻译指纹文本不能为空");
  const bytes = new TextEncoder().encode(JSON.stringify(texts.map(String)));
  const result = await digest.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (hex.length !== 64) throw new Error("翻译 SHA-256 指纹长度非法");
  return `sha256:${hex}`;
}
