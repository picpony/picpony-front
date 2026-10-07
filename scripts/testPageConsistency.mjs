/** Async page behavior against controlled responses; no browser or network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function load(file, dependencies, expose = '') {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code + expose, {
    exports,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'next/dynamic') return { default: () => 'DynamicComponent' };
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : `${name}:${String(key)}` });
    },
    URLSearchParams, URL, setTimeout, clearTimeout, queueMicrotask, performance,
    console: { ...console, error: () => {} },
  }, { filename: file });
  return exports;
}

function harness() {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  let pendingEffects = [];
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
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
    useMemo(create, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: create() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (changed(slots[index], deps)) {
        slots[index] = deps;
        pendingEffects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const jsx = (type, props) => ({ type, props });
  return {
    react,
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
  if (!tree.props) return undefined;
  if (predicate(tree)) return tree;
  for (const value of Object.values(tree.props ?? {})) {
    const result = find(value, predicate);
    if (result) return result;
  }
}

/* The real `settle`: the screens branch on its outcome instead of holding a `try`. */
const settleModule = {
  settle: async (work) => {
    try {
      return { ok: true, value: await work };
    } catch (error) {
      return { ok: false, error };
    }
  },
};

function historyFixture() {
  const hooks = harness();
  let account = 'A';
  const confirmation = deferred();
  const response = deferred();
  const calls = [];
  const writes = [];
  const notices = [];
  const { default: History } = load('app/history/page.tsx', {
    ...hooks.dependencies,
    '@/lib/hooks': { useSession: () => ({ token: 'A', ready: true }), readToken: () => account, useNow: () => null },
    '@/lib/screenState': { useScreenState: (_, initial) => hooks.react.useState(initial) },
    '@/lib/resource': {
      SKIP: 'skip',
      useResource: () => ({ data: { entries: [{ id: 7, previewUrl: null, uploader: null, viewedAt: null }], totalPages: 1 } }),
    },
    '@/lib/resources': {
      browsingHistory: { invalidate: () => writes.push('invalidate'), write: (...args) => writes.push(args), prefetch: () => {} },
    },
    './useHistoryDeletes': { useHistoryDeletes: () => ({ hidden: new Set(), remove: () => {}, forget: () => writes.push('forget') }) },
    './useHistorySequence': { useHistorySequence: () => undefined },
    './days': load('app/history/days.ts', { '@/lib/format': load('lib/format.ts', {}) }),
    '@/lib/focusLanding': { focusLanding: () => true },
    '@/lib/detailTransit': { findDetailOriginLink: () => null, rememberDetailOrigin: () => {} },
    '@/lib/imageSequence': { openFromSequence: () => {} },
    '@/lib/settle': settleModule,
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/lib/format': load('lib/format.ts', {}),
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirm: () => confirmation.promise, confirmDialog: null }) },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    '@/lib/api/history': { clearBrowsingHistory: (token) => { calls.push(token); return response.promise; } },
  });
  const tree = hooks.render(History);
  const clear = find(tree, (node) => node.props.children === '清空记录').props.onClick;
  return { hooks, confirmation, response, calls, writes, notices, clear, changeAccount: () => { account = 'B'; } };
}

test('history confirmation cannot clear a newly selected account', async () => {
  const fixture = historyFixture();
  fixture.clear();
  fixture.changeAccount();
  fixture.confirmation.resolve(true);
  await flush();
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.writes, []);
});

test('a history response from the previous account cannot update the cache or report success', async () => {
  const fixture = historyFixture();
  fixture.clear();
  fixture.confirmation.resolve(true);
  await flush();
  assert.deepEqual(fixture.calls, ['A']);
  fixture.changeAccount();
  fixture.response.resolve(undefined);
  await flush();
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.notices, []);
});

test('a confirmed clear publishes the empty answer and reports success once', async () => {
  const fixture = historyFixture();
  fixture.clear();
  fixture.confirmation.resolve(true);
  await flush();
  fixture.response.resolve(undefined);
  await flush();
  assert.equal(fixture.writes[0], 'forget');
  assert.equal(fixture.writes[1], 'invalidate');
  assert.deepEqual(fixture.writes.slice(2).map(([args, value]) => [args.page, args.date, value.entries.length]), [[1, null, 0], [1, null, 0]]);
  assert.deepEqual(fixture.notices, [['已清空浏览历史', 'success']]);
});

test('task claims reject duplicate clicks and show the acknowledged receipt before refresh', async () => {
  const hooks = harness();
  const reply = deferred();
  let claims = 0;
  let refreshes = 0;
  const notices = [];
  const data = {
    level: 1, experience: 0, coins: 0, equippedBadges: [],
    progress: { novice: Object.fromEntries(['bind_api', 'verify_api', 'set_bg'].map(id => [id, { progress: 1, claimed: false }])), daily: null, weekly: null },
  };
  const { default: Tasks } = load('app/tasks/page.tsx', {
    ...hooks.dependencies,
    '@/lib/hooks': {
      useSession: () => ({ user: null, token: 'A', ready: true }), readToken: () => 'A', updateUserInfo: () => {}, useNow: () => null,
    },
    '@/lib/screenState': { useScreenState: (_, initial) => hooks.react.useState(initial) },
    '@/lib/resource': { SKIP: 'skip', useResource: () => ({ data, refresh: () => {} }) },
    '@/lib/resources': { tasks: { expire: () => { refreshes++; } }, coinTransactions: { invalidate: () => {} } },
    '@/lib/settle': settleModule,
    '@/app/settings/tabs': { settingsHref: (tab) => `/settings?tab=${tab}` },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    '@/lib/api/tasks': { claimTask: () => { claims++; return reply.promise; } },
  });
  const row = (tree) => find(tree, (node) => node.props.task?.claimId === 'novice_bind_api');
  const claim = row(hooks.render(Tasks)).props.onClaim;
  claim();
  claim();
  await flush();
  assert.equal(claims, 1, 'a second press while the claim is out sends nothing');
  assert.equal(row(hooks.render(Tasks)).props.claiming, true);
  reply.resolve({ experience: 100, coins: 5 });
  await flush();
  const after = row(hooks.render(Tasks));
  assert.equal(after.props.claimed, true, 'the receipt shows before the re-read lands');
  assert.equal(after.props.claiming, false);
  assert.equal(refreshes, 1);
  assert.deepEqual(notices, [['已领取，经验 +100，金币 +5', 'success']]);
});

test('a claim receipt without figures reports none', async () => {
  const hooks = harness();
  const notices = [];
  const data = {
    level: null, experience: null, coins: null, equippedBadges: [],
    progress: { novice: null, daily: Object.fromEntries(['login', 'fav', 'share', 'comment'].map(id => [id, { progress: 1, claimed: false }])), weekly: null },
  };
  const { default: Tasks } = load('app/tasks/page.tsx', {
    ...hooks.dependencies,
    '@/lib/hooks': {
      useSession: () => ({ user: null, token: 'A', ready: true }), readToken: () => 'A', updateUserInfo: () => {}, useNow: () => null,
    },
    '@/lib/screenState': { useScreenState: (_, initial) => hooks.react.useState(initial) },
    '@/lib/resource': { SKIP: 'skip', useResource: () => ({ data, refresh: () => {} }) },
    '@/lib/resources': { tasks: { expire: () => {} }, coinTransactions: { invalidate: () => {} } },
    '@/lib/settle': settleModule,
    '@/app/settings/tabs': { settingsHref: (tab) => `/settings?tab=${tab}` },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    '@/lib/api/tasks': { claimTask: async () => ({ experience: null, coins: null }) },
  });
  find(hooks.render(Tasks), (node) => node.props.task?.claimId === 'login').props.onClaim();
  await flush();
  assert.deepEqual(notices, [['已领取奖励', 'success']]);
});


test('Undo during a navigation-triggered history delete waits for the verdict and restores it', async () => {
  const hooks = harness();
  const response = deferred();
  const notices = [];
  const restored = [];
  let deletes = 0;
  const { useHistoryDeletes } = load('app/history/useHistoryDeletes.ts', {
    ...hooks.dependencies,
    '@/lib/hooks': { readToken: () => 'A' },
    '@/lib/api/errors': { apiErrorMessage: () => 'fixture failure' },
    '@/lib/api/history': {
      deleteBrowsingHistoryItem: () => { deletes++; return response.promise; },
      restoreBrowsingHistoryItem: async (token, entry) => { restored.push([token, entry.id]); },
    },
    '@/lib/resources': { browsingHistory: { peek: () => ({}), invalidate() {}, expire() {} } },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    fixture: { window: { addEventListener() {}, removeEventListener() {} }, document: { activeElement: null } },
  }, 'Object.assign(globalThis, require("fixture"));');
  const view = hooks.render(() => useHistoryDeletes('A', { page: 1, date: null }));
  await hooks.effects();
  view.remove({ id: 7 });
  const undo = notices[0][2].action.onClick;
  hooks.dispose(); // Leaving the page sends the held deletion.
  assert.equal(deletes, 1);
  undo();
  await flush();
  assert.deepEqual(restored, [], 'do not race a restore ahead of the delete');
  response.resolve();
  await flush(); await flush();
  assert.deepEqual(restored, [['A', 7]], 'the offered Undo is not lost while the delete is pending');
});
