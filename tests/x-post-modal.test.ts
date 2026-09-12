// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isXPostBackground, isXPostBackgroundRoute, XPostModal } from '../src/x-post-modal';

const nativeRoute = { displayName: 'NativeRoute' };
const nativePost = { displayName: 'NativePostWithComments' };
const modalType = { defaultProps: { restoreBackgroundFromPreviousPath: true, shouldRenderAsModal: () => true } };
const makePost = (key = 'permalink3', path = '/:screenName([a-zA-Z0-9_]{1,26})/status/:statusId(\\d{1,20})') => ({
  key: `.5:$${key}`, type: nativeRoute as unknown, props: { exact: true, path, component: nativePost } as Record<string, unknown>,
});
let modal: XPostModal;
let route: { pathname: string };
beforeEach(() => { route = { pathname: '/home' }; vi.stubGlobal('location', route); modal = new XPostModal(); });
afterEach(() => { modal.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function host(posts = [makePost()]) {
  document.body.innerHTML = '<main data-testid="primaryColumn"><article data-testid="tweet"><video></video></article></main>';
  const root = document.querySelector('main'); if (!root) throw new Error('Missing root');
  const other = { key: 'analytics', type: modalType, props: { path: '/user/status/:statusId/analytics' } };
  Object.assign(root, { __reactFiber$host: { return: { memoizedProps: { children: [[posts, other]] } } } });
  return { root, posts, other };
}

it('reuses the native modal type and full Post component while preserving original feed nodes', () => {
  const { root, posts, other } = host(); const post = posts[0]; if (!post) throw new Error('Missing route');
  const props = post.props; const video = root.querySelector('video');
  modal.reconcile();
  expect(document.documentElement.hasAttribute('data-ft-x-post-layout')).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(post.type).toBe(modalType); expect(post.props.component).toBe(nativePost);
  expect(post.props).toMatchObject({ exact: true, path: props.path, modalSize: 'full', withBackground: true, disableAnimation: true });
  expect(other.type).toBe(modalType); expect(other.props).toEqual({ path: '/user/status/:statusId/analytics' });
  expect(document.querySelector('main')).toBe(root); expect(root.querySelector('video')).toBe(video);
  const installed = post.props; modal.reconcile(); expect(post.props).toBe(installed);
  modal.destroy(); expect(post.props).toBe(props); expect(post.type).toBe(nativeRoute);
  expect(document.documentElement.hasAttribute('data-ft-x-post-layout')).toBe(false);
});

it('keeps the directly loaded Post as the background and opens other Posts with the native modal', () => {
  route.pathname = '/user/status/123'; const { root, posts } = host();
  const post = posts[0]; const props = post?.props;
  modal.reconcile(); expect(post?.type).toBe(nativeRoute);
  expect(post?.props.path).toBe('/:screenName([a-zA-Z0-9_]{1,26})/status/:statusId(123)');
  expect(posts).toHaveLength(2); expect(posts[1]?.type).toBe(modalType);
  expect(posts[1]?.props).toMatchObject({ path: props?.path, component: nativePost, modalSize: 'full' });
  expect(isXPostBackground(root)).toBe(false);
  route.pathname = '/user/status/456'; modal.reconcile(); expect(isXPostBackground(root)).toBe(true);
  route.pathname = '/user/status/123'; modal.reconcile(); expect(isXPostBackground(root)).toBe(false);
  expect(posts).toHaveLength(2);
  modal.destroy(); expect(posts).toHaveLength(1); expect(post?.props).toBe(props); expect(post?.type).toBe(nativeRoute);
});

it('releases the initial Post exception when navigating to a new background', () => {
  route.pathname = '/user/status/123'; const { posts } = host(); const post = posts[0]; const props = post?.props;
  modal.reconcile(); expect(posts).toHaveLength(2);
  route.pathname = '/home'; host(posts); modal.reconcile();
  expect(posts).toHaveLength(1); expect(post?.type).toBe(modalType); expect(post?.props.path).toBe(props?.path);
  modal.destroy(); expect(post?.type).toBe(nativeRoute); expect(post?.props).toBe(props);
});

it.each([
  ['/i/web/status/123', 'permalink1', '/i/web/status/:statusId(\\d{1,20})'],
  ['/i/thread/123', 'permalink2', '/i/thread/:statusId(\\d{1,20})'],
])('retains named status parameters for direct alias %s', (pathname, key, path) => {
  route.pathname = pathname; const { posts } = host([makePost(key, path)]);
  modal.reconcile(); expect(posts[0]?.type).toBe(nativeRoute);
  expect(posts[0]?.props.path).toBe(path.replace(':statusId(\\d{1,20})', ':statusId(123)'));
  expect(posts[1]?.type).toBe(modalType); expect(posts[1]?.props.path).toBe(path);
});

it('leaves a direct route untouched when its host children cannot accept a modal sibling', () => {
  route.pathname = '/user/status/123'; const posts = [makePost()]; host(posts); Object.freeze(posts);
  expect(() => modal.reconcile()).not.toThrow(); expect(posts[0]?.type).toBe(nativeRoute);
});

it('leaves unknown or frozen host structures on native navigation', () => {
  const frozen = Object.freeze(makePost()); const unknown = makePost('otherPost');
  const { root } = host([frozen, unknown]); modal.reconcile();
  expect(frozen.type).toBe(nativeRoute); expect(unknown.type).toBe(nativeRoute);
  expect(document.documentElement.hasAttribute('data-ft-x-post-layout')).toBe(false);
  Reflect.deleteProperty(root, '__reactFiber$host'); expect(() => modal.reconcile()).not.toThrow();
});

it('covers native permalink aliases but never converts unrelated routes', () => {
  const posts = [makePost('permalink1', '/i/web/status/:statusId(\\d{1,20})'), makePost('permalink2', '/i/thread/:statusId(\\d{1,20})'), makePost('permalink3', '/:screenName/status/:statusId(\\d{1,20})')];
  const unrelated = makePost('permalink3', '/settings'); host([...posts, unrelated]); modal.reconcile();
  expect(posts.every(post => post.type === modalType)).toBe(true); expect(unrelated.type).toBe(nativeRoute);
});

it('marks the inner native scroll dialog, not the zero-height wrapper, and removes the marker on return', () => {
  host(); modal.reconcile(); route.pathname = '/user/status/123';
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<div data-testid="primaryColumn"><button data-testid="app-bar-back"></button></div>';
  const wrapper = document.createElement('div'); wrapper.setAttribute('role', 'dialog'); wrapper.append(dialog); document.body.append(wrapper);
  modal.reconcile(); expect(dialog.hasAttribute('data-ft-x-native-post')).toBe(true);
  expect(wrapper.hasAttribute('data-ft-x-native-post')).toBe(false);
  route.pathname = '/home'; modal.reconcile(); expect(dialog.hasAttribute('data-ft-x-native-post')).toBe(false);
});

it('does not overwrite later host changes on teardown', () => {
  const { posts } = host(); const post = posts[0]; if (!post) throw new Error('Missing route');
  modal.reconcile(); const replacement = { path: '/replacement' }; post.props = replacement;
  modal.destroy(); expect(post.props).toBe(replacement);
});

it('protects the returning background until its ancestor visibility lock is removed', () => {
  const { root } = host(); modal.reconcile();
  const wrapper = document.createElement('div'); root.before(wrapper); wrapper.append(root);
  route.pathname = '/user/status/123'; wrapper.setAttribute('aria-hidden', 'true');
  expect(isXPostBackground(root)).toBe(true); expect(isXPostBackgroundRoute(root)).toBe(false);
  route.pathname = '/home';
  expect(isXPostBackground(root)).toBe(true); expect(isXPostBackgroundRoute(root)).toBe(true);
  wrapper.removeAttribute('aria-hidden');
  expect(isXPostBackground(root)).toBe(false); expect(isXPostBackgroundRoute(root)).toBe(true);
  route.pathname = '/notifications';
  expect(isXPostBackground(root)).toBe(false); expect(isXPostBackgroundRoute(root)).toBe(false);
  route.pathname = '/home'; root.remove();
  expect(isXPostBackground(root)).toBe(false); expect(isXPostBackgroundRoute(root)).toBe(false);
});
