/** Shared UI boundaries, with browser capabilities and snapshots controlled by the test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename: file });
  return exports;
}

const constants = { PICPONY_API_ORIGIN: 'https://picpony.top', LS_KEYS: {}, MEDIA: {} };

test('stored preferences use stable SSR defaults and react to both settings and storage events', () => {
  const listeners = new Map();
  const values = new Map();
  let snapshot;
  let denied = false;
  const hooks = load('lib/hooks.ts', {
    './constants': constants,
    react: {
      useCallback: (callback) => callback,
      useSyncExternalStore: (subscribe, read, server) => {
        snapshot = { subscribe, read, server };
        return read();
      },
    },
  }, {
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        assert.equal(listeners.get(name), listener);
        listeners.delete(name);
      },
    },
    localStorage: { getItem: (key) => {
      if (denied) throw new Error('Storage denied');
      return values.get(key) ?? null;
    } },
  });
  assert.equal(hooks.useStoredBoolean('counts'), false);
  assert.equal(snapshot.server(), 'false');
  assert.equal(hooks.useStoredBoolean('translations', true), true);
  values.set('translations', 'false');
  assert.equal(hooks.useStoredBoolean('translations', true), false);
  values.set('translations', 'damaged');
  assert.equal(hooks.useStoredBoolean('translations', true), true);
  values.set('filter', 'developer');
  assert.equal(hooks.useStoredValue('filter', 'safe'), 'developer');
  assert.equal(snapshot.server(), 'safe', 'hydration does not read device-only preferences');

  let updates = 0;
  const unsubscribe = snapshot.subscribe(() => updates++);
  listeners.get('storage')({ key: 'unrelated' });
  assert.equal(updates, 0);
  listeners.get('storage')({ key: 'filter' });
  listeners.get('storage')({ key: null });
  listeners.get('settings_updated')();
  assert.equal(updates, 3);
  unsubscribe();
  assert.equal(listeners.size, 0);
  denied = true;
  assert.equal(hooks.useStoredBoolean('translations', true), true);
  assert.equal(hooks.useStoredValue('filter', 'safe'), 'safe');
});

test('file validation does not read pixels, and failed or aborted readers never resolve as images', async () => {
  const readers = [];
  class Reader {
    constructor() { readers.push(this); }
    readAsDataURL(file) { this.file = file; }
  }
  const { validateImageFile, processImageFile } = load('lib/utils.ts', { './constants': constants }, {
    FileReader: Reader,
  });
  const file = { type: 'image/png', size: 1024 };
  validateImageFile(file);
  assert.equal(readers.length, 0);
  assert.throws(() => validateImageFile({ ...file, type: 'text/plain' }), /有效的图片/);
  assert.throws(() => validateImageFile({ ...file, size: 6 * 1024 * 1024 }), /5MB/);
  await assert.rejects(processImageFile({ ...file, type: '' }), /有效的图片/);
  assert.equal(readers.length, 0);

  const success = processImageFile(file);
  readers.at(-1).result = 'data:image/png;base64,fixture';
  readers.at(-1).onload();
  assert.equal(await success, 'data:image/png;base64,fixture');
  for (const event of ['onerror', 'onabort', 'onload']) {
    const pending = processImageFile(file);
    readers.at(-1).result = null;
    readers.at(-1)[event]();
    await assert.rejects(pending, /读取图片失败/);
  }
});

test('clipboard fallback always removes staging and restores focus, including on a thrown copy', async () => {
  let removed = 0;
  let focused = 0;
  let appended = 0;
  let fail = false;
  class Element {
    isConnected = true;
    focus(options) { assert.equal(options.preventScroll, true); focused++; }
  }
  const clipboard = { writeText: async () => { throw new Error('Clipboard denied'); } };
  const { copyText } = load('lib/utils.ts', { './constants': constants }, {
    navigator: { clipboard }, window: { isSecureContext: true }, HTMLElement: Element,
    document: {
      activeElement: new Element(),
      body: { appendChild: () => appended++ },
      createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove: () => removed++ }),
      execCommand: () => { if (fail) throw new Error('Copy denied'); return true; },
    },
  });
  assert.equal(await copyText('example'), true);
  assert.equal(removed, 1);
  assert.equal(focused, 1);
  fail = true;
  assert.equal(await copyText('example'), false);
  assert.equal(removed, 2);
  assert.equal(focused, 2);
  clipboard.writeText = async () => {};
  assert.equal(await copyText('example'), true);
  assert.equal(appended, 2, 'native clipboard success needs no staging element');
});

test('all date shapes accept backend timestamps and ISO offsets without corrupting relative times', () => {
  const now = new Date('2026-09-14T12:00:00').getTime();
  class ClockDate extends Date { static now() { return now; } }
  const format = load('lib/format.ts', {}, { Date: ClockDate, Intl });
  assert.equal(format.formatDateTime('2026-09-14 09:26:00'), '2026/09/14 09:26');
  assert.equal(format.formatShortDateTime('2026-09-14 09:26:00'), '09/14 09:26');
  assert.equal(format.formatDate('2026-09-14 09:26:00'), '2026/09/14');
  assert.equal(format.formatMonthDay('2026-09-14 09:26:00'), '09/14');
  for (const name of ['formatDateTime', 'formatShortDateTime', 'formatDate', 'formatMonthDay']) {
    assert.equal(format[name]('invalid date'), 'invalid date');
    assert.equal(format[name](new Date(NaN)), '');
  }
  assert.equal(format.formatLastOnline('2026-09-14 11:48:00'), '12分钟前');
  assert.equal(format.formatLastOnline(new Date(now - 12 * 60_000).toISOString()), '12分钟前');
  assert.equal(format.formatLastOnline('2020-01-01T00:00:00Z'), '2020-01-01');
  assert.equal(format.formatLastOnline('invalid date'), 'invalid date');
});

function stateHarness() {
  const slots = [];
  const cleanups = [];
  let effects = [];
  let cursor = 0;
  let changed = false;
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
          changed = true;
        }];
      },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useCallback: (callback) => callback,
      useMemo: (create) => create(),
      useEffect(callback, dependencies) {
        const index = cursor++;
        if (!slots[index] || dependencies.some((value, offset) => !Object.is(value, slots[index][offset]))) {
          slots[index] = dependencies;
          effects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); });
        }
      },
      useSyncExternalStore: (_subscribe, read) => read(),
    },
    render(component) {
      for (let attempt = 0; attempt < 10; attempt++) {
        cursor = 0;
        changed = false;
        const result = component();
        if (!changed) return result;
      }
      assert.fail('Render-phase state did not settle');
    },
    async effects() {
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await new Promise((resolve) => setImmediate(resolve));
    },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

test('paged reads retain rows only within their resource and explicit account/filter scope', () => {
  const harness = stateHarness();
  const { useResource, SKIP } = load('lib/resource.ts', { react: harness.react });
  const empty = { data: undefined, error: undefined, isLoading: false, isStale: false };
  const snapshots = new Map();
  const source = { keyOf: ({ page }) => String(page), peekKey: (key) => snapshots.get(key) ?? empty };
  let page = 1;
  let scope = 'first-user:safe';
  let args = () => ({ page });
  const render = () => harness.render(() => useResource(source, args(), { keepPrevious: scope }));
  const first = ['page one'];
  snapshots.set('1', { ...empty, data: first });
  assert.equal(render().data, first);
  page = 2;
  assert.equal(render().data, first, 'a page change keeps the list height');
  snapshots.set('2', { ...empty, error: new Error('Offline') });
  assert.equal(render().data, first, 'failed next pages keep the previous answer with the new error');
  assert.equal(render().error.message, 'Offline');
  scope = 'first-user:developer';
  assert.equal(render().data, undefined, 'a filter change cannot retain the previous filter');
  scope = 'first-user:safe';
  assert.equal(render().data, undefined, 'switching back cannot resurrect discarded retention');
  snapshots.set('2', { ...empty, data: ['page two'] });
  render();
  scope = 'second-user:safe';
  page = 3;
  assert.equal(render().data, undefined, 'another profile cannot inherit the first profile');
  snapshots.set('3', { ...empty, data: null });
  render();
  page = 4;
  assert.equal(render().data, null, 'a legitimate null answer can be retained');
  args = () => SKIP;
  assert.equal(render().data, undefined);
  args = () => ({ page });
  assert.equal(render().data, undefined, 'disabled reads discard their previous account data');
  page = 1;
  scope = true;
  render();
  const otherResource = { ...source, peekKey: () => empty };
  assert.equal(harness.render(() => useResource(otherResource, { page }, { keepPrevious: true })).data, undefined);
});

test('Derpi upload pagination restores separate user/filter pages on a live switch and a return visit', () => {
  let filter = 'developer';
  let userId = 'first-user';
  let safeTotal = 10;
  let activeHarness;
  const react = {
    useState: (...args) => activeHarness.react.useState(...args),
    useCallback: (...args) => activeHarness.react.useCallback(...args),
  };
  // The store survives navigation, while each keyed component has fresh hook slots.
  const screenState = load('lib/screenState.ts', { react });
  const queries = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const { default: Page } = load('app/derpi/user/[id]/page.tsx', {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'next/navigation': { useParams: () => ({ id: userId }), useRouter: () => ({ back() {}, push() {} }) },
    'react-icons/md': {},
    '@/lib/hooks': { useEscapeBack() {}, useStoredValue: () => filter },
    '@/lib/constants': { LS_KEYS: { contentFilter: 'contentFilter' } },
    '@/lib/searchQuery': { parseContentFilter: (value) => value },
    '@/lib/screenState': screenState,
    '@/lib/resources': { derpiUserProfile: 'profile', derpiUserUploads: 'uploads' },
    '@/lib/resource': { SKIP: Symbol('skip'), useResource: (resource, args) => {
      if (resource === 'profile') return {
        data: { id: args.id === 'first-user' ? 42 : 43, name: args.id, uploads_count: 90 }, refresh() {},
      };
      queries.push(args);
      const total = args.contentFilter === 'safe' ? safeTotal : 90;
      const images = args.page <= Math.ceil(total / args.perPage)
        ? [{ id: args.page * 100 + args.id, score: 0, representations: { small: '/fixture.png' } }]
        : [];
      return { data: { images, total }, refresh() {}, isLoading: false };
    } },
    '@/components/Pagination': { default: 'Pagination' },
    '@/components/Skeleton': { default: 'Skeleton' },
    '@/components/Avatar': { default: 'Avatar' },
    '@/components/Badge': { default: 'Badge' },
    '@/components/ErrorRetry': { default: 'ErrorRetry' },
    '@/components/PageBack': { default: 'PageBack' },
    '@/components/EmptyState': { default: 'EmptyState' },
    '@/components/Button': { default: 'Button', buttonClasses: () => '' },
    '@/components/SectionHeading': { default: 'SectionHeading' },
    '@/lib/icons': { ICON: {} },
  });
  let instance;
  const render = () => {
    const element = Page();
    if (!instance || instance.key !== element.key || instance.type !== element.type) {
      instance?.hooks.dispose();
      instance = { key: element.key, type: element.type, hooks: stateHarness() };
    }
    activeHarness = instance.hooks;
    return activeHarness.render(() => element.type(element.props));
  };
  const leave = () => { instance.hooks.dispose(); instance = undefined; };
  function find(node, type) {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node?.props) return undefined;
    return node.type === type ? node : Object.values(node.props).map((child) => find(child, type)).find(Boolean);
  }

  let tree = render();
  find(tree, 'Pagination').props.onPageChange(3);
  tree = render();
  assert.equal(queries.at(-1).page, 3);
  assert.equal(find(tree, 'Pagination').props.currentPage, 3);

  filter = 'safe';
  tree = render();
  assert.equal(queries.at(-1).page, 1, 'the first safe read cannot inherit developer page 3');
  assert.equal(queries.at(-1).contentFilter, 'safe');
  assert.equal(find(tree, 'EmptyState'), undefined, 'ten available uploads must not render as empty');
  assert.equal(find(tree, 'Pagination'), undefined, 'one page needs no pager');

  filter = 'developer';
  assert.equal(find(render(), 'Pagination').props.currentPage, 3);
  safeTotal = 50;
  filter = 'safe';
  find(render(), 'Pagination').props.onPageChange(2);
  assert.equal(find(render(), 'Pagination').props.currentPage, 2);
  filter = 'developer';
  assert.equal(find(render(), 'Pagination').props.currentPage, 3);
  userId = 'second-user';
  assert.equal(find(render(), 'Pagination').props.currentPage, 1, 'another user owns another page history');
  assert.equal(queries.at(-1).id, 43);

  userId = 'first-user';
  filter = 'safe';
  assert.equal(find(render(), 'Pagination').props.currentPage, 2);
  leave();
  assert.equal(find(render(), 'Pagination').props.currentPage, 2, 'a return visit restores the safe page');
  filter = 'developer';
  leave();
  tree = render();
  assert.equal(find(tree, 'Pagination').props.currentPage, 3, 'a return visit restores the developer page');
  assert.equal(queries.at(-1).page, 3);
  assert.equal(queries.at(-1).contentFilter, 'developer');
  assert.ok(find(tree, 'PageBack'), 'the page keeps its back affordance');
  leave();
});

test('developer-mode writes preserve accepted settings after closing without updating obsolete UI', async () => {
  const harness = stateHarness();
  const requests = [];
  const notices = [];
  const stored = new Map();
  let token = 'account-a';
  let open = true;
  let statusSignal;
  const jsx = (type, props) => ({ type, props });
  const { default: DeveloperGuide } = load('components/DeveloperGuideModal.tsx', {
    react: harness.react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/components/Modal': { default: 'Modal' },
    '@/components/Button': { default: 'Button' },
    '@/components/Input': { Input: 'Input' },
    '@/components/Skeleton': { default: 'Skeleton', SkeletonCircle: 'SkeletonCircle' },
    '@/components/ErrorRetry': { default: 'ErrorRetry' },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    '@/lib/hooks': { useSession: () => ({ token, ready: true }), readToken: () => token },
    '@/lib/constants': { LS_KEYS: { developer: 'developer' } },
    '@/lib/icons': { ICON: {} },
    'react-icons/md': {},
    '@/lib/api/picpony': {
      getDeveloperStatus: async (_token, signal) => {
        statusSignal = signal;
        return { success: true, is_developer: false,
          prerequisites: { logged_in: true, api_bound: true, level_gt_3: true } };
      },
      enableDeveloperMode: (credential) => new Promise((resolve) => requests.push({ credential, resolve })),
      disableDeveloperMode: async () => Response.json({ success: true }),
    },
  }, {
    AbortController, Event, queueMicrotask,
    window: { dispatchEvent() {} },
    localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
  });
  function find(node, type) {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node?.props) return undefined;
    return node.type === type ? node : Object.values(node.props).map((child) => find(child, type)).find(Boolean);
  }
  const render = () => harness.render(() => DeveloperGuide({ isOpen: open, onClose() {} }));
  async function fillPassword() {
    render();
    await harness.effects();
    find(render(), 'Input').props.onChange({ target: { value: '12345678' } });
    return find(render().props.footer, 'Button');
  }
  let button = await fillPassword();
  const first = button.props.onClick();
  await button.props.onClick();
  assert.equal(requests.length, 1, 'the ref lock closes the same-frame double-submit gap');
  open = false;
  render();
  await harness.effects();
  assert.equal(statusSignal.aborted, true);
  requests[0].resolve(Response.json({ success: true }));
  await first;
  assert.equal(stored.get('developer'), 'true', 'the same account keeps its accepted setting after closing');
  assert.equal(notices.length, 0, 'closed forms cannot publish a success notice');

  // Start the failure case with the mode off on both sides.
  stored.clear();
  open = true;
  button = await fillPassword();
  const failed = button.props.onClick();
  requests[1].resolve(Response.json({ success: true }, { status: 500 }));
  await failed;
  assert.equal(stored.size, 0, 'a failed HTTP status cannot enable the local mode');
  assert.equal(find(render(), 'Input').props.error, '开启失败');

  button = find(render().props.footer, 'Button');
  token = 'account-b';
  await button.props.onClick();
  assert.equal(requests.length, 2, 'an old form cannot write into a different account');
  harness.dispose();
});

test('tag groups keep their distinct navigation actions and independent expansion limits', () => {
  const pushes = [];
  const selected = [];
  const expanded = [];
  const jsx = (type, props) => ({ type, props });
  const { default: TagList } = load('components/TagList.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useRouter: () => ({ push: (...args) => pushes.push(args) }) },
    '@/components/Button': { default: 'Button' },
    '@/components/Chip': { default: 'Chip' },
    '@/components/Skeleton': { default: 'Skeleton' },
    '@/lib/tagCategories': { tagCategoryChip: (category) => category },
    '@/lib/tagTranslations': { tagTranslationKey: (name) => name.toLowerCase() },
  });
  const tree = TagList({
    tags: ['artist:one & two', 'artist:second', 'oc:pony', 'oc:other', 'safe', 'smile', 'spoiler:omit'],
    visibleTagLimits: { imageId: 4, artists: 1, ocs: 1, regular: 1 },
    showTagCounts: true, tagCounts: { safe: 0 }, tagTranslations: { safe: '安全' },
    onTagClick: (tag) => selected.push(tag), onShowMore: (limits) => expanded.push(limits),
  });
  function collect(node, type) {
    if (Array.isArray(node)) return node.flatMap((child) => collect(child, type));
    if (!node || typeof node !== 'object') return [];
    return [...(node.type === type ? [node] : []), ...collect(node.props?.children, type)];
  }
  const chips = collect(tree, 'Chip');
  assert.equal(chips.length, 3);
  chips.forEach((chip) => chip.props.onClick());
  assert.equal(new URL(pushes[0][0], 'https://app.invalid').searchParams.get('q'), 'artist:one & two');
  assert.equal(new URL(pushes[1][0], 'https://app.invalid').searchParams.get('q'), 'oc:pony');
  assert.deepEqual(selected, ['safe']);
  assert.equal(chips[2].props.children[0], '安全');
  assert.equal(collect(chips[2], 'span')[0].props.children, '0');
  collect(tree, 'Button').forEach((button) => button.props.onClick());
  assert.deepEqual(expanded.map((value) => [value.imageId, value.artists, value.ocs, value.regular]), [
    [4, 65, 1, 1], [4, 1, 65, 1], [4, 1, 1, 121],
  ]);
});
