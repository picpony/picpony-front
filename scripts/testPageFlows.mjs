/** Deterministic page-flow regressions. No server, browser, credentials or network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load(file, dependencies = {}, globals = {}, expose = '') {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code + (expose ? `\nexports.testComponent = ${expose};` : ''), {
    exports, require: (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'next/dynamic') return { default: () => 'DynamicComponent' };
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : `${name}:${String(key)}` });
    }, URLSearchParams, URL, setTimeout, clearTimeout, queueMicrotask, console, performance, ...globals,
  }, { filename: file });
  return exports;
}

/** A hook runner exercises the actual page handlers against controlled async answers. */
function harness() {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  let pendingEffects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useId: () => 'test-id',
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        slots[index] = deps;
        pendingEffects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props) => ({ type, props });
  return {
    dependencies: { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' } },
    render: (component) => { cursor = 0; return component(); },
    effects: async () => { const pending = pendingEffects; pendingEffects = []; pending.forEach((effect) => effect()); await flush(); },
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const item of tree) { const result = find(item, predicate); if (result) return result; }
    return undefined;
  }
  if (predicate(tree)) return tree;
  for (const value of Object.values(tree.props ?? {})) {
    const result = find(value, predicate);
    if (result) return result;
  }
}
const byType = (tree, name) => find(tree, (node) => node.type === name);

const searchState = load('lib/searchState.ts');
for (const value of [null, '', '0', '-1', '3tail', '2.5', 'Infinity', '9007199254740992']) {
  assert.equal(searchState.searchPage(value), 1);
}
assert.equal(searchState.searchPage('42'), 42);
for (const sort of ['hotness', 'width', 'height', 'size', 'random', 'updated_at']) assert.equal(searchState.searchSort(sort), sort);
assert.equal(searchState.searchSort('score&filter_id=0'), 'created_at');
const encoded = new URL(searchState.searchHref('小马, safe & pony', 'random', 'asc', 3), 'https://example.test');
assert.equal(encoded.searchParams.get('q'), '小马, safe & pony');
assert.equal(encoded.searchParams.get('sort'), 'random');
assert.equal(encoded.searchParams.get('page'), '3');

const { queueSettingsUpdate } = load('lib/settingsUpdates.ts');
const first = deferred();
const order = [];
const one = queueSettingsUpdate('A', async () => { order.push('A:on'); await first.promise; });
const two = queueSettingsUpdate('A', async () => { order.push('A:off'); });
await queueSettingsUpdate('B', async () => { order.push('B:independent'); });
assert.deepEqual(order, ['A:on', 'B:independent']);
first.resolve();
await Promise.all([one, two]);
assert.deepEqual(order, ['A:on', 'B:independent', 'A:off']);
await assert.rejects(queueSettingsUpdate('A', async () => { throw new Error('offline'); }));
await queueSettingsUpdate('A', async () => { order.push('A:recovered'); });
assert.equal(order.at(-1), 'A:recovered', 'one failed save cannot poison later saves');

let url = new URL('https://example.test/search?q=pony&sort=random&dir=asc&page=2');
let account = 'A';
const historyWrites = [];
const windowListeners = new Map();
const windowMock = {
  addEventListener: (name, listener) => {
    if (!windowListeners.has(name)) windowListeners.set(name, new Set());
    windowListeners.get(name).add(listener);
  },
  removeEventListener: (name, listener) => windowListeners.get(name)?.delete(listener),
  dispatchEvent: (event) => { for (const listener of windowListeners.get(event.type) ?? []) listener(event); },
  get location() { return url; },
  history: {
    pushState: (_, __, href) => { historyWrites.push(['push', href]); url = new URL(href, url); },
    replaceState: (_, __, href) => { historyWrites.push(['replace', href]); url = new URL(href, url); },
  },
};
const searchHooks = harness();
const dictionaryReads = [];
let resourceArgs;
let storageReads = 0;
let browsingFp = 'safe:one';
const { testComponent: Search } = load('app/search/page.tsx', {
  ...searchHooks.dependencies,
  '@/lib/searchState': searchState,
  '@/lib/constants': { LS_KEYS: { searchSort: 'searchSort' } },
  '@/lib/hooks': { useSession: () => ({ token: account }), readToken: () => account, useEscapeBack: () => {} },
  '@/components/BackgroundLocation': { useBackgroundSearchParams: () => url.searchParams },
  'next/navigation': { useRouter: () => ({ push: (href) => { url = new URL(href, url); } }) },
  '@/lib/resource': { SKIP: 'SKIP', useResource: (_, args) => { resourceArgs = args; return { data: { images: [{ id: 1 }] }, refresh: () => {} }; } },
  '@/lib/resources': { searchFeed: { prefetch: () => {} }, browsingFingerprint: () => browsingFp, syncBrowsingCookie: () => {} },
  '@/lib/api': { api: { getDictionary: async (_, query) => {
    if (query.limit !== 10) return { success: true, tags: [] };
    const result = deferred(); dictionaryReads.push(result); return result.promise;
  } } },
  '@/lib/tagCategories': { tagCategoryDot: () => '' },
}, { window: windowMock, localStorage: { getItem: () => { storageReads++; throw new Error('Storage denied'); } } }, 'SearchPageContent');
let tree = searchHooks.render(Search);
assert.equal(storageReads, 0, 'SSR/hydration render does not read device-only storage');
await searchHooks.effects();
tree = searchHooks.render(Search);
assert.equal(resourceArgs.sortField, 'random', 'random reaches the request explicitly');
assert.equal(resourceArgs.page, 2);
assert.equal(resourceArgs.sortDir, 'asc');
const input = () => byType(searchHooks.render(Search), '@/components/Input:Input');
input().props.onChange({ target: { value: 'twilight', selectionStart: 8 } });
input().props.onChange({ target: { value: '', selectionStart: 0 } });
await new Promise((resolve) => setTimeout(resolve, 330));
assert.equal(dictionaryReads.length, 0, 'clearing before debounce cancels the request');
input().props.onChange({ target: { value: 'pony', selectionStart: 4 } });
await new Promise((resolve) => setTimeout(resolve, 330));
input().props.onChange({ target: { value: '', selectionStart: 0 } });
dictionaryReads[0].resolve({ success: true, tags: [{ id: 1, en: 'pony', cn: '小马', cat: '' }] });
await flush();
assert.equal(byType(searchHooks.render(Search), '@/components/Popover:default').props.open, false, 'late results cannot reopen a cleared combobox');
url = new URL('https://example.test/search?q=fluttershy&sort=width&dir=desc&page=4');
searchHooks.render(Search);
assert.equal(resourceArgs.query, 'fluttershy');
assert.equal(resourceArgs.sortField, 'width');
assert.equal(resourceArgs.page, 4, 'Back/Forward reads the current URL, not mount-time state');
await searchHooks.effects();
browsingFp = 'safe:two';
windowMock.dispatchEvent({ type: 'settings_updated' });
tree = searchHooks.render(Search);
assert.equal(resourceArgs.page, 1, 'changed browsing rules reset an open search to its first page');
url = new URL('https://example.test/pic/123');
browsingFp = 'safe:three';
windowMock.dispatchEvent({ type: 'settings_updated' });
assert.equal(url.pathname, '/pic/123', 'background updates do not overwrite an image overlay route');
url = new URL('https://example.test/search?q=fluttershy&sort=width&dir=desc');
tree = searchHooks.render(Search);
assert.equal(find(tree, (node) => node.props?.inert === true && String(node.props?.className ?? '').includes('grid'))?.props.inert, true, 'collapsed advanced controls are inert');
searchHooks.dispose();

const homeHooks = harness();
const homeArgs = [];
let savedHomePage = 3;
const homeSetPage = (page) => { savedHomePage = page; };
const { testComponent: HomeImages } = load('app/HomeContent.tsx', {
  ...homeHooks.dependencies,
  '@/lib/api': { getBrowsingSettings: () => ({ homeSort: 'created_at' }) },
  '@/lib/hooks': { useDeferredLoading: () => false },
  '@/lib/screenState': { useScreenState: () => [savedHomePage, homeSetPage] },
  '@/lib/resources': { homeFeed: {}, browsingFingerprint: () => browsingFp, syncBrowsingCookie: () => {} },
  '@/lib/resource': { SKIP: 'SKIP', useResource: (_, args) => {
    homeArgs.push(args);
    return { data: args === 'SKIP' ? undefined : { images: [{ id: 1 }] }, refresh: () => {}, isLoading: false };
  } },
}, { window: windowMock }, 'ImageList');
const renderHome = () => HomeImages({ seed: null });
homeHooks.render(renderHome);
assert.equal(homeArgs.at(-1), 'SKIP', 'missing SSR seed must wait for the device fingerprint');
await homeHooks.effects();
homeHooks.render(renderHome);
assert.equal(homeArgs.filter((args) => args !== 'SKIP').length, 1, 'cold no-seed initialization requests exactly one resolved fingerprint');
assert.equal(homeArgs.at(-1).page, 3, 'initial preferences preserve the remembered page');
browsingFp = 'safe:four';
windowMock.dispatchEvent({ type: 'settings_updated' });
homeHooks.render(renderHome);
assert.equal(homeArgs.at(-1).fp, 'safe:four');
assert.equal(homeArgs.at(-1).page, 1, 'a live filter change resets the home page');
homeHooks.dispose();

url = new URL('https://example.test/admin');
const adminHooks = harness();
const { testComponent: Admin } = load('app/admin/page.tsx', {
  ...adminHooks.dependencies,
  '@/components/BackgroundLocation': { useBackgroundSearchParams: () => url.searchParams },
  '@/lib/hooks': { useSession: () => ({ token: account, user: { role: 'super_admin' }, ready: true }) },
  '@/lib/appearance': { MOTION_SPEED_SCALE: { slow: 1.4 } },
  '@/components/TabPanes': { tabId: (id) => id, tabPanelId: (id) => `${id}-panel` },
}, { window: windowMock, performance: { now: () => 10 } }, 'AdminPanel');
byType(adminHooks.render(Admin), '@/components/Tabs:default').props.onChange('users');
assert.equal(historyWrites.at(-1)[0], 'push', 'the first tab change is undoable even immediately after boot');
assert.equal(url.searchParams.get('tab'), 'users', 'the address changes in the event handler');
url = new URL('https://example.test/search');
await new Promise((resolve) => setTimeout(resolve, 600));
assert.equal(url.pathname, '/search', 'no delayed tab navigation can overwrite a later route');

const createHooks = harness();
let creates = 0;
let uploadReply = deferred();
const notices = [];
const { default: CreatePost } = load('app/forum/create/page.tsx', {
  ...createHooks.dependencies,
  'next/navigation': { useRouter: () => ({ push: (href) => notices.push(href) }) },
  '@/lib/hooks': { useSession: () => ({ token: 'A', ready: true }), readToken: () => account, readUserInfo: () => ({ token: account }) },
  '@/components/AuthModal': { useAuthModal: () => ({ openAuth: () => {} }) },
  '@/components/Button': { default: 'Button', buttonClasses: () => '' },
  '@/components/Toast': { showToast: (text) => notices.push(text) },
  '@/lib/utils': { processImageFile: async () => 'data:image/png;base64,fixture' },
  '@/lib/api': { api: {
    uploadForumImage: async () => uploadReply.promise,
    createForumPost: async () => { creates++; return { json: async () => ({ success: true, post_id: 123 }) }; },
  } },
});
tree = createHooks.render(CreatePost);
await createHooks.effects();
byType(tree, '@/components/Input:Input').props.onChange({ target: { value: 'Fixture post' } });
byType(tree, 'DynamicComponent').props.onChange('Fixture content');
await byType(tree, '@/components/DropZone:default').props.onFile({ name: 'cover.png' });
tree = createHooks.render(CreatePost);
const submit = byType(tree, 'form').props.onSubmit;
const submitting = submit({ preventDefault() {} });
await submit({ preventDefault() {} });
uploadReply.resolve({ ok: false, json: async () => ({ success: false, error: 'cover rejected' }) });
await submitting;
assert.equal(creates, 0, 'a failed cover must not publish an incomplete post');
assert.ok(notices.includes('发帖失败，请稍后重试'));
tree = createHooks.render(CreatePost);
byType(tree, '@/components/IconButton:default').props.onClick();
tree = createHooks.render(CreatePost);
await byType(tree, 'form').props.onSubmit({ preventDefault() {} });
assert.equal(creates, 1, 'the preserved draft can be retried after removing the failed cover');
assert.ok(notices.includes('/forum/123'));
createHooks.dispose();

// Exercise the glossary loops themselves, including cancellation between an
// existence read and its following write, and the Stop control during a write.
const adminSuccess = load('lib/adminMutations.ts');
function glossaryFixture(options = {}) {
  const hooks = harness();
  const toasts = [];
  const confirms = [];
  let saves = 0;
  let dictionaryReads = 0;
  const glossaryModule = load('components/admin/GlossaryTab.tsx', {
    ...hooks.dependencies,
    '@/lib/adminMutations': adminSuccess,
    '@/lib/hooks': { useSession: () => ({ user: { role: 'super_admin' }, token: 'A', ready: true }), readToken: () => account },
    '@/lib/constants': { LS_KEYS: { itemsPerPage: 'items' } },
    '@/lib/utils': { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
    '@/lib/tagCategories': { tagCategoryChip: () => '', tagCategoryDot: () => '' },
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirmThen: (_, __, action) => confirms.push(action) }), usePrompt: () => ({ prompt: async () => null }) },
    '@/components/Toast': { showToast: (message, tone) => toasts.push({ message, tone }) },
    '@/lib/api/admin': {
      checkTagExists: options.exists ?? (async () => false),
      getTagFeedback: async () => ({ success: true, feedbacks: [] }),
    },
    '@/lib/api/picpony': {
      getDictionary: async () => { dictionaryReads++; return { success: true, tags: [], total_matches: 0 }; },
      saveDictionaryTag: async () => { saves++; return options.save ? options.save() : { ok: false, status: 403, json: async () => ({ success: false, error: 'denied' }) }; },
    },
    '@/lib/api/derpi': {
      getDerpiPopularTags: async () => ({ tags: [{ name: 'pony' }, { name: 'safe' }] }),
    },
    '@/lib/resources': { dictionaryTag: { invalidate() {} } },
  }, { localStorage: { getItem: () => null }, window: {}, setTimeout: (fn) => setTimeout(fn, 0) });
  return { hooks, toasts, confirms, component: glossaryModule.default, saves: () => saves, reads: () => dictionaryReads };
}
const glossary = glossaryFixture();
glossary.hooks.render(glossary.component);
await glossary.hooks.effects();
tree = glossary.hooks.render(glossary.component);
await glossary.hooks.effects();
tree = glossary.hooks.render(glossary.component);
const fieldWithLabel = (label) => find(tree, (node) => node.type === '@/components/Input:Input' && node.props.label === label);
fieldWithLabel('起始页').props.onChange({ target: { value: '-2' } });
tree = glossary.hooks.render(glossary.component);
const syncButton = () => find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === '开始同步');
await syncButton().props.onClick();
assert.equal(glossary.saves(), 0);
assert.match(glossary.toasts.at(-1).message, /正整数/);
fieldWithLabel('起始页').props.onChange({ target: { value: '1' } });
fieldWithLabel('结束页').props.onChange({ target: { value: '1' } });
tree = glossary.hooks.render(glossary.component);
await syncButton().props.onClick();
assert.equal(glossary.saves(), 2);
assert.match(glossary.toasts.at(-1).message, /0 新增.*2 标签失败/);
assert.equal(glossary.toasts.at(-1).tone, 'warning', 'rejected tags never count as successful imports');
glossary.hooks.dispose();

const existingReply = deferred();
const cancelledImport = glossaryFixture({ exists: () => existingReply.promise });
cancelledImport.hooks.render(cancelledImport.component);
await cancelledImport.hooks.effects();
tree = cancelledImport.hooks.render(cancelledImport.component);
await cancelledImport.hooks.effects();
find(tree, (node) => node.type === '@/components/Input:Textarea' && node.props.rows === 12).props.onChange({ target: { value: 'pony = 小马\nsafe = 安全' } });
tree = cancelledImport.hooks.render(cancelledImport.component);
find(tree, (node) => node.type === '@/components/Button:default' && node.props.onClick?.name === 'executeBatchImport').props.onClick();
const importing = cancelledImport.confirms[0]();
cancelledImport.hooks.dispose();
existingReply.resolve(false);
await importing;
assert.equal(cancelledImport.saves(), 0, 'leaving the tab during an existence read prevents the following mutation');

const savingReply = deferred();
const stoppedSync = glossaryFixture({ save: () => savingReply.promise });
stoppedSync.hooks.render(stoppedSync.component);
await stoppedSync.hooks.effects();
tree = stoppedSync.hooks.render(stoppedSync.component);
await stoppedSync.hooks.effects();
find(tree, (node) => node.type === '@/components/Input:Input' && node.props.label === '结束页').props.onChange({ target: { value: '1' } });
tree = stoppedSync.hooks.render(stoppedSync.component);
const syncing = find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === '开始同步').props.onClick();
await flush();
assert.equal(stoppedSync.saves(), 1);
tree = stoppedSync.hooks.render(stoppedSync.component);
find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === '停止同步').props.onClick();
savingReply.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
await syncing;
assert.equal(stoppedSync.saves(), 1, 'Stop allows the outstanding request to settle and sends no next write');
assert.match(stoppedSync.toasts.at(-1).message, /同步已停止/);
assert.match(stoppedSync.toasts.at(-1).message, /1 新增/, 'an acknowledged write that was in flight when stopped still counts');
stoppedSync.hooks.dispose();
console.log('Page flows passed: URL state, denied storage, autocomplete cancellation, tab navigation, serial settings, guarded forum publishing and cancellable glossary jobs.');
