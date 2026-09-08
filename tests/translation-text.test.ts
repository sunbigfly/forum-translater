// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderBilingualSections, renderTranslationSections, renderTranslationText, translationBlockNeedsTranslation, translationProtectedTokensMatch, translationSectionPlans, translationTextPlan } from "../src/translation/translation-text";

describe("translation text", () => {
  it('renders a safe streaming prefix before remaining link tokens arrive', () => {
    const node = document.createElement('p'); node.innerHTML = 'Please visit <a href="https://example.com">this link</a>.';
    expect(renderTranslationText(node, '请访问 ⟦', true)?.textContent).toBe('请访问 ');
    expect(renderTranslationText(node, '请访问', false)).toBeNull();
    expect(renderTranslationText(node, '请访问 ⟦0⟧', true)?.querySelector('a')?.href).toBe('https://example.com/');
    expect(renderTranslationText(node, '请访问 ⟦4⟧', true)).toBeNull();
  });
  it("protects links, mentions and code and rejects missing tokens", () => {
    const node = document.createElement("div");
    node.innerHTML = "Please ask <a href='https://example.com'>@alice</a> to run <code>npm test</code> before continuing.";
    const plan = translationTextPlan(node);
    expect(plan.text).toContain("⟦0⟧");
    expect(plan.text).toContain("⟦1⟧");
    const translation = "请让 ⟦0⟧ 在继续前运行 ⟦1⟧。";
    expect(translationProtectedTokensMatch(plan.text, translation)).toBe(true);
    const fragment = renderTranslationText(node, translation);
    const output = document.createElement("div");
    if (!fragment) throw new Error("translation fragment was not rendered");
    output.append(fragment);
    expect(output.querySelector("a")?.href).toContain("example.com");
    expect(output.querySelector("code")?.textContent).toBe("npm test");
    expect(renderTranslationText(node, "缺失占位符")).toBeNull();
    expect(translationBlockNeedsTranslation(plan.text)).toBe(true);
  });

  it("allows host translation to opt short human text into the existing translation path", () => {
    expect(translationBlockNeedsTranslation("Delta")).toBe(false);
    expect(translationBlockNeedsTranslation("Delta", true)).toBe(true);
    expect(translationBlockNeedsTranslation("I", true)).toBe(true);
    expect(translationBlockNeedsTranslation("https://example.com", true)).toBe(false);
  });

  it("keeps paragraph structure while rendering section translations", () => {
    const node = document.createElement("div");
    node.innerHTML = "Opening context for the discussion.<p>It refers back to the opening context.</p><ul><li>The first structured point.</li><li>The second structured point.</li></ul>";
    const plans = translationSectionPlans(node);
    expect(plans.map((plan) => plan.path.length)).toEqual([1, 1, 2, 2]);
    const translations = new Map(plans.map((plan) => [plan.index, `译文 ${plan.index}`]));
    const fragment = renderTranslationSections(node, translations);
    const output = document.createElement("div");
    if (!fragment) throw new Error("section translation fragment was not rendered");
    output.append(fragment);
    expect(output.querySelectorAll("p")).toHaveLength(2);
    expect(output.querySelectorAll("li")).toHaveLength(2);
    expect(output.textContent).toContain("译文 3");
  });

  it("interleaves each original section with its matching translation", () => {
    const node = document.createElement("div");
    node.innerHTML = "Opening context.<p>Second paragraph.</p><ul><li>First point.</li><li>Second point.</li></ul>";
    const plans = translationSectionPlans(node);
    const translations = new Map(plans.map((plan) => [plan.index, `译文 ${plan.index}`]));
    const fragment = renderBilingualSections(node, translations);
    const output = document.createElement("div");
    if (!fragment) throw new Error("bilingual section fragment was not rendered");
    output.append(fragment);
    const sections = [...output.querySelectorAll<HTMLElement>(".hnr-bilingual-original-section, .hnr-bilingual-translation-section")];
    expect(sections.map((section) => section.classList.contains("hnr-bilingual-original-section") ? "original" : "translation"))
      .toEqual(["original", "translation", "original", "translation", "original", "translation", "original", "translation"]);
    expect(sections.filter((section) => section.classList.contains("hnr-bilingual-translation-section")).map((section) => section.textContent))
      .toEqual(["译文 0", "译文 1", "译文 2", "译文 3"]);
  });
});

it('skips short simplified/traditional Chinese and ignores URLs and mentions in language detection', () => {
  for (const text of ['好', '谢谢', '謝謝！', '可以的👍', '你好 https://example.com/a-long-english-path @someone']) {
    expect(translationBlockNeedsTranslation(text, true)).toBe(false);
  }
  for (const text of ['Hello', '今日は晴天', '한국어', 'Bonjour']) expect(translationBlockNeedsTranslation(text, true)).toBe(true);
});
