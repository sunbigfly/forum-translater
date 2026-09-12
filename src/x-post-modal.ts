type Data = Record<string, unknown>;
const data = (value: unknown): Data | undefined => value !== null && (typeof value === 'object' || typeof value === 'function') ? value as Data : undefined;
export const isXPostPath = (path: string): boolean => /^\/(?:[^/]+\/status|i\/web\/status|i\/thread)\/\d+\/?$/.test(path);
const isPost = (): boolean => isXPostPath(location.pathname ?? '');
const marker = 'data-ft-x-native-post';
const backgroundMarker = 'data-ft-x-post-background';
export function isXPostBackground(element: HTMLElement): boolean {
  const background = element.closest(`[${backgroundMarker}]`);
  // X may restore the URL before releasing the background's visibility lock.
  return element.isConnected && !!background && (isPost() && background.getAttribute(backgroundMarker) !== location.pathname
    || !!background.closest('[aria-hidden="true"]'));
}
export function isXPostBackgroundRoute(element: HTMLElement): boolean {
  // A request can finish before the runtime observes the return navigation.
  return element.isConnected && element.closest(`[${backgroundMarker}]`)?.getAttribute(backgroundMarker) === location.pathname;
}
interface Patch {
  route: Data; type: unknown; props: unknown; installedType: unknown; installed: Data;
  extra?: { parent: unknown[]; route: Data; modalProps: Data };
}

function containingArray(items: unknown[], route: Data, depth = 0): unknown[] | undefined {
  if (items.includes(route)) return items;
  if (depth >= 8) return;
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const found = containingArray(item as unknown[], route, depth + 1);
    if (found) return found;
  }
}

/** Use X's own ModalRoute and Post component so its router keeps the background mounted. */
export class XPostModal {
  private patches: Patch[] = [];
  private root: HTMLElement | undefined;
  private surface: HTMLElement | undefined;

  reconcile(): void {
    const root = [...document.querySelectorAll<HTMLElement>('[data-testid="primaryColumn"]')].find(node => !node.closest('[role="dialog"]'));
    if (root && root !== this.root) {
      // Once the background changes, the initial Post can open as a modal too.
      for (const patch of this.patches) {
        const extra = patch.extra;
        if (!extra || patch.route.type !== patch.installedType || patch.route.props !== patch.installed) continue;
        patch.route.type = extra.route.type; patch.installedType = extra.route.type;
        patch.route.props = extra.modalProps; patch.installed = extra.modalProps;
        const index = extra.parent.indexOf(extra.route); if (index >= 0) extra.parent.splice(index, 1);
        delete patch.extra;
      }
      this.install(root);
    }
    // X has an outer zero-height dialog wrapper and an inner viewport-sized dialog.
    // Only the nearest dialog owns scrolling; styling the outer wrapper clips the thread.
    const surface = isPost() && this.patches.length ? [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-testid="primaryColumn"]')]
      .find(node => node.querySelector('[data-testid="app-bar-back"]'))?.closest<HTMLElement>('[role="dialog"]') ?? undefined : undefined;
    if (surface !== this.surface) {
      this.surface?.removeAttribute(marker); this.surface = surface;
      surface?.setAttribute(marker, '');
    }
  }

  private install(root: HTMLElement): void {
    const property = Object.keys(root).find(name => name.startsWith('__reactFiber$'));
    let fiber = data(property ? Reflect.get(root, property) as unknown : undefined);
    for (let depth = 0; fiber && depth < 100; depth++, fiber = data(fiber.return)) {
      const children = data(fiber.memoizedProps)?.children;
      if (!Array.isArray(children)) continue;
      const routes = (children as unknown[]).flat(8).map(data).filter((route): route is Data => !!route);
      // Discover the native type from sibling routes; never depend on webpack IDs or minified names.
      const modalType = routes.find(route => {
        const defaults = data(data(route.type)?.defaultProps);
        return defaults?.restoreBackgroundFromPreviousPath === true && typeof defaults.shouldRenderAsModal === 'function';
      })?.type;
      if (!modalType) continue;
      const posts = routes.filter(route => {
        const props = data(route.props);
        return typeof route.key === 'string' && /permalink[123]$/.test(route.key) && props?.exact === true
          && typeof props.path === 'string' && /\/(?:status|thread)\/:statusId/.test(props.path) && !!props.component;
      });
      if (!posts.length) continue;
      for (const route of posts) {
        if (this.patches.some(patch => patch.route === route) || route.type === modalType) continue;
        // Production React elements are writable. If X freezes/changes them, preserve normal navigation.
        if (!Object.getOwnPropertyDescriptor(route, 'type')?.writable || !Object.getOwnPropertyDescriptor(route, 'props')?.writable) continue;
        const props = data(route.props);
        const installed = { ...props, modalSize: 'full', withBackground: true, disableAnimation: true, shouldAlwaysDisplayModal: () => true };
        const patch: Patch = { route, type: route.type, props: route.props, installedType: modalType, installed };
        const path = String(props?.path);
        const alias = path.startsWith('/i/web/status/') ? '/i/web/status/' : path.startsWith('/i/thread/') ? '/i/thread/' : undefined;
        const initialPost = !this.root && isPost() && (alias ? location.pathname.startsWith(alias) : !/^\/i\/(web\/status|thread)\//.test(location.pathname));
        if (initialPost) {
          const parent = containingArray(children as unknown[], route);
          if (!parent || Object.isFrozen(parent) || Object.isSealed(parent)) continue;
          const id = /\/(\d+)\/?$/.exec(location.pathname)?.[1];
          if (!id) continue;
          // Keep the original route type/key and named params for the live background.
          // A sibling handles other Posts; replacing the current type would unmount it.
          const extra = { ...route, key: `${String(route.key)}:ft-modal`, type: modalType, props: installed };
          patch.installedType = route.type;
          patch.installed = { ...props, path: path.replace(/:statusId(?:\([^)]*\))?/, `:statusId(${id})`) };
          patch.extra = { parent, route: extra, modalProps: installed };
          parent.splice(parent.indexOf(route) + 1, 0, extra);
        }
        route.type = patch.installedType; route.props = patch.installed; this.patches.push(patch);
      }
      if (this.patches.length) {
        // Prepare modal geometry before navigation, including X's loading skeleton.
        document.documentElement.setAttribute('data-ft-x-post-layout', '');
        this.root?.removeAttribute(backgroundMarker); this.root = root; root.setAttribute(backgroundMarker, location.pathname);
      }
      return;
    }
  }

  destroy(): void {
    document.documentElement.removeAttribute('data-ft-x-post-layout');
    this.surface?.removeAttribute(marker); this.surface = undefined; this.root?.removeAttribute(backgroundMarker); this.root = undefined;
    for (const patch of this.patches) {
      if (patch.extra) {
        const index = patch.extra.parent.indexOf(patch.extra.route);
        if (index >= 0) patch.extra.parent.splice(index, 1);
      }
      if (patch.route.type === patch.installedType && patch.route.props === patch.installed) {
        patch.route.type = patch.type; patch.route.props = patch.props;
      }
    }
    this.patches = [];
  }
}
