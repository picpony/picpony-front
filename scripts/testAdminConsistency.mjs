/** Admin interaction regressions with controlled responses; no backend or credentials. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function load(file, dependencies = {}, expose = '') {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code + (expose ? `\nexports.subject = ${expose};` : ''), {
    exports, Error, Response, AbortController, URL, URLSearchParams, setTimeout, clearTimeout, queueMicrotask,
    require: (name) => dependencies[name] ?? new Proxy({}, {
      get: (_, key) => key === '__esModule' ? true : `${name}:${String(key)}`,
    }),
  }, { filename: file });
  return exports;
}

/** Keep hook slots and effect cleanup while exercising the real handlers. */
function harness() {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  let rendering = false;
  let rerender = false;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (rendering && !Object.is(value, slots[index])) rerender = true;
        slots[index] = value;
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(factory, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        slots[index] = { deps, value: factory() };
      }
      return slots[index].value;
    },
    useCallback: (callback, deps) => react.useMemo(() => callback, deps),
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = deps;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  return {
    dependencies: { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' } },
    render(component) {
      let result;
      let attempts = 0;
      do {
        assert.ok(attempts++ < 8, 'render-phase state must settle');
        cursor = 0;
        rerender = false;
        rendering = true;
        result = component();
        rendering = false;
      } while (rerender);
      return result;
    },
    effects() { const pending = effects; effects = []; pending.forEach((effect) => effect()); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

const mutationResponses = load('lib/adminMutations.ts');
const SKIP = Symbol('skip');

function fixture(file, api = {}, initialData = {}, expose = '') {
  const hooks = harness();
  const session = { token: 'account-A' };
  const toasts = [];
  const resources = new Map();
  const reads = [];
  const refreshes = [];
  const confirmations = [];
  const dictionaryCache = new Map();
  const data = { ...initialData };
  const dependencies = {
    ...hooks.dependencies,
    // These fixtures exercise data writes; actual popup geometry has browser coverage.
    '@/components/Popover': { default: '@/components/Popover:default', estimateMenuHeight: () => 0 },
    '@/components/Toast': { showToast: (...args) => toasts.push(args) },
    '@/components/ConfirmDialog': {
      useConfirm: () => ({ confirmThen: (_, __, action) => {
        const result = action();
        confirmations.push(result);
        return result;
      } }),
      usePrompt: () => ({ prompt: async () => null }),
    },
    '@/components/InlineEditorPanel': {
      default: '@/components/InlineEditorPanel:default',
      captureInlineEditorLayout: () => {},
    },
    '@/lib/hooks': {
      readToken: () => session.token,
      useSession: () => ({ token: session.token, user: { role: 'super_admin' }, ready: true }),
    },
    '@/lib/adminMutations': mutationResponses,
    '@/lib/api/admin': api,
    '@/lib/api/picpony': {
      getTeamMembers: async () => ({ success: true, members: [] }),
      getDictionary: async () => ({ success: true, tags: data.dictionary ?? [], total_matches: data.dictionary?.length ?? 0 }),
      ...api,
    },
    '@/lib/api/derpi': { searchDerpiTags: async () => ({ tags: [] }), ...api },
    '@/lib/resources': {
      teamMembers: { invalidate: () => refreshes.push('team-members') },
      dictionaryTag: { invalidate: () => { dictionaryCache.clear(); refreshes.push('dictionary-tag'); } },
    },
    '@/lib/resource': {
      SKIP,
      defineResource(options) {
        const resource = {
          ...options,
          invalidate: () => refreshes.push(options.name),
          write: (_, value) => { data[options.name] = typeof value === 'function' ? value(data[options.name]) : value; },
        };
        resources.set(options.name, resource);
        return resource;
      },
      useResource(resource, args) {
        reads.push({ name: resource.name, args });
        return {
          data: args === SKIP ? undefined : data[resource.name],
          refresh: () => refreshes.push(resource.name),
          isLoading: false,
        };
      },
    },
  };
  dependencies['./queries'] = load('components/admin/queries.ts', dependencies);
  dependencies['./useAdminMutation'] = load('components/admin/useAdminMutation.ts', dependencies);
  const loaded = file ? load(`components/admin/${file}.tsx`, dependencies, expose) : {};
  const Component = loaded.default;
  return {
    hooks, session, toasts, resources, reads, refreshes, data, confirmations, dictionaryCache,
    queries: dependencies['./queries'],
    subject: loaded.subject,
    useMutation: dependencies['./useAdminMutation'].useAdminMutation,
    render: () => hooks.render(() => Component({ token: session.token, myRole: 'super_admin' })),
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return Object.values(tree.props ?? {}).map((child) => find(child, predicate)).find(Boolean);
}
const byType = (tree, name) => find(tree, (node) => node.type === `@/components/${name}:default`);
const input = (tree, key, value) => find(tree, (node) => node.type === '@/components/Input:Input' && node.props[key] === value);
const button = (tree, label) => find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === label);
const modal = (tree, title) => find(tree, (node) => node.type === '@/components/Modal:default' && node.props.title === title);
const change = (node, value) => node.props.onChange({ target: { value } });
const actionCell = (tree, row) => byType(tree, 'DataTable').props.columns.find((column) => column.actions).render(row);

test('admin reads and writes reject failed or malformed envelopes with the same message priority', async () => {
  const { requireAdminSuccess } = mutationResponses;
  const fx = fixture();
  for (const body of [null, [], 'ok', 1, { success: 'true' }, { success: false }]) {
    await assert.rejects(requireAdminSuccess(Response.json(body), '保存失败'), /保存失败/);
  }
  await assert.rejects(requireAdminSuccess(Response.json({ success: true }, { status: 503 })), /HTTP 503/);
  await assert.rejects(requireAdminSuccess(new Response('<html>error</html>'), '保存失败'), /保存失败/);
  await assert.rejects(requireAdminSuccess(Response.json({ error: '首选错误', message: '备用错误' })), /首选错误/);
  await assert.rejects(requireAdminSuccess(Response.json({ error: {}, message: '有效错误' })), /有效错误/);
  assert.throws(() => fx.queries.adminData({ success: 'false' }, []), /加载失败/);
  assert.throws(() => fx.queries.adminData({ error: {}, message: '查询失败' }, []), /查询失败/);
  assert.deepEqual(await requireAdminSuccess(Response.json({ success: true, id: 7 })), { success: true, id: 7 });
});

test('mutation locks immediately, recovers after failure and ignores account/unmount continuations', async () => {
  const fx = fixture();
  const render = () => fx.hooks.render(() => fx.useMutation(fx.session.token));
  let mutation = render();
  fx.hooks.effects();
  const first = deferred();
  let requests = 0;
  let successes = 0;
  const request = () => { requests++; return first.promise; };
  const pending = mutation.run(request, () => { successes++; });
  assert.equal(mutation.isPending(), true);
  await mutation.run(request, () => { successes++; });
  assert.equal(requests, 1, 'two presses before render issue one write');
  assert.equal(render().busy, true);
  first.resolve(Response.json({ success: false, error: '暂时失败' }));
  await pending;
  assert.equal(render().busy, false);
  assert.equal(successes, 0);
  assert.equal(fx.toasts.at(-1)[0], '暂时失败');

  const oldA = deferred();
  const pendingA = render().run(() => oldA.promise, () => { successes++; });
  fx.session.token = 'account-B';
  mutation = render();
  fx.hooks.effects();
  assert.equal(mutation.busy, false);
  const oldB = deferred();
  const pendingB = mutation.run(() => oldB.promise, () => { successes++; });
  fx.session.token = 'account-A';
  mutation = render();
  fx.hooks.effects();
  assert.equal(mutation.busy, false, 'A → B → A must not revive a pending flag');
  const current = deferred();
  const latest = mutation.run(() => current.promise, () => { successes++; });
  oldA.resolve(Response.json({ success: true }));
  oldB.reject(new Error('obsolete failure'));
  await Promise.all([pendingA, pendingB]);
  assert.equal(render().busy, true, 'old completions cannot unlock a newer operation');
  assert.equal(successes, 0);
  assert.equal(fx.toasts.length, 1);
  current.resolve(Response.json({ success: true }));
  await latest;
  assert.equal(successes, 1);

  const afterUnmount = deferred();
  const abandoned = render().run(() => afterUnmount.promise, () => { successes++; });
  fx.hooks.dispose();
  afterUnmount.resolve(Response.json({ success: true }));
  await abandoned;
  assert.equal(successes, 1);
  assert.equal(fx.toasts.length, 1);
});

test('a committed write outlives its view while cache and UI continuations remain account-isolated', async () => {
  for (const changeAccount of [false, true]) {
    const fx = fixture();
    const mutation = fx.hooks.render(() => fx.useMutation(fx.session.token));
    fx.hooks.effects();
    const response = deferred();
    const committed = [];
    let uiUpdates = 0;
    const pending = mutation.run(() => response.promise, () => { uiUpdates++; }, '保存失败', {
      onCommitted: (data) => committed.push(data.id),
    });
    fx.hooks.dispose();
    if (changeAccount) fx.session.token = 'account-B';
    response.resolve(Response.json({ success: true, id: 7 }));
    await pending;
    assert.equal(committed.length, changeAccount ? 0 : 1);
    assert.equal(uiUpdates, 0);
    assert.equal(fx.toasts.length, 0);
  }
});

test('wealth changes submit once and preserve the form when the backend rejects them', async () => {
  const user = { id: 5, username: '测试用户', experience: 50, coins: 20 };
  const requests = [];
  const fx = fixture('WealthTab', {
    adminUpdateWealth: (_, payload) => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; },
  }, { 'admin-wealth': [user] });
  let tree = fx.render();
  fx.hooks.effects();
  button(actionCell(tree, user), '修改资产').props.onClick();
  tree = fx.render();
  change(input(tree, 'label', '变动原因（必填）'), '活动奖励');
  tree = fx.render();
  change(input(tree, 'placeholder', '数值'), '25');
  tree = fx.render();
  const submit = button(tree, '确认修改').props.onClick;
  const pending = submit();
  await submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.coins_value, '25');
  assert.equal(input(fx.render(), 'label', '变动原因（必填）').props.disabled, true);
  requests[0].resolve(Response.json({ success: false, error: '拒绝修改' }));
  await pending;
  tree = fx.render();
  assert.equal(byType(tree, 'Modal').props.isOpen, true);
  assert.equal(input(tree, 'label', '变动原因（必填）').props.value, '活动奖励');
  const retry = button(tree, '确认修改').props.onClick();
  requests[1].resolve(Response.json({ success: true }));
  await retry;
  assert.equal(byType(fx.render(), 'Modal').props.isOpen, false);
  assert.equal(fx.refreshes.length, 1);
  fx.hooks.dispose();
});

test('renaming a filtered user keeps the closing editor mounted until exit completes', async () => {
  const user = { id: 7, username: 'Alice', email: 'a@example.test', role: 'user', is_banned: 0 };
  const otherUser = { ...user, id: 8, username: 'Carol', email: 'c@example.test' };
  const response = deferred();
  const fx = fixture('UsersTab', { adminUpdateUser: () => response.promise }, {
    'admin-users': [user, otherUser],
  });
  let tree = fx.render();
  fx.hooks.effects();
  const search = () => find(fx.render(), (node) => node.type === './:SearchInput');
  search().props.onChange('Alice');
  tree = fx.render();
  find(actionCell(tree, user), (node) => node.props?.['aria-label'] === '编辑用户 Alice')
    .props.onClick({ currentTarget: {} });
  tree = fx.render();
  let editor = byType(tree, 'DataTable').props.expandedRow(user);
  change(input(editor, 'id', 'users-inline-7-username'), 'Bob');
  tree = fx.render();
  editor = byType(tree, 'DataTable').props.expandedRow(user);
  const pending = button(editor, '保存修改').props.onClick();
  response.resolve(Response.json({ success: true }));
  await pending;
  assert.deepEqual(fx.refreshes, ['admin-users'], 'the committed write refreshes before the editor closes');

  // The refreshed full list arrives before the closing animation finishes.
  const renamedUser = { ...user, username: 'Bob' };
  fx.data['admin-users'] = [renamedUser, otherUser];
  tree = fx.render();
  const table = byType(tree, 'DataTable');
  assert.deepEqual(table.props.rows.map((row) => row.id), [7], 'only the closing row temporarily bypasses the old-name filter');
  editor = table.props.expandedRow(table.props.rows[0]);
  assert.equal(editor.props.isClosing, true);
  assert.equal(editor.props.id, 'users-inline-7-editor');

  editor.props.onExitComplete();
  assert.equal(byType(fx.render(), 'DataTable').props.rows.length, 0, 'the old-name filter applies after exit');
  search().props.onChange('');
  tree = fx.render();
  assert.equal(byType(tree, 'DataTable').props.rows.length, 2);
  assert.equal(byType(tree, 'DataTable').props.expandedRow(renamedUser), null, 'clearing the filter cannot resurrect the closed editor');
  assert.deepEqual(fx.refreshes, ['admin-users'], 'closing does not send a duplicate refresh');
  fx.hooks.dispose();
});

test('notification failure retains the broadcast draft and HTTP errors cannot announce success', async () => {
  const requests = [];
  const fx = fixture('NotificationsTab', {
    adminSendNotification: (_, payload) => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; },
  }, { 'admin-notifications': [] });
  let tree = fx.render();
  fx.hooks.effects();
  change(input(tree, 'id', 'notificationstab-f2'), ' 标题 ');
  const body = find(tree, (node) => node.type === '@/components/Input:Textarea');
  change(body, ' 正文 ');
  tree = fx.render();
  const submit = button(tree, '发送通知').props.onClick;
  const pending = submit();
  await submit();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { user_id: 0, title: '标题', content: '正文' });
  requests[0].resolve(Response.json({ success: true }, { status: 503 }));
  await pending;
  tree = fx.render();
  assert.equal(input(tree, 'id', 'notificationstab-f2').props.value, ' 标题 ');
  assert.equal(fx.toasts.at(-1)[1], 'error');
  assert.equal(fx.refreshes.length, 0);
  const retry = button(tree, '发送通知').props.onClick();
  fx.hooks.dispose();
  requests[1].resolve(Response.json({ success: true }));
  await retry;
  assert.equal(fx.refreshes.length, 1, 'leaving the tab does not lose committed notification invalidation');
  assert.equal(fx.toasts.length, 1, 'the only toast belongs to the earlier visible failure');
});

test('team import cancels when input changes and an obsolete response cannot overwrite the form', async () => {
  const requests = [];
  const fx = fixture('TeamTab', {
    adminGetUsers: (_, signal) => { const result = deferred(); requests.push({ signal, ...result }); return result.promise; },
  }, { 'admin-team': [] });
  let tree = fx.render();
  fx.hooks.effects();
  change(input(tree, 'id', 'teamtab-f1'), '5');
  tree = fx.render();
  const pending = button(tree, '导入信息').props.onClick();
  assert.equal(requests.length, 1);
  change(input(fx.render(), 'id', 'teamtab-f2'), '手动输入');
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ success: true, users: [{ id: 5, username: '旧查询' }] });
  await pending;
  tree = fx.render();
  assert.equal(input(tree, 'id', 'teamtab-f2').props.value, '手动输入');
  assert.equal(button(tree, '导入信息').props.loading, false);
  assert.equal(fx.toasts.length, 0);
  const retry = button(tree, '导入信息').props.onClick();
  requests[1].resolve({ success: false, error: '无权导入' });
  await retry;
  assert.equal(fx.toasts.at(-1)[0], '无权导入');
  const abandoned = button(fx.render(), '导入信息').props.onClick();
  fx.hooks.dispose();
  assert.equal(requests[2].signal.aborted, true);
  requests[2].reject(new Error('late failure'));
  await abandoned;
  assert.equal(fx.toasts.length, 1);
});

test('message audit waits for an explicit query, isolates accounts and forwards cancellation', async () => {
  const calls = [];
  const fx = fixture('MessagesAuditTab', {
    adminGetAllMessages: async (...args) => { calls.push(args); return { success: true, messages: [] }; },
  });
  let tree = fx.render();
  assert.equal(fx.reads.at(-1).args, SKIP);
  change(input(tree, 'aria-label', '审计用户 ID'), '8');
  tree = fx.render();
  button(tree, '检索').props.onClick();
  tree = fx.render();
  assert.equal(fx.reads.at(-1).args.userId, 8);
  const resource = fx.resources.get('admin-message-audit');
  const controller = new AbortController();
  await resource.fetch(fx.reads.at(-1).args, controller.signal);
  assert.equal(calls[0][1], 8);
  assert.equal(calls[0][2], controller.signal);
  button(tree, '检索').props.onClick();
  assert.equal(fx.refreshes.length, 1, 'repeating the submitted query refreshes it');
  button(tree, '查全站').props.onClick();
  fx.render();
  assert.equal(fx.reads.at(-1).args.userId, undefined);
  fx.session.token = 'account-B';
  fx.render();
  assert.equal(fx.reads.at(-1).args, SKIP);
  await assert.rejects(resource.fetch({ token: 'account-A', userId: 8 }, controller.signal), /登录状态/);
  assert.equal(calls.length, 1);
});

test('report locks survive filtering a pending row out and back in, while other rows remain independent', async () => {
  const reports = [1, 2].map((id) => ({ id, status: 'pending', username: '测试', image_id: id, reason: 'test' }));
  const requests = [];
  const fx = fixture('ReportsTab', {
    adminHandleReport: (_, id, status) => { const result = deferred(); requests.push({ id, status, ...result }); return result.promise; },
  }, { 'admin-reports': reports });
  let tree = fx.render();
  fx.hooks.effects();
  const first = button(actionCell(tree, reports[0]), '完结').props.onClick();
  const search = () => find(fx.render(), (node) => node.type === './:SearchInput');
  search().props.onChange('2');
  tree = fx.render();
  assert.equal(byType(tree, 'DataTable').props.rows.length, 1);
  search().props.onChange('');
  tree = fx.render();
  const restored = actionCell(tree, reports[0]);
  assert.equal(button(restored, '驳回').props.disabled, true);
  await button(restored, '驳回').props.onClick();
  const second = button(actionCell(tree, reports[1]), '驳回').props.onClick();
  assert.deepEqual(requests.map(({ id, status }) => [id, status]), [[1, 'processed'], [2, 'rejected']]);
  requests.forEach((request) => request.resolve(Response.json({ success: true })));
  await Promise.all([first, second]);
  assert.deepEqual(fx.data['admin-reports'].map((report) => report.status), ['processed', 'rejected']);
  assert.equal(fx.refreshes.length, 2);
  fx.hooks.dispose();
});

test('a team save refreshes the public roster after leaving its editor but cannot affect another account', async () => {
  for (const changeAccount of [false, true]) {
    const response = deferred();
    const fx = fixture('TeamTab', { addTeamMember: () => response.promise }, { 'admin-team': [] });
    let tree = fx.render();
    fx.hooks.effects();
    change(input(tree, 'id', 'teamtab-f2'), '新成员');
    tree = fx.render();
    const pending = button(tree, '添加成员').props.onClick();
    fx.hooks.dispose();
    if (changeAccount) fx.session.token = 'account-B';
    response.resolve(Response.json({ success: true }));
    await pending;
    assert.equal(fx.refreshes.includes('team-members'), !changeAccount);
    assert.equal(fx.refreshes.includes('admin-team'), !changeAccount);
    assert.equal(fx.toasts.length, 0);
  }
});

async function openGlossary(fx) {
  fx.render();
  fx.hooks.effects();
  await flush();
  fx.render();
  fx.hooks.effects();
  await flush();
  return fx.render();
}

test('a confirmed glossary save clears old and not-found tag lookups, while rejection preserves them', async () => {
  const requests = [];
  const fx = fixture('GlossaryTab', {
    checkTagExists: async () => false,
    saveDictionaryTag: () => { const result = deferred(); requests.push(result); return result.promise; },
  });
  fx.dictionaryCache.set('missing-tag', null);
  fx.dictionaryCache.set('old-tag-name', { en: 'old-tag-name' });
  let tree = await openGlossary(fx);
  button(tree, '添加新标签').props.onClick();
  change(input(fx.render(), 'id', 'glossarytab-f1'), 'missing-tag');
  tree = fx.render();
  const pending = button(modal(tree, '添加新标签'), '保存').props.onClick();
  await flush();
  requests[0].resolve(Response.json({ success: false, error: '保存被拒绝' }));
  await pending;
  assert.equal(fx.dictionaryCache.size, 2);
  const retry = button(modal(fx.render(), '添加新标签'), '保存').props.onClick();
  await flush();
  requests[1].resolve(Response.json({ success: true }));
  await retry;
  assert.equal(fx.dictionaryCache.size, 0, 'new names, previous names and cached misses are all stale');
  assert.equal(fx.refreshes.filter((name) => name === 'dictionary-tag').length, 1);
  fx.hooks.dispose();
});

for (const operation of ['import', 'delete', 'sync']) {
  test(`glossary bulk ${operation} invalidates tag lookups once after confirmed writes`, async () => {
    const tags = [1, 2].map((id) => ({ id, en: `tag-${id}`, cn: '标签', aliases: [], cat: 'general', count: 0, description: '' }));
    let writes = 0;
    const save = async () => { writes++; return Response.json({ success: true }); };
    const fx = fixture('GlossaryTab', {
      checkTagExists: async () => false,
      saveDictionaryTag: save,
      deleteDictionaryTag: save,
      getDerpiPopularTags: async () => ({ tags: tags.map((tag) => ({ name: tag.en, category: tag.cat, images: 1 })) }),
    }, { dictionary: tags });
    fx.dictionaryCache.set('missing-tag', null);
    let tree = await openGlossary(fx);
    if (operation === 'import') {
      button(tree, '批量导入').props.onClick();
      tree = fx.render();
      const dialog = modal(tree, '批量导入标签');
      change(find(dialog, (node) => node.type === '@/components/Input:Textarea'), 'tag-one = 标签一\ntag-two = 标签二');
      button(modal(fx.render(), '批量导入标签'), '开始导入').props.onClick();
      await fx.confirmations.at(-1);
    } else if (operation === 'delete') {
      const columns = byType(tree, 'DataTable').props.columns;
      columns.find((column) => column.key === 'select').header.props.onChange();
      tree = fx.render();
      find(tree, (node) => node.type === '@/components/Button:default' && Array.isArray(node.props.children) && node.props.children[0] === '批量删除 (').props.onClick();
      await fx.confirmations.at(-1);
    } else {
      button(tree, '同步热门').props.onClick();
      change(input(fx.render(), 'label', '结束页'), '1');
      await button(modal(fx.render(), '拉取原站热门标签'), '开始同步').props.onClick();
    }
    assert.equal(writes, 2);
    assert.equal(fx.dictionaryCache.size, 0);
    assert.equal(fx.refreshes.filter((name) => name === 'dictionary-tag').length, 1);
    fx.hooks.dispose();
  });
}

test('a bulk write confirmed after leaving the glossary still invalidates lookup caches', async () => {
  const response = deferred();
  const fx = fixture('GlossaryTab', {
    checkTagExists: async () => false,
    saveDictionaryTag: () => response.promise,
  });
  let tree = await openGlossary(fx);
  button(tree, '批量导入').props.onClick();
  tree = fx.render();
  change(find(modal(tree, '批量导入标签'), (node) => node.type === '@/components/Input:Textarea'), 'new-tag = 新词');
  button(modal(fx.render(), '批量导入标签'), '开始导入').props.onClick();
  await flush();
  fx.hooks.dispose();
  fx.dictionaryCache.set('new-tag', null);
  response.resolve(Response.json({ success: true }));
  await fx.confirmations.at(-1);
  assert.equal(fx.dictionaryCache.has('new-tag'), false);
  assert.equal(fx.toasts.length, 0, 'an unmounted editor does not show a completion toast');
});
