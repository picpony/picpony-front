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
    dependencies: {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      // These fixtures exercise page state; actual popup geometry has browser coverage.
      '@/components/Popover': { default: '@/components/Popover:default', estimateMenuHeight: () => 0 },
    },
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
for (const sort of ['_score', 'width', 'height', 'size', 'random', 'updated_at']) assert.equal(searchState.searchSort(sort), sort);
assert.equal(searchState.searchSort('score&filter_id=0'), 'created_at');
/* Legacy values: `relevance` always meant `_score`; `hotness` was never a field. */
assert.equal(searchState.searchSort('relevance'), '_score');
assert.equal(searchState.searchSort('hotness'), 'created_at');
assert.equal(searchState.defaultSearchSort('relevance'), 'created_at', 'a default cannot rank a query it has not seen');
/* 相关性 only where the query gives something to rank by. */
assert.equal(searchState.queryHasRanking('fluttershy, safe'), false);
assert.equal(searchState.queryHasRanking('orange, colored'), false, 'lower-case or inside a tag is not an operator');
for (const ranked of ['fluttershy OR rarity', 'pony || zebra', 'fluttershy^2, rarity', 'pony~', 'description:rainbow']) {
  assert.equal(searchState.queryHasRanking(ranked), true, ranked);
}
assert.equal(searchState.effectiveSearchSort('_score', 'created_at', 'fluttershy'), 'created_at');
assert.equal(searchState.effectiveSearchSort('_score', 'created_at', 'fluttershy OR rarity'), '_score');
assert.equal(searchState.effectiveSearchSort('', '_score', 'fluttershy OR rarity'), 'created_at');
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
  matchMedia: () => ({ matches: false }),
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};
const later = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const lastWrite = () => {
  const [mode, href] = historyWrites.at(-1) ?? [];
  return { mode, params: new URL(href ?? '/', 'https://example.test').searchParams };
};

/* /search: the screen's state is its URL; the rules it applies are tested in testSearch.mjs. */
const blockFilters = load('lib/blockFilters.ts');
const searchQuery = load('lib/searchQuery.ts', { '@/lib/blockFilters': blockFilters });
const apiErrors = load('lib/api/errors.ts');
const searchHooks = harness();
const reads = {};
let semanticAnswer = { data: undefined, error: undefined };
let storageReads = 0;
let browsingFp = 'safe|-|d|-|';
const remembered = [];
const resourceStub = (name) => ({ name, prefetch: () => {}, read: async () => ({ images: [], total: 0 }) });
const { default: SearchScreen } = load('app/search/SearchScreen.tsx', {
  ...searchHooks.dependencies,
  // This suite isolates URL and request handlers; saved-status propagation has its own suite.
  '@/lib/useSiteStatus': { useSemanticConfig: (initial) => initial },
  '@/lib/searchState': searchState,
  '@/lib/searchQuery': searchQuery,
  '@/lib/blockFilters': blockFilters,
  '@/lib/api/errors': apiErrors,
  '@/lib/constants': { LS_KEYS: { searchSort: 'searchSort' }, MEDIA: { pointerCoarse: '(pointer: coarse)' } },
  '@/lib/hooks': { useEscapeBack: () => {} },
  '@/lib/backNavigation': { canGoBackInApp: () => false, useBackOrParent: () => () => {} },
  '@/lib/appScroller': { getAppScroller: () => null },
  '@/lib/scrollTo': { scrollAppToElement: () => {} },
  '@/lib/imageSequence': { createPagedSequence: (options) => ({ key: options.key, options }) },
  '@/components/Toast': { showToast: () => {} },
  '@/components/BackgroundLocation': { useBackgroundSearchParams: () => url.searchParams },
  'next/navigation': { useRouter: () => ({ push: (href) => { url = new URL(href, url); } }), usePathname: () => url.pathname },
  '@/lib/resource': { SKIP: 'SKIP', useResource: (resource, args) => {
    reads[resource.name] = args;
    if (resource.name === 'semantic') return { ...semanticAnswer, isPrevious: false, refresh: () => {} };
    return { data: args === 'SKIP' ? undefined : { images: [{ id: 1 }], total: 1 }, error: undefined, isPrevious: false, refresh: () => {} };
  } },
  '@/lib/resources': {
    searchFeed: resourceStub('feed'),
    semanticQuery: resourceStub('semantic'),
    syncBrowsingCookie: () => {},
    useBrowsingFingerprint: () => browsingFp,
  },
  './searchHistory': { rememberSearch: (query) => remembered.push(query) },
  './imageSearchStore': { readImageSearch: () => undefined, saveImageSearch: () => 'abcd1234' },
}, {
  window: windowMock,
  document: { title: '' },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  localStorage: { getItem: () => { storageReads++; throw new Error('Storage denied'); } },
});
const semanticOn = { availability: 'on', estimateMs: 900, timeoutMs: 10_000 };
const Search = () => SearchScreen({ semantic: semanticOn });
const renderSearch = () => { searchHooks.render(Search); return searchHooks.render(Search); };
let tree = searchHooks.render(Search);
assert.equal(storageReads, 0, 'SSR/hydration render does not read device-only storage');
await searchHooks.effects();
tree = renderSearch();
assert.equal(reads.feed.sortField, 'random', 'random reaches the request explicitly');
assert.equal(reads.feed.page, 2);
assert.equal(reads.feed.sortDir, 'asc');
url = new URL('https://example.test/search?q=fluttershy&sort=width&dir=desc&page=4');
renderSearch();
assert.equal(reads.feed.query, 'fluttershy');
assert.equal(reads.feed.sortField, 'width');
assert.equal(reads.feed.page, 4, 'Back/Forward reads the current URL, not mount-time state');
await searchHooks.effects();
browsingFp = 'safe|a|d|-|';
renderSearch();
await searchHooks.effects();
renderSearch();
assert.equal(reads.feed.page, 1, 'changed browsing rules reset an open search to its first page');
assert.equal(lastWrite().mode, 'replace', 'the reset refines the entry, never adds one');
url = new URL('https://example.test/pic/123');
browsingFp = 'safe|-|-|-|';
renderSearch();
await searchHooks.effects();
assert.equal(url.pathname, '/pic/123', 'background updates do not overwrite an image overlay route');

url = new URL('https://example.test/search?q=fluttershy&sort=width&dir=desc&page=2');
tree = renderSearch();
byType(tree, './SearchField:default').props.onSubmit('  rarity，  ');
assert.equal(lastWrite().mode, 'push', 'a new query is a new history entry (C1)');
assert.equal(lastWrite().params.get('q'), 'rarity');
assert.equal(lastWrite().params.get('page'), null, 'a new query starts on its first page');
assert.deepEqual(remembered, ['rarity'], 'the query joins the recent searches');
const writes = historyWrites.length;
byType(renderSearch(), './SearchField:default').props.onSubmit('');
byType(renderSearch(), './SearchField:default').props.onSubmit('rarity');
assert.equal(historyWrites.length, writes, 'an empty submit and the same query again write nothing');
byType(renderSearch(), './SearchToolbar:default').props.onSort('score');
assert.equal(lastWrite().mode, 'replace', 'a sort refines the search on screen (C1)');
assert.equal(lastWrite().params.get('sort'), 'score');
byType(renderSearch(), './SearchResults:default').props.onPageChange(3);
assert.equal(lastWrite().mode, 'replace', 'a page turn replaces (C1)');
assert.equal(lastWrite().params.get('page'), '3');

url = new URL('https://example.test/search?q=pony%2C%20upvotes.gte%3A100%2C%20animated%3Atrue&sort=created_at&dir=desc');
tree = renderSearch();
const toolbar = byType(tree, './SearchToolbar:default');
assert.equal(JSON.stringify(toolbar.props.filters.upvotes), JSON.stringify({ op: 'gte', value: 100 }), 'the panel reflects the committed query');
toolbar.props.onApplyFilters({ ...toolbar.props.filters, upvotes: null }, 'chip');
assert.equal(lastWrite().params.get('q'), 'pony, animated:true', 'a removed condition leaves the query');
byType(renderSearch(), './SearchToolbar:default').props.onApplyFilters(searchQuery.NO_SEARCH_FILTERS, 'chip');
assert.equal(lastWrite().params.get('q'), 'pony', 'clearing the conditions removes every one');

url = new URL(`https://example.test/search?q=${encodeURIComponent('在下雨天撑伞的小蝶')}&sort=created_at&dir=desc`);
semanticAnswer = { data: undefined, error: undefined };
tree = renderSearch();
assert.equal(reads.semantic.text, '在下雨天撑伞的小蝶', 'Chinese words go to the semantic parse');
assert.equal(reads.feed, 'SKIP', 'the search waits for the parse');
assert.equal(byType(tree, './SearchResults:default').props.waiting, true);
assert.equal(byType(tree, './SemanticLine:default').props.state.kind, 'pending');
semanticAnswer = { data: { enabled: true, tags: ['fluttershy', 'umbrella'], modelUsed: true, engines: [], mode: 'qwen' }, error: undefined };
tree = renderSearch();
assert.equal(reads.feed.query, 'fluttershy, umbrella', 'the tags the words became are what runs');
assert.ok(find(tree, (node) => node.type === './SemanticFeedback:default'), 'a model-made conversion offers feedback');
await searchHooks.effects();
await later(10);
assert.equal(lastWrite().params.get('tags'), 'fluttershy,umbrella', 'the conversion is pinned into the URL');
assert.equal(lastWrite().params.get('q'), '在下雨天撑伞的小蝶', 'the original words survive in it');
assert.equal(lastWrite().mode, 'replace');
tree = renderSearch();
byType(tree, './SemanticLine:default').props.onToggleTag('umbrella');
assert.equal(lastWrite().params.get('tags'), 'fluttershy', 'a tag can be left out of the search');
byType(renderSearch(), './SemanticLine:default').props.onSearchOriginal();
assert.equal(lastWrite().params.get('raw'), '1');
renderSearch();
assert.equal(reads.semantic, 'SKIP', 'searching the words as typed asks no model');
assert.equal(reads.feed.query, '在下雨天撑伞的小蝶');
url = new URL(`https://example.test/search?q=${encodeURIComponent('雨天')}&sort=created_at&dir=desc`);
semanticAnswer = { data: undefined, error: new apiErrors.ApiError('timeout') };
tree = renderSearch();
assert.equal(reads.feed.query, '雨天', 'a failed parse searches the words as typed');
assert.equal(JSON.stringify(byType(tree, './SemanticLine:default').props.state), JSON.stringify({ kind: 'failed', text: '雨天', timedOut: true, retryable: true }));
searchHooks.dispose();

/* The field: lookups wait for a word, never run on pinyin, and never reopen a cleared list. */
const fieldHooks = harness();
const fieldReads = [];
const useCombobox = load('lib/useCombobox.ts', fieldHooks.dependencies);
const { default: SearchField } = load('app/search/SearchField.tsx', {
  ...fieldHooks.dependencies,
  '@/lib/useCombobox': useCombobox,
  '@/lib/searchQuery': searchQuery,
  '@/lib/resource': { SKIP: 'SKIP', useResource: (_, args) => {
    fieldReads.push(args);
    return { data: args === 'SKIP' ? undefined : [{ id: 1, en: 'pony', cn: '小马', category: '', count: 3, aliases: [], description: '', restricted: false, sensitive: false }] };
  } },
  '@/lib/resources': { tagSuggestions: {} },
  '@/lib/utils': { cn: (...parts) => parts.filter((part) => typeof part === 'string' && part).join(' ') },
  './searchHistory': { readSearchHistory: () => [], clearSearchHistory: () => {} },
}, { window: windowMock, requestAnimationFrame: (callback) => setTimeout(callback, 0) });
let fieldValue = '';
const submitted = [];
const Field = () => SearchField({
  value: fieldValue,
  onValueChange: (next) => { fieldValue = next; },
  onSubmit: (text) => submitted.push(text),
  onRecentPick: () => {},
  onImageSearch: () => {},
  safeMode: true,
  placeholder: '搜索图片…',
});
const input = () => byType(fieldHooks.render(Field), '@/components/Input:Input');
const keyword = () => fieldReads.at(-1);
input().props.onChange({ target: { value: 'twilight', selectionStart: 8 } });
input().props.onChange({ target: { value: '', selectionStart: 0 } });
await later(330);
fieldHooks.render(Field);
assert.equal(keyword(), 'SKIP', 'clearing before the debounce cancels the lookup');
input().props.onChange({ target: { value: 'pony', selectionStart: 4 } });
await later(330);
fieldHooks.render(Field);
assert.equal(JSON.stringify(keyword()), JSON.stringify({ keyword: 'pony' }));
const popover = () => byType(fieldHooks.render(Field), '@/components/Popover:default');
assert.equal(popover().props.open, true, 'the list opens on the answer');
input().props.onCompositionStart();
input().props.onChange({ target: { value: 'pony, b', selectionStart: 7 } });
input().props.onChange({ target: { value: 'pony, bi', selectionStart: 8 } });
await later(330);
fieldHooks.render(Field);
assert.equal(JSON.stringify(keyword()), JSON.stringify({ keyword: 'pony' }), 'pinyin fragments are never looked up');
assert.equal(popover().props.open, true, 'and the list is kept while the IME composes');
/* Chrome delivers the committed text as the last input event of the composition, then compositionend. */
input().props.onChange({ target: { value: 'pony, 碧琪', selectionStart: 8 } });
input().props.onCompositionEnd({ currentTarget: { value: 'pony, 碧琪', selectionStart: 8 } });
await later(330);
fieldHooks.render(Field);
assert.equal(JSON.stringify(keyword()), JSON.stringify({ keyword: '碧琪' }), 'the committed text is looked up');
byType(fieldHooks.render(Field), 'form').props.onSubmit({ preventDefault: () => {} });
assert.deepEqual(submitted, ['pony, 碧琪'], 'Enter with no active row searches what was typed');
input().props.onChange({ target: { value: '', selectionStart: 0 } });
fieldHooks.render(Field);
assert.equal(popover().props.open, false, 'late results cannot reopen a cleared combobox');
fieldHooks.dispose();

/* The toolbar: the collapsed panel is inert, and its fields open on the query's conditions. */
const toolbarHooks = harness();
const { default: SearchToolbar } = load('app/search/SearchToolbar.tsx', {
  ...toolbarHooks.dependencies,
  '@/lib/searchQuery': searchQuery,
  '@/lib/useScrollFade': { useScrollFade: () => {} },
});
const toolbarTree = toolbarHooks.render(() => SearchToolbar({
  sortBy: 'created_at', sortDir: 'desc', defaultSort: 'created_at', canRank: false,
  onSort: () => {}, onDirection: () => {}, onResetSort: () => {},
  filters: { ...searchQuery.NO_SEARCH_FILTERS, upvotes: { op: 'gte', value: 100 } },
  onApplyFilters: () => {},
}));
assert.equal(find(toolbarTree, (node) => node.props?.inert === true && String(node.props?.className ?? '').includes('grid'))?.props.inert, true, 'collapsed advanced controls are inert');
assert.ok(find(toolbarTree, (node) => node.props?.label === '点赞数' && node.props?.value === '100' && node.props?.op === 'gte'), 'the panel opens on the query conditions');
assert.equal(find(toolbarTree, (node) => node.type === '@/components/Select:default' && node.props?.['aria-label'] === '排序方式').props.options.some((option) => option.value === '_score'), false, 'relevance only where the query can be ranked');
toolbarHooks.dispose();

const homeHooks = harness();
const homeArgs = [];
let homePage = 3;
const homePageChanges = [];
const { testComponent: FeedList } = load('app/HomeContent.tsx', {
  ...homeHooks.dependencies,
  /* `Component` for the failed page turn's pre-commit measurement (a class, because only a class
     sees the DOM before React mutates it); the page flow under test never mounts it. */
  react: { ...homeHooks.dependencies.react, useDeferredValue: (value) => value, Component: class Component {} },
  'next/navigation': { useRouter: () => ({ push() {} }), usePathname: () => '/' },
  '@/lib/api': { getBrowsingSettings: () => ({ homeSort: 'created_at' }) },
  '@/lib/hooks': { useDeferredLoading: () => false },
  '@/lib/overlay': { useMounted: () => true },
  '@/lib/resources': { homeFeed: { read: async () => ({ images: [], total: 0 }), prefetch() {} }, browsingFingerprint: () => browsingFp, syncBrowsingCookie: () => {} },
  '@/lib/resource': { SKIP: 'SKIP', useResource: (_, args) => {
    homeArgs.push(args);
    return { data: args === 'SKIP' ? undefined : { images: [{ id: 1 }], total: 1 }, refresh: () => {}, isLoading: false };
  } },
}, { window: windowMock }, 'FeedList');
const onHomePageChange = (page) => { homePageChanges.push(page); homePage = page; };
const renderHome = () => FeedList({ seed: null, page: homePage, onPageChange: onHomePageChange, enabled: true, onRetry() {} });
homeHooks.render(renderHome);
assert.equal(homeArgs.at(-1), 'SKIP', 'missing SSR seed must wait for the device fingerprint');
await homeHooks.effects();
homeHooks.render(renderHome);
assert.equal(homeArgs.filter((args) => args !== 'SKIP').length, 1, 'cold no-seed initialization requests exactly one resolved fingerprint');
assert.equal(homeArgs.at(-1).page, 3, 'the page in the address is the page read');
browsingFp = 'safe:four';
windowMock.dispatchEvent({ type: 'settings_updated' });
homeHooks.render(renderHome);
assert.equal(homeArgs.at(-1).fp, 'safe:four');
assert.deepEqual(homePageChanges, [1], 'a live filter change turns the list back to its first page');
assert.equal(homeArgs.at(-1).page, 1);
homeHooks.render(() => FeedList({ seed: null, page: 1, onPageChange: onHomePageChange, enabled: false, onRetry() {} }));
assert.equal(homeArgs.at(-1), 'SKIP', 'a gallery waiting behind the forum reads nothing (R12-006)');
homeHooks.dispose();

url = new URL('https://example.test/admin');
const adminHooks = harness();
const adminRegistry = load('components/admin/registry.tsx', { ...adminHooks.dependencies, './sections': load('components/admin/sections.ts') });
const adminAddress = load('app/admin/address.ts', {
  '@/lib/historyLayers': { isHistoryLayerState: () => false },
  '@/lib/overlay': { hasModalLayer: () => false, subscribeScreenQuiet: () => () => {} },
  '@/components/admin/registry': adminRegistry,
}, { window: windowMock });
const { testComponent: Admin } = load('app/admin/page.tsx', {
  ...adminHooks.dependencies,
  '@/components/BackgroundLocation': { useBackgroundSearchParams: () => url.searchParams },
  '@/components/admin/registry': adminRegistry,
  './address': adminAddress,
}, { window: windowMock }, '() => AdminConsole({ token: "A", role: "super_admin", viewerId: 1 })');
const adminWrites = historyWrites.length;
byType(adminHooks.render(Admin), '@/components/Tabs:default').props.onChange('users');
assert.equal(historyWrites.length, adminWrites + 1, 'one address write per tab change');
assert.equal(historyWrites.at(-1)[0], 'replace', 'a tab change replaces the address: Back leaves the console (decision 18)');
assert.equal(url.searchParams.get('tab'), 'users', 'the address changes in the event handler');
byType(adminHooks.render(Admin), '@/components/Tabs:default').props.onChange('welcome');
assert.equal(historyWrites.at(-1)[0], 'replace');
assert.equal(url.search, '', 'the overview is the bare /admin');
url = new URL('https://example.test/search');
await new Promise((resolve) => setTimeout(resolve, 600));
assert.equal(url.pathname, '/search', 'no delayed tab navigation can overwrite a later route');

/* Publishing a forum post — fields checked at the field, a cover that is still uploading holding
   the post, one send per press, the draft kept until the post is out — is exercised against the
   form itself in `scripts/testForum.mjs`; /forum/create is a shell around it now. */

// Exercise the popular-tag sync itself: its page range is checked at the field, each page is one
// batch write, a rejected page is counted rather than announced as imported, and 停止同步 lets
// the write in flight settle and sends no next page.
/* One realm's Error for the dialog and both modules, so a backend sentence is recognised as one. */
const adminSuccess = load('lib/adminMutations.ts', {}, { Error, Response });
const syncErrors = load('lib/api/errors.ts', {}, { Error });
const glossaryModel = load('components/admin/glossary/model.ts', { '@/lib/format': load('lib/format.ts') });
function syncFixture({ importTags } = {}) {
  const hooks = harness();
  const toasts = [];
  const derpiReads = [];
  const imports = [];
  const finished = [];
  const running = [];
  const syncModule = load('components/admin/glossary/SyncDialog.tsx', {
    ...hooks.dependencies,
    '@/components/Toast': { showToast: (message, tone) => toasts.push({ message, tone }) },
    '@/lib/hooks': { readToken: () => account },
    '@/lib/adminMutations': adminSuccess,
    '@/lib/api/errors': syncErrors,
    '@/lib/api/derpi': {
      getDerpiPopularTags: async (page, signal) => {
        derpiReads.push({ page, signal });
        return { tags: [{ name: 'Pony', category: 'species', images: 9 }, { name: 'safe', category: 'rating', images: 8 }] };
      },
    },
    '@/lib/api/admin': {
      batchImportDictionaryTags: (token, tasks) => {
        imports.push(tasks);
        return importTags ? importTags(tasks) : Promise.resolve(Response.json({ success: true, created: tasks.length, skipped: 0, failed: 0 }));
      },
    },
    './model': glossaryModel,
  }, { setTimeout: (fn) => setTimeout(fn, 0), Response, AbortController, Error });
  const props = {
    open: true,
    token: account,
    onClose() {},
    onRunningChange: (value) => running.push(value),
    onFinished: (result) => finished.push(result),
  };
  return { hooks, toasts, derpiReads, imports, finished, running, render: () => hooks.render(() => syncModule.default(props)) };
}
const syncForm = (view) => find(view, (node) => node.type === '../AdminForm:AdminForm');
const syncField = (view, label) => find(view, (node) => node.type === '@/components/Input:Input' && node.props.label === label);

const invalidSync = syncFixture();
tree = invalidSync.render();
syncField(tree, '起始页').props.onChange({ target: { value: '-2' } });
tree = invalidSync.render();
syncForm(tree).props.onSubmit();
await flush();
tree = invalidSync.render();
assert.equal(invalidSync.derpiReads.length + invalidSync.imports.length, 0, 'a bad range sends nothing');
assert.equal(syncField(tree, '起始页').props.error, '起始页须为正整数', 'and is said on its own field');

const rejectedSync = syncFixture({ importTags: async () => Response.json({ success: false, error: '权限不足' }, { status: 403 }) });
tree = rejectedSync.render();
await rejectedSync.hooks.effects();
syncField(tree, '结束页').props.onChange({ target: { value: '1' } });
tree = rejectedSync.render();
syncForm(tree).props.onSubmit();
for (let i = 0; i < 10; i++) await flush();
assert.equal(rejectedSync.imports.length, 1, 'one batch write per page');
assert.deepEqual(rejectedSync.imports[0].map((task) => [task.en, task.cn, task.cat, task.count]), [['pony', '未翻译', 'species', 9], ['safe', '未翻译', 'rating', 8]]);
assert.equal(rejectedSync.finished.length, 1);
assert.equal(rejectedSync.finished[0].created, 0, 'a rejected page never counts as imported');
assert.equal(rejectedSync.finished[0].failedPages, 1);
assert.deepEqual(rejectedSync.toasts.at(-1), { message: '权限不足', tone: 'error' });
assert.deepEqual(rejectedSync.running, [true, false]);

const writing = deferred();
const stoppedSync = syncFixture({ importTags: () => writing.promise });
tree = stoppedSync.render();
await stoppedSync.hooks.effects();
syncField(tree, '结束页').props.onChange({ target: { value: '3' } });
tree = stoppedSync.render();
syncForm(tree).props.onSubmit();
for (let i = 0; i < 4; i++) await flush();
assert.equal(stoppedSync.imports.length, 1);
tree = stoppedSync.render();
find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === '停止同步').props.onClick();
writing.resolve(Response.json({ success: true, created: 2, skipped: 0, failed: 0 }));
for (let i = 0; i < 10; i++) await flush();
assert.equal(stoppedSync.imports.length, 1, 'Stop lets the write in flight settle and sends no next page');
assert.equal(stoppedSync.derpiReads.length, 1);
assert.equal(stoppedSync.finished[0].stopped, true);
assert.equal(stoppedSync.finished[0].created, 2, 'an acknowledged write that was in flight when stopped still counts');
stoppedSync.hooks.dispose();
console.log('Page flows passed: URL state, denied storage, autocomplete cancellation, tab navigation, serial settings and cancellable glossary jobs.');
