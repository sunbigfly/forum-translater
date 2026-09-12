import { mountFontStyles } from './fonts';
import { loadSettings, saveSettings, loadTranslationOnly, saveTranslationOnly } from './settings';
import { RedditRuntime } from './runtime';
import { TranslationCache, TranslationService } from './translation/service';
import { mountControls } from './ui';
import { XLayout } from './x-layout';
import { XSearch } from './x-search';
import { RedditMediaResize } from './reddit-media-resize';
import { RedditAds } from './reddit-ads';

function boot(): void {
  if (document.querySelector('[data-ft-owned="style"]')) return;
  const style = document.createElement('style'); style.dataset.ftOwned = 'style'; style.textContent = __FT_CSS__; document.head.append(style);
  let settings = loadSettings();
  const fonts = mountFontStyles(settings.fonts);
  const layout = new XLayout(settings, collapsed => { settings = { ...settings, xCollapseSidebar: collapsed }; saveSettings(settings); });
  const search = new XSearch();
  const redditMedia = new RedditMediaResize();
  const redditAds = new RedditAds();
  const cache = new TranslationCache();
  let runtime: RedditRuntime | undefined;
  const restart = (): void => {
    runtime?.destroy(); runtime = undefined;
    if (settings.enabled) runtime = new RedditRuntime(settings, new TranslationService(settings, cache));
  };
  const removeControls = mountControls(() => ({ ...settings, translationOnly: loadTranslationOnly() }), next => {
    const styleOnly = JSON.stringify({ ...settings, fonts: next.fonts, translationTheme: next.translationTheme, xCollapseSidebar: next.xCollapseSidebar, xHideFloatingIcons: next.xHideFloatingIcons, xHideRightSidebar: next.xHideRightSidebar, xHideAds: next.xHideAds }) === JSON.stringify(next);
    settings = next; saveTranslationOnly(next.translationOnly); saveSettings(next);
    layout.update(next); fonts.update(next.fonts);
    if (styleOnly && runtime) runtime.setTranslationTheme(next.translationTheme); else restart();
  }, () => cache.clear(), (baseUrl, apiKey) => {
    const next = { ...settings, ai: { ...settings.ai, baseUrl, apiKey } };
    saveSettings(next); settings = next;
  });
  restart();
  window.addEventListener('pagehide', event => {
    runtime?.destroy(); runtime = undefined; cache.flush();
    search.close(false);
    if (!event.persisted) { search.destroy(); layout.destroy(); redditMedia.destroy(); redditAds.destroy(); removeControls(); fonts.destroy(); style.remove(); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) restart(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
