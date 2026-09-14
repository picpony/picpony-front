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
    '@/lib/hooks': { useSession: () => ({ token: 'A', ready: true }), readToken: () => account },
    '@/lib/screenState': { useScreenState: (_, initial) => hooks.react.useState(initial) },
    '@/lib/resource': { useResource: () => ({ data: { history: [{ id: 7 }], totalPages: 1 } }) },
    '@/lib/resources': { browsingHistory: { invalidate: () => writes.push('invalidate'), write: (...args) => writes.push(args) } },
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirm: () => confirmation.promise, confirmDialog: null }) },
    '@/components/AuthModal': { useAuthModal: () => ({ openAuth: () => {} }) },
    '@/components/Toast': { showToast: (...args) => notices.push(args) },
    '@/lib/api': { api: { clearBrowsingHistory: async (token) => { calls.push(token); return { json: () => response.promise }; } } },
  });
  const tree = hooks.render(History);
  const clear = find(tree, (node) => node.props.children === '清空记录').props.onClick;
  return { hooks, confirmation, response, calls, writes, notices, clear, changeAccount: () => { account = 'B'; } };
}

test('history confirmation cannot clear a newly selected account', async () => {
  const fixture = historyFixture();
  const clearing = fixture.clear();
  fixture.changeAccount();
  fixture.confirmation.resolve(true);
  await clearing;
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.writes, []);
});

test('a history response from the previous account cannot update the cache or report success', async () => {
  const fixture = historyFixture();
  const clearing = fixture.clear();
  fixture.confirmation.resolve(true);
  await flush();
  assert.deepEqual(fixture.calls, ['A']);
  fixture.changeAccount();
  fixture.response.resolve({ success: true });
  await clearing;
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.notices, []);
});

function messagesFixture(snapshot) {
  const hooks = harness();
  let account = 'A';
  const reads = { announcement: [], notification: [], interaction: [], chat: [] };
  const request = (tab, page) => {
    const result = deferred();
    reads[tab].push({ ...result, page });
    return result.promise;
  };
  const { Messages, NotificationPane } = load('app/messages/page.tsx', {
    ...hooks.dependencies,
    'next/navigation': { useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() },
    '@/lib/hooks': { readToken: () => account, useEscapeBack: () => {}, useMediaQuery: () => false },
    '@/lib/pageCache': { readSnapshot: () => snapshot, writeSnapshot: () => {} },
    '@/lib/resource': { useResource: () => ({ data: {} }) },
    '@/lib/resources': { unreadCounts: { read: async () => ({}) } },
    '@/lib/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '@/components/ChatBubble': { markRuns: () => [] },
    '@/app/actions/getEmojis': { getEmojis: async () => [] },
    '@/lib/api': { api: {
      getAnnouncementHistory: () => request('announcement'),
      getNotifications: () => request('notification'),
      getInteractionNotifications: (_, page) => request('interaction', page),
      getRecentContacts: () => request('chat'),
    } },
  }, '\nexports.Messages = MessagesContent; exports.NotificationPane = NotificationPane;');
  const render = () => hooks.render(() => Messages({ token: 'A' }));
  const pane = (tree, tab) => find(tree, (node) => node.type === '@/components/TabPanes:TabPane' && node.props.value === tab);
  const notification = (tree, tab) => find(pane(tree, tab), (node) => node.type === NotificationPane);
  const select = async (tab) => {
    find(render(), (node) => node.type === '@/components/Tabs:default').props.onChange(tab);
    render();
    await hooks.effects();
  };
  return { hooks, reads, render, pane, notification, select, NotificationPane, changeAccount: () => { account = 'B'; } };
}

test('message lists reject superseded/account-stale replies without changing another pane', async () => {
  const fixture = messagesFixture();
  fixture.render();
  await fixture.hooks.effects();
  await fixture.select('notification');
  fixture.reads.notification[0].resolve({ success: true, notifications: [{ id: 1, title: 'Current notification' }] });
  await flush();
  fixture.reads.announcement[0].resolve({ success: false });
  await flush();
  let props = fixture.notification(fixture.render(), 'notification').props;
  assert.equal(props.items[0].id, 1);
  assert.equal(props.loading, false);
  assert.equal(props.error, null, 'announcement failures stay in the announcement pane');

  const older = props.onRetry();
  const newer = props.onRetry();
  fixture.reads.notification[2].resolve({ success: true, notifications: [{ id: 3 }] });
  await newer;
  fixture.reads.notification[1].resolve({ success: false });
  await older;
  props = fixture.notification(fixture.render(), 'notification').props;
  assert.equal(props.items[0].id, 3);
  assert.equal(props.error, null, 'a late failed retry cannot replace a newer success');

  const previousAccount = props.onRetry();
  fixture.changeAccount();
  fixture.reads.notification[3].resolve({ success: true, notifications: [{ id: 4 }] });
  await previousAccount;
  assert.equal(fixture.notification(fixture.render(), 'notification').props.items[0].id, 3);
  fixture.hooks.dispose();
});

test('interaction pagination retains its rows, survives silent failures and restores the last page', async () => {
  const fixture = messagesFixture({
    stale: false,
    value: {
      tab: 'interaction', announcements: [], notifications: [], contacts: [],
      interactions: [{ id: 30 }], interactionsPage: 3, interactionsTotalPages: 5,
    },
  });
  fixture.render();
  await fixture.hooks.effects();
  assert.equal(fixture.reads.interaction[0].page, 3, 'restoring a snapshot refreshes its page');
  fixture.reads.interaction[0].resolve({ success: false });
  await flush();
  let props = fixture.notification(fixture.render(), 'interaction').props;
  assert.equal(props.items[0].id, 30);
  assert.equal(props.error, null, 'a background failure leaves restored content readable');

  const nextPage = find(props.children, (node) => node.type === '@/components/Pagination:default').props.onPageChange(4);
  props = fixture.notification(fixture.render(), 'interaction').props;
  const duringPageChange = fixture.NotificationPane(props);
  assert.equal(duringPageChange.props['data-pagination-anchor'], true);
  assert.equal(duringPageChange.props['aria-busy'], true);
  assert.equal(props.items[0].id, 30, 'pending pagination keeps the prior list height');
  fixture.reads.interaction[1].resolve({ success: true, notifications: [{ id: 40 }], total_pages: 5 });
  await nextPage;
  props = fixture.notification(fixture.render(), 'interaction').props;
  assert.equal(props.items[0].id, 40);

  await fixture.select('announcement');
  fixture.reads.announcement[0].resolve({ success: true, announcements: [] });
  await flush();
  await fixture.select('interaction');
  assert.deepEqual(fixture.reads.interaction.map((entry) => entry.page), [3, 4, 4]);
  fixture.reads.interaction[2].resolve({ success: true, notifications: [{ id: 40 }], total_pages: 5 });
  await flush();
  fixture.hooks.dispose();
});

test('task claims reject duplicate clicks and show the acknowledged receipt before refresh', async () => {
  const hooks = harness();
  const reply = deferred();
  let claims = 0;
  let refreshes = 0;
  const data = { success: true, level: 1, experience: 0, coins: 0, novice_tasks: { bind_api: { progress: 1, claimed: 0 } } };
  const { default: Tasks } = load('app/tasks/page.tsx', {
    ...hooks.dependencies,
    '@/lib/hooks': { useSession: () => ({ token: 'A', ready: true }), readToken: () => 'A' },
    '@/lib/screenState': { useScreenState: (_, initial) => hooks.react.useState(initial) },
    '@/lib/resource': { useResource: () => ({ data, refresh: () => { refreshes++; } }) },
    '@/components/AuthModal': { useAuthModal: () => ({ openAuth: () => {} }) },
    '@/components/Toast': { showToast: () => {} },
    '@/lib/api': { api: { claimTask: async () => { claims++; return { json: () => reply.promise }; } } },
  });
  const claim = find(hooks.render(Tasks), (node) => node.type === '@/components/Button:default' && node.props.children === '领取').props.onClick;
  const first = claim();
  await claim();
  assert.equal(claims, 1);
  reply.resolve({ success: true, experience: 100, coins: 5 });
  await first;
  const tree = hooks.render(Tasks);
  assert.equal(find(tree, (node) => node.props.label === '首次绑定 API Key 进度').props.tone, 'success');
  assert.equal(find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === '领取'), undefined);
  assert.equal(refreshes, 1);
});
