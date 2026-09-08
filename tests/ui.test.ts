// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountControls } from '../src/ui';
import { DEFAULTS } from '../src/settings';
let destroy: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } }); vi.stubGlobal('GM_registerMenuCommand', vi.fn(() => 1)); vi.stubGlobal('GM_unregisterMenuCommand', vi.fn()); });
afterEach(() => { destroy?.(); destroy = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
describe('standalone translation controls', () => {
  it('saves independent categories, preload and provider without an image API configuration', () => {
    const save = vi.fn(); destroy = mountControls(() => ({ ...DEFAULTS }), save, vi.fn());
    const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
    expect(document.querySelector<HTMLElement>('[data-ft-owned="controls"]')?.hidden).toBe(true);
    expect(shadow?.querySelector('button')).toBeNull();
    vi.mocked(GM_registerMenuCommand).mock.calls[0]?.[1]();
    const enabled = shadow?.querySelector<HTMLInputElement>('[name="enabled"]');
    const after = shadow?.querySelector<HTMLInputElement>('[name="after"]');
    const provider = shadow?.querySelector<HTMLSelectElement>('[name="provider"]');
    if (!enabled || !after || !provider) throw new Error('Missing standalone controls');
    enabled.checked = false; after.value = '800'; provider.value = 'microsoft';
    shadow?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULTS, enabled: false, after: 800, provider: 'microsoft' });
    expect(shadow?.querySelector('[name="key"],[name="endpoint"]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-ft-owned="controls"]')?.hidden).toBe(true);
  });
  it('opens AI settings only from the menu and keeps invalid configuration open', () => {
    const save = vi.fn(); destroy = mountControls(() => ({ ...DEFAULTS }), save, vi.fn());
    vi.mocked(GM_registerMenuCommand).mock.calls[0]?.[1]();
    const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
    const provider = shadow?.querySelector<HTMLSelectElement>('[name="provider"]');
    if (!provider) throw new Error('Missing provider');
    provider.value = 'ai'; provider.dispatchEvent(new Event('change'));
    expect(shadow?.querySelector('fieldset')?.hidden).toBe(false);
    shadow?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).not.toHaveBeenCalled();
    for (const [name, value] of [['baseUrl', 'https://example.com/v1'], ['apiKey', 'test-only-key'], ['model', 'test-model']] as const) {
      const field = shadow?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (field) {
        if (field instanceof HTMLSelectElement) { const option = document.createElement('option'); option.value = value; option.textContent = value; field.append(option); }
        field.value = value;
      }
    }
    shadow?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULTS, provider: 'ai', ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only-key', model: 'test-model' } });
    expect(shadow?.querySelector('[name="apiKey"]')).toBeNull();
  });
  it('fetches models when AI settings open and cancels on close', async () => {
    const abort = vi.fn(); let options: GmRequestOptions | undefined;
    vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort }; });
    destroy = mountControls(() => ({ ...DEFAULTS, provider: 'ai', ai: { ...DEFAULTS.ai, baseUrl: 'https://example.com/v1', apiKey: 'test-only', model: 'saved' } }), vi.fn(), vi.fn());
    vi.mocked(GM_registerMenuCommand).mock.calls[0]?.[1]();
    const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
    expect(shadow?.querySelector('[name=model]')?.tagName).toBe('SELECT');
    expect(shadow?.querySelector('#ft-model-status')?.textContent).toContain('正在获取');
    expect(options?.url).toBe('https://example.com/v1/models');
    expect(options?.headers?.Authorization).toBe('Bearer test-only');
    options?.onload?.({ status: 200, responseText: '{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"}]}' });
    await Promise.resolve(); await Promise.resolve();
    expect([...shadow?.querySelectorAll('[name=model] option') ?? []].map(option => (option as HTMLOptionElement).value)).toEqual(['', 'saved', 'model-a', 'model-b']);
    expect(shadow?.querySelector<HTMLInputElement>('[name=model]')?.value).toBe('saved');
    const refresh = [...shadow?.querySelectorAll('button') ?? []].find(button => button.textContent === '刷新模型列表'); refresh?.click();
    shadow?.querySelector<HTMLButtonElement>('header button')?.click();
    expect(abort).toHaveBeenCalledOnce();
    expect(shadow?.querySelector('dialog')?.open).toBe(false);
  });
  it('autosaves entered credentials and fetches models without applying translation settings', async () => {
    vi.useFakeTimers(); const save = vi.fn(); const credentials = vi.fn();
    let options: GmRequestOptions | undefined;
    vi.stubGlobal('GM_xmlhttpRequest', (value: GmRequestOptions) => { options = value; return { abort: vi.fn() }; });
    destroy = mountControls(() => ({ ...DEFAULTS, provider: 'ai' }), save, vi.fn(), credentials);
    vi.mocked(GM_registerMenuCommand).mock.calls[0]?.[1]();
    const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
    for (const [name, value] of [['baseUrl', 'http://127.0.0.1:8317/v1'], ['apiKey', 'test-only']] as const) {
      const field = shadow?.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (!field) throw new Error('Missing credential field');
      field.value = value; field.dispatchEvent(new Event('input')); field.dispatchEvent(new Event('change'));
    }
    expect(credentials).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(credentials).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8317/v1', 'test-only');
    expect(options?.url).toBe('http://127.0.0.1:8317/v1/models');
    expect(save).not.toHaveBeenCalled();
    options?.onload?.({ status: 200, responseText: '{"data":[{"id":"test-model"}]}' });
    await Promise.resolve(); await Promise.resolve();
    const model = shadow?.querySelector<HTMLSelectElement>('[name=model]');
    expect(model?.options[1]?.textContent).toBe('test-model');
    expect(shadow?.querySelector('#ft-model-status')?.textContent).toContain('已获取 1');
  });
  it('switches categories without losing unsaved fields and closes on Escape', () => {
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    vi.mocked(GM_registerMenuCommand).mock.calls[0]?.[1]();
    const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>('#ft-tab-scope')?.click();
    expect(shadow?.querySelector<HTMLElement>('#ft-panel-api')?.hidden).toBe(true);
    expect(shadow?.querySelector<HTMLElement>('#ft-panel-scope')?.hidden).toBe(false);
    shadow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shadow?.querySelector('dialog')?.open).toBe(false);
  });
  it('unregisters its own menu and UI on shutdown', () => {
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn()); destroy(); destroy = undefined;
    expect(GM_unregisterMenuCommand).toHaveBeenCalledWith(1);
    expect(document.querySelector('[data-ft-owned="controls"]')).toBeNull();
  });
});
