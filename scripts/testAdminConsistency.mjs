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
/** Lets a fire-and-forget write (`void mutation.run(…)`) read its response and settle. */
const settle = async () => { for (let i = 0; i < 12; i++) await flush(); };

function load(file, dependencies = {}, expose = '') {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code + (expose ? `\nexports.subject = ${expose};` : ''), {
    exports, Error, Response, AbortController, URL, URLSearchParams, setTimeout, clearTimeout, queueMicrotask,
    /* A form moves focus to its first invalid field by id; there is no DOM here to move it in. */
    document: { getElementById: () => null },
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
    /* A slot like `useRef`, so an id is stable across renders and distinct per call (G4-031's region names). */
    useId() { const index = cursor++; return slots[index] ??= `fixture-id-${index}`; },
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
/* Import-free modules the panels call during render: loaded for real, not stubbed. */
const plainModules = {
  '@/lib/format': load('lib/format.ts'),
  '@/lib/roles': load('lib/roles.ts'),
  '@/lib/profileFields': load('lib/profileFields.ts'),
  '@/lib/validation': load('lib/validation.ts'),
};

/**
 * Renders the panel's own local components (a dialog, a sub-pane) inline, as React would: they
 * are functions in this module rather than stubs, and their hooks take the slots after the
 * panel's, in a stable order.
 */
function expandTree(tree, names) {
  if (!names.length || !tree || typeof tree !== 'object') return tree;
  if (Array.isArray(tree)) return tree.map((child) => expandTree(child, names));
  if (typeof tree.type === 'function' && names.includes(tree.type.name)) return expandTree(tree.type(tree.props), names);
  if (!tree.props) return tree;
  const props = {};
  for (const [key, value] of Object.entries(tree.props)) props[key] = expandTree(value, names);
  return { ...tree, props };
}

/** `usersQuery`'s value: one `admin_get_users` answer, its rows and the `stats` beside them (G2-019). */
const usersOf = (rows) => ({ rows, stats: null });
function fixture(file, api = {}, initialData = {}, { expose = '', expand = [], modules = {} } = {}) {
  const hooks = harness();
  const session = { token: 'account-A' };
  const toasts = [];
  const resources = new Map();
  const reads = [];
  const refreshes = [];
  const confirmations = [];
  /** Every question a confirm asked — title, body and tone — in order. */
  const asked = [];
  const dictionaryCache = new Map();
  const data = { ...initialData };
  const dependencies = {
    ...hooks.dependencies,
    ...plainModules,
    // These fixtures exercise data writes; actual popup geometry has browser coverage.
    '@/components/Popover': { default: '@/components/Popover:default', estimateMenuHeight: () => 0 },
    '@/components/Toast': { showToast: (...args) => toasts.push(args) },
    '@/components/ConfirmDialog': {
      useConfirm: () => ({
        confirmThen: (title, message, action, options) => {
          asked.push({ title, message, tone: options?.tone ?? 'danger' });
          const result = action();
          confirmations.push(result);
          return result;
        },
        confirm: async (options) => { asked.push({ ...options, tone: options.tone ?? 'danger' }); return true; },
        confirmDialog: null,
      }),
      usePrompt: () => ({ prompt: async () => null, promptDialog: null }),
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
      tagEntry: { invalidate: () => { dictionaryCache.clear(); refreshes.push('dictionary-tag'); } },
      userProfile: {
        name: 'user-profile',
        read: (args) => (api.userProfileRead ? api.userProfileRead(args) : Promise.resolve(data['user-profile'] ?? null)),
      },
      translateSwitch: { name: 'translate-switch', invalidate: () => refreshes.push('translate-switch') },
      shopItems: { name: 'shop-items', invalidate: () => refreshes.push('shop-items') },
    },
    '@/lib/resource': {
      SKIP,
      defineResource(options) {
        const resource = {
          ...options,
          peek: () => ({ data: data[options.name] }),
          invalidate: () => refreshes.push(options.name),
          expire: () => refreshes.push(options.name),
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
  Object.assign(dependencies, typeof modules === 'function' ? modules(dependencies) : modules);
  dependencies['@/lib/api/errors'] = load('lib/api/errors.ts');
  dependencies['./queries'] = load('components/admin/queries.ts', dependencies);
  dependencies['./useAdminMutation'] = load('components/admin/useAdminMutation.ts', dependencies);
  dependencies['./useSettled'] = load('components/admin/useSettled.ts', dependencies);
  dependencies['./paging'] = load('components/admin/paging.tsx', dependencies);
  dependencies['./figures'] = load('components/admin/figures.ts', dependencies);
  dependencies['./wealth'] = load('components/admin/wealth.ts', dependencies);
  dependencies['./badges'] = load('components/admin/badges.ts');
  dependencies['./team'] = load('components/admin/team.ts', dependencies);
  dependencies['./shop'] = load('components/admin/shop.ts', dependencies);
  dependencies['./sharedQueries'] = load('components/admin/sharedQueries.ts', dependencies);
  dependencies['./ColorField'] = dependencies['../ColorField'] = load('components/admin/ColorField.tsx', dependencies);
  dependencies['./rules'] = dependencies['./users/rules'] = load('components/admin/users/rules.ts', dependencies);
  dependencies['./users/UserEditor'] = load('components/admin/users/UserEditor.tsx', dependencies);
  /* The glossary's parts import their siblings one directory down. */
  for (const name of ['useAdminMutation', 'useSettled', 'queries', 'AdminForm', 'SectionHeader', 'paging']) {
    if (dependencies[`./${name}`]) dependencies[`../${name}`] = dependencies[`./${name}`];
  }
  dependencies['./model'] = load('components/admin/glossary/model.ts', dependencies);
  dependencies['./resources'] = load('components/admin/glossary/resources.ts', dependencies);
  dependencies['./TagEditor'] = load('components/admin/glossary/TagEditor.tsx', dependencies);
  const loaded = file ? load(`components/admin/${file}.tsx`, dependencies, expose) : {};
  const Component = loaded.default;
  const viewer = { role: 'super_admin', viewerId: 1 };
  return {
    hooks, session, toasts, resources, reads, refreshes, data, confirmations, asked, dictionaryCache, viewer,
    queries: dependencies['./queries'],
    errors: dependencies['@/lib/api/errors'],
    subject: loaded.subject,
    useMutation: dependencies['./useAdminMutation'].useAdminMutation,
    render: () => hooks.render(() =>
      expandTree(Component({ token: session.token, ...viewer, openTab: () => {} }), expand)),
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map((child) => find(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return Object.values(tree.props ?? {}).map((child) => find(child, predicate)).find(Boolean);
}
const byType = (tree, name) => find(tree, (node) => node.type === `@/components/${name}:default`);
const input = (tree, key, value) => find(tree, (node) => (node.type === '@/components/Input:Input' || node.type === './DateInput:default' || node.type === '../DateInput:default') && node.props[key] === value);
const button = (tree, label) => find(tree, (node) => node.type === '@/components/Button:default' && node.props.children === label);
const modal = (tree, title) => find(tree, (node) => node.type === '@/components/Modal:default' && node.props.title === title);
const change = (node, value) => node.props.onChange({ target: { value } });
const actionCell = (tree, row) => byType(tree, 'DataTable').props.columns.find((column) => column.actions).render(row);
/** The console's `<form>` (`AdminForm`), by its accessible name — its `aria-label`, or the heading its
 *  `aria-labelledby` names (G4-031); its `onSubmit` is what Enter and the submit button run. */
const adminForm = (tree, label) => find(tree, (node) =>
  typeof node.type === 'string' && node.type.endsWith('AdminForm:AdminForm') && (label === undefined || node.props['aria-label'] === label
    || (node.props['aria-labelledby'] && find(node, (child) => child.props?.id === node.props['aria-labelledby'] && child.props.children === label))));
const iconButton = (tree, label) => find(tree, (node) => node.type === '@/components/IconButton:default' && node.props['aria-label'] === label);

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
  }, { 'admin-users': usersOf([user]) }, { expand: ['WealthDialog'] });
  let tree = fx.render();
  fx.hooks.effects();
  button(actionCell(tree, user), '修改资产').props.onClick();
  tree = fx.render();
  const dialog = () => modal(fx.render(), '修改资产 · 测试用户');
  assert.equal(dialog().props.isOpen, true);
  assert.equal(input(dialog(), 'label', '增加金币的原因'), undefined, 'a reason is asked for once there is a change to explain');
  change(input(dialog(), 'label', '数值'), '25');
  assert.equal(input(dialog(), 'label', '数值').props.helper, '当前 20 → 修改后 45');
  change(input(dialog(), 'label', '增加金币的原因'), '活动奖励');

  const submit = adminForm(dialog(), '修改 测试用户 的资产').props.onSubmit;
  submit();
  submit();
  assert.equal(requests.length, 1, 'two submits before the busy render send one write');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), {
    target_id: 5, coins_op: 'add', coins_value: 25, reason: '活动奖励',
  }, 'the original console\'s body: coins only, a whole number, no experience when it did not change');
  assert.equal(input(dialog(), 'label', '增加金币的原因').props.readOnly, true);
  requests[0].resolve(Response.json({ success: false, error: '拒绝修改' }));
  await settle();
  assert.equal(dialog().props.isOpen, true);
  assert.equal(input(dialog(), 'label', '增加金币的原因').props.value, '活动奖励');
  assert.equal(fx.toasts.at(-1)[0], '拒绝修改');

  adminForm(dialog(), '修改 测试用户 的资产').props.onSubmit();
  requests[1].resolve(Response.json({ success: true }));
  await settle();
  assert.equal(dialog().props.isOpen, false);
  assert.deepEqual(fx.refreshes, ['admin-users']);
  assert.deepEqual(fx.toasts.at(-1), ['已更新「测试用户」的资产', 'success']);
  fx.hooks.dispose();
});

test('the wealth dialog refuses an empty change and a deduction below zero without sending', () => {
  const user = { id: 5, username: '测试用户', experience: 50, coins: 20 };
  const requests = [];
  const fx = fixture('WealthTab', {
    adminUpdateWealth: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
  }, { 'admin-users': usersOf([user]) }, { expand: ['WealthDialog'] });
  fx.render();
  fx.hooks.effects();
  button(actionCell(fx.render(), user), '修改资产').props.onClick();
  const dialog = () => modal(fx.render(), '修改资产 · 测试用户');
  adminForm(dialog()).props.onSubmit();
  assert.equal(requests.length, 0);
  assert.ok(find(dialog(), (node) => node.props?.role === 'alert'), 'nothing to change is said in the dialog');

  const op = find(dialog(), (node) => node.type === '@/components/Select:default' && node.props.label === '操作');
  op.props.onChange('sub');
  change(input(dialog(), 'label', '数值'), '30');
  change(input(dialog(), 'label', '扣除金币的原因'), '违规');
  adminForm(dialog()).props.onSubmit();
  assert.equal(requests.length, 0);
  assert.equal(input(dialog(), 'label', '数值').props.error, '扣除后金币为 -10，不能少于 0');

  change(input(dialog(), 'label', '设为'), '60');
  change(input(dialog(), 'label', '数值'), '');
  adminForm(dialog()).props.onSubmit();
  assert.equal(input(dialog(), 'label', '经验值变动的原因').props.error, '请填写经验值变动的原因');
  change(input(dialog(), 'label', '经验值变动的原因'), '补发');
  adminForm(dialog()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ target_id: 5, experience: 60, experience_reason: '补发' }]);
  fx.hooks.dispose();
});

test('renaming a filtered user keeps the closing editor mounted until exit completes', async () => {
  const user = { id: 7, username: 'Alice', email: 'a@example.test', role: 'user', is_banned: 0 };
  const otherUser = { ...user, id: 8, username: 'Carol', email: 'c@example.test' };
  const requests = [];
  const fx = fixture('UsersTab', {
    adminUpdateUser: (_, payload) => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; },
  }, { 'admin-users': usersOf([user, otherUser]) });
  let tree = fx.render();
  fx.hooks.effects();
  const search = () => find(fx.render(), (node) => node.type === '@/components/SearchInput:default');
  search().props.onChange('Alice');
  tree = fx.render();
  await iconButton(actionCell(tree, user), '编辑用户 Alice').props.onClick({ currentTarget: {} });
  const editor = () => {
    const table = byType(fx.render(), 'DataTable');
    return expandTree(table.props.expandedRow(table.props.rows.find((row) => row.id === 7)), ['UserEditor']);
  };
  assert.equal(input(editor(), 'id', 'users-inline-7-password').props.autoComplete, 'new-password',
    'the password field is a new password, so a manager does not fill the admin\'s own');
  change(input(editor(), 'id', 'users-inline-7-username'), 'Bob');
  adminForm(editor()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { target_id: 7, username: 'Bob' },
    'a save sends what changed, never the untouched fields');
  requests[0].resolve(Response.json({ success: true }));
  await settle();
  assert.deepEqual(fx.refreshes, ['admin-users'], 'the committed write refreshes before the editor closes');

  // The refreshed full list arrives before the closing animation finishes.
  const renamedUser = { ...user, username: 'Bob' };
  fx.data['admin-users'] = usersOf([renamedUser, otherUser]);
  tree = fx.render();
  const table = byType(tree, 'DataTable');
  assert.deepEqual(table.props.rows.map((row) => row.id), [7], 'only the closing row temporarily bypasses the old-name filter');
  const closing = table.props.expandedRow(table.props.rows[0]);
  assert.equal(closing.props.closing, true);
  assert.equal(expandTree(closing, ['UserEditor']).props.id, 'users-inline-7-editor');

  closing.props.onExitComplete();
  assert.equal(byType(fx.render(), 'DataTable').props.rows.length, 0, 'the old-name filter applies after exit');
  search().props.onChange('');
  tree = fx.render();
  assert.equal(byType(tree, 'DataTable').props.rows.length, 2);
  assert.equal(byType(tree, 'DataTable').props.expandedRow(renamedUser), null, 'clearing the filter cannot resurrect the closed editor');
  assert.deepEqual(fx.refreshes, ['admin-users'], 'closing does not send a duplicate refresh');
  fx.hooks.dispose();
});

test('the user editor validates what changed and sends nothing for an untouched form', async () => {
  const user = { id: 7, username: 'Alice', email: 'a@example.test', role: 'user', is_banned: 0, gender: 'male' };
  const requests = [];
  const fx = fixture('UsersTab', {
    adminUpdateUser: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
  }, { 'admin-users': usersOf([user]) });
  fx.render();
  fx.hooks.effects();
  await iconButton(actionCell(fx.render(), user), '编辑用户 Alice').props.onClick({ currentTarget: {} });
  const editor = () => {
    const table = byType(fx.render(), 'DataTable');
    return expandTree(table.props.expandedRow(user), ['UserEditor']);
  };
  const gender = find(editor(), (node) => node.type === '@/components/Select:default' && node.props.label === '性别');
  assert.equal(gender.props.value, '男', 'the old admin editor\'s spelling opens as the vocabulary users write');

  adminForm(editor()).props.onSubmit();
  assert.equal(requests.length, 0, 'an untouched form is not a request');
  assert.deepEqual(fx.toasts.at(-1), ['没有需要保存的修改', 'info']);

  await iconButton(actionCell(fx.render(), user), '编辑用户 Alice').props.onClick({ currentTarget: {} });
  change(input(editor(), 'id', 'users-inline-7-email'), 'not-an-address');
  change(input(editor(), 'id', 'users-inline-7-password'), 'short');
  adminForm(editor()).props.onSubmit();
  assert.equal(requests.length, 0);
  assert.ok(input(editor(), 'id', 'users-inline-7-email').props.error, 'the address is refused on its own field');
  assert.ok(input(editor(), 'id', 'users-inline-7-password').props.error, 'so is the password');
  fx.hooks.dispose();
});

test('ban and delete confirm by name, are not offered on the viewer\'s own row, and spin only the pressed button', async () => {
  const self = { id: 1, username: 'Root', email: 'r@example.test', role: 'super_admin', is_banned: 0 };
  const user = { id: 7, username: 'Alice', email: 'a@example.test', role: 'user', is_banned: 0 };
  const requests = [];
  const fx = fixture('UsersTab', {
    adminUpdateUser: (_, payload) => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; },
  }, { 'admin-users': usersOf([self, user]) });
  fx.render();
  fx.hooks.effects();
  const own = actionCell(fx.render(), self);
  assert.equal(iconButton(own, '封禁用户 Root'), undefined);
  assert.equal(iconButton(own, '删除用户 Root'), undefined);
  assert.ok(iconButton(own, '编辑用户 Root'));

  iconButton(actionCell(fx.render(), user), '封禁用户 Alice').props.onClick();
  assert.deepEqual(fx.asked.at(-1), {
    title: '确认封禁',
    message: '确定要封禁用户「Alice」（#7）吗？封禁后该用户将在所有设备上退出登录。',
    tone: 'danger',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { target_id: 7, is_banned: 1 });
  const row = actionCell(fx.render(), user);
  assert.equal(iconButton(row, '封禁用户 Alice').props.loading, true);
  assert.equal(iconButton(row, '删除用户 Alice').props.loading, false, 'a second action does not wear the first one\'s spinner');
  assert.equal(iconButton(row, '删除用户 Alice').props.disabled, true);
  requests[0].resolve(Response.json({ success: true }));
  await settle();
  assert.deepEqual(fx.data['admin-users'].rows.map((row) => row.is_banned), [0, 1]);
  assert.deepEqual(fx.toasts.at(-1), ['已封禁「Alice」（#7）', 'success']);
  fx.hooks.dispose();
});

test('notification failure retains the broadcast draft and HTTP errors cannot announce success', async () => {
  const requests = [];
  const fx = fixture('NotificationsTab', {
    adminSendNotification: (_, payload) => { const result = deferred(); requests.push({ payload, ...result }); return result.promise; },
  }, { 'admin-notifications': { rows: [], totalPages: 1, total: 0 } });
  let tree = fx.render();
  fx.hooks.effects();
  const audience = (value) => find(fx.render(), (node) => node.type === '@/components/Radio:default' && node.props.value === value);
  assert.equal(audience('all').props.checked, false, 'a broadcast is never the default audience');
  assert.equal(audience('user').props.checked, false);
  change(input(fx.render(), 'label', '通知标题'), ' 标题 ');
  change(find(fx.render(), (node) => node.type === '@/components/Input:Textarea'), ' 正文 ');
  adminForm(fx.render()).props.onSubmit();
  assert.equal(requests.length, 0, 'no audience chosen, nothing sent');
  assert.ok(find(fx.render(), (node) => node.props?.id === 'notifications-audience-error'));

  audience('all').props.onChange();
  const submit = () => adminForm(fx.render()).props.onSubmit();
  submit();
  submit();
  assert.equal(requests.length, 1);
  assert.deepEqual(fx.asked.at(-1), { title: '确认全站广播', message: '确定要向全站所有用户发送此通知吗？', tone: 'danger' });
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { user_id: 0, title: '标题', content: '正文', is_important: false });
  requests[0].resolve(Response.json({ success: true }, { status: 503 }));
  await settle();
  tree = fx.render();
  assert.equal(input(tree, 'label', '通知标题').props.value, ' 标题 ');
  assert.equal(audience('all').props.checked, true);
  assert.equal(fx.toasts.at(-1)[1], 'error');
  assert.equal(fx.refreshes.length, 0);
  submit();
  fx.hooks.dispose();
  requests[1].resolve(Response.json({ success: true }));
  await settle();
  assert.deepEqual(fx.refreshes, ['admin-notifications'], 'leaving the tab does not lose committed notification invalidation');
  assert.equal(fx.toasts.length, 1, 'the only toast belongs to the earlier visible failure');
});

test('a notification to one user names the recipient in its confirm and sends that id', async () => {
  const requests = [];
  const fx = fixture('NotificationsTab', {
    adminSendNotification: (_, payload) => { requests.push(payload); return Promise.resolve(Response.json({ success: true })); },
  }, { 'admin-notifications': { rows: [], totalPages: 1, total: 0 }, 'user-profile': { username: '小马' } });
  fx.render();
  fx.hooks.effects();
  find(fx.render(), (node) => node.type === '@/components/Radio:default' && node.props.value === 'user').props.onChange();
  change(input(fx.render(), 'label', '接收用户 ID'), '42');
  /* The lookup keys on the id once typing pauses. */
  fx.render();
  fx.hooks.effects();
  await new Promise((resolve) => setTimeout(resolve, 450));
  const field = input(fx.render(), 'label', '接收用户 ID');
  assert.equal(field.props.helper, '将发送给「小马」');
  assert.equal(fx.reads.filter((read) => read.name === 'user-profile' && read.args !== SKIP).at(-1).args.id, '42');
  change(input(fx.render(), 'label', '通知标题'), '审核通过');
  change(find(fx.render(), (node) => node.type === '@/components/Input:Textarea'), '您的稿件已通过');
  find(fx.render(), (node) => node.type === '@/components/ToggleSwitch:default').props.onChange(true);
  adminForm(fx.render()).props.onSubmit();
  assert.deepEqual(fx.asked.at(-1), {
    title: '确认发送通知',
    message: '确定要向用户「小马」（#42）发送此通知吗？\n通知还会以邮件发给该用户。',
    tone: 'filled',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ user_id: 42, title: '审核通过', content: '您的稿件已通过', is_important: true }]);
  await settle();
  assert.deepEqual(fx.toasts.at(-1), ['已发送通知', 'success']);
  assert.equal(input(fx.render(), 'label', '通知标题').props.value, '', 'a sent form starts over');
  fx.hooks.dispose();
});

test('a badge grant sends the original console body, and the link list is read only once its pane is opened', async () => {
  const grants = [];
  const links = [];
  const toggles = [];
  const fx = fixture('BadgesTab', {
    adminGrantBadge: (_, payload) => { grants.push(payload); return Promise.resolve(Response.json({ success: true, message: '成功为 3 位用户授予徽章' })); },
    adminCreateBadgeLink: (_, payload) => { links.push(payload); return Promise.resolve(Response.json({ success: true })); },
    adminToggleBadgeLink: (...args) => { toggles.push(args.slice(1)); return Promise.resolve(Response.json({ success: true })); },
  }, {
    'admin-badge-links': [{ id: 4, token: 't0k', badge_name: '元老', badge_color: '#f1c40f', is_active: 1, badge_expires_at: '2026-12-31', link_expires_at: null }],
  }, { expand: ['GrantPane', 'LinksPane'] });
  fx.render();
  fx.hooks.effects();
  const linkReads = () => fx.reads.filter((read) => read.name === 'admin-badge-links');
  assert.ok(linkReads().every((read) => read.args === SKIP), 'nothing reads the links while 授予徽章 is shown');
  const header = () => find(fx.render(), (node) => node.type === './SectionHeader:default');
  assert.equal(header().props.onRefresh, undefined, 'no refresh that would refresh nothing');
  const linkTable = () => find(fx.render(), (node) => node.type === '@/components/DataTable:default');
  assert.equal(linkTable().props.loading, true, 'an unopened link list is its skeleton, never 暂无领取链接');

  const grant = () => adminForm(fx.render(), '授予徽章');
  change(input(grant(), 'label', '徽章名称'), ' 元老 ');
  change(input(grant(), 'label', '用户 ID'), '1, 2，5 x');
  grant().props.onSubmit();
  assert.equal(grants.length, 0);
  assert.equal(input(grant(), 'label', '用户 ID').props.error, '用户 ID 须为正整数，用逗号分隔');
  change(input(grant(), 'label', '用户 ID'), '1, 2，5 2');
  grant().props.onSubmit();
  assert.deepEqual(fx.asked.at(-1), { title: '确认授予徽章', message: '确定要向 3 位用户授予徽章「元老」吗？', tone: 'filled' });
  assert.deepEqual(JSON.parse(JSON.stringify(grants)), [{
    badge_name: '元老', badge_color: '#f1c40f', target_user_ids: '1,2,5', start_date: '', end_date: '', expires_at: '',
  }]);
  await settle();
  assert.deepEqual(fx.toasts.at(-1), ['已授予徽章「元老」', 'success']);

  find(fx.render(), (node) => node.type === '@/components/Radio:default' && node.props.value === 'dates').props.onChange();
  find(fx.render(), (node) => node.type === '@/components/Radio:default' && node.props.value === 'expiring').props.onChange();
  change(input(grant(), 'label', '徽章名称'), '周年');
  change(input(grant(), 'label', '注册起始日期'), '2025-01-01');
  change(input(grant(), 'label', '注册截止日期'), '2025-06-30');
  change(input(grant(), 'label', '到期日期'), '2026-12-31');
  grant().props.onSubmit();
  assert.equal(fx.asked.at(-1).tone, 'danger', 'a grant to everyone registered in a window is a wide action');
  assert.deepEqual(JSON.parse(JSON.stringify(grants.at(-1))), {
    badge_name: '周年', badge_color: '#f1c40f', target_user_ids: '', start_date: '2025-01-01', end_date: '2025-06-30', expires_at: '2026-12-31',
  });
  await settle();

  find(fx.render(), (node) => node.type === '@/components/Tabs:default').props.onChange('links');
  fx.render();
  assert.equal(linkReads().at(-1).args, 'account-A', 'opening 领取链接 starts its read');
  assert.equal(typeof header().props.onRefresh, 'function');
  const row = fx.data['admin-badge-links'][0];
  const expiry = linkTable().props.columns.find((column) => column.key === 'expiry').render(row);
  assert.equal(expiry.props.children, '链接：永久 · 徽章：2026/12/31', 'both expiries are spelled out');
  const state = linkTable().props.columns.find((column) => column.key === 'state').render(row);
  assert.equal(state.type, '@/components/Badge:default', 'state is a mark, not a control');

  button(actionCell(fx.render(), row), '停用').props.onClick();
  assert.equal(fx.asked.at(-1).title, '确认停用链接');
  assert.deepEqual(toggles, [[4, 0]]);
  await settle();
  assert.equal(fx.data['admin-badge-links'][0].is_active, 0);

  const refreshesBefore = fx.refreshes.length;
  const create = () => adminForm(fx.render(), '生成领取链接');
  change(input(create(), 'label', '徽章名称'), '活动');
  change(input(create(), 'label', '领取地区限制'), ' 江苏 ');
  create().props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(links)), [{
    badge_name: '活动', badge_color: '#e74c3c', badge_expires_at: '', link_expires_at: '', required_location: '江苏', location_error_msg: '',
  }]);
  await settle();
  assert.deepEqual(fx.refreshes.slice(refreshesBefore), ['admin-badge-links'], 'a new link is read back into the list');
  fx.hooks.dispose();
});

test('message audit waits for an explicit query, isolates accounts and forwards cancellation', async () => {
  const calls = [];
  const fx = fixture('MessagesAuditTab', {
    adminGetAllMessages: async (...args) => { calls.push(args); return { success: true, messages: [] }; },
  });
  let tree = fx.render();
  assert.equal(fx.reads.at(-1).args, SKIP);
  assert.equal(find(tree, (node) => node.type === './SectionHeader:default').props.onRefresh, undefined,
    'before a query there is nothing to refresh — the header read the whole site once');
  const searchForm = () => find(fx.render(), (node) => node.type === 'form' && node.props.role === 'search');
  change(input(tree, 'aria-label', '审计用户 ID'), 'x');
  searchForm().props.onSubmit({ preventDefault() {} });
  assert.equal(fx.reads.at(-1).args, SKIP, 'a malformed id reads nothing');
  assert.equal(input(fx.render(), 'aria-label', '审计用户 ID').props.error, '请输入有效的用户 ID');
  change(input(fx.render(), 'aria-label', '审计用户 ID'), '8');
  searchForm().props.onSubmit({ preventDefault() {} });
  tree = fx.render();
  assert.equal(fx.reads.at(-1).args.userId, 8, 'Enter in the field is the search');
  const resource = fx.resources.get('admin-message-audit');
  const controller = new AbortController();
  await resource.fetch(fx.reads.at(-1).args, controller.signal);
  assert.equal(calls[0][1], 8);
  assert.equal(calls[0][2], controller.signal);
  searchForm().props.onSubmit({ preventDefault() {} });
  assert.equal(fx.refreshes.length, 1, 'repeating the submitted query refreshes it');
  button(fx.render(), '查看全站私信').props.onClick();
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
  const first = button(actionCell(tree, reports[0]), '处理').props.onClick();
  const search = () => find(fx.render(), (node) => node.type === '@/components/SearchInput:default');
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

test('team import fills the form from the account, and an obsolete answer cannot overwrite what was typed since', async () => {
  const profileReads = [];
  const fx = fixture('TeamTab', {
    userProfileRead: (args) => { const result = deferred(); profileReads.push({ args, ...result }); return result.promise; },
  }, { 'admin-team': [] }, { expand: ['TeamMemberForm'] });
  fx.render();
  fx.hooks.effects();
  const form = () => adminForm(fx.render(), '添加团队成员');
  change(input(form(), 'label', '关联站内用户 ID'), '5');
  button(form(), '导入资料').props.onClick();
  assert.equal(profileReads.length, 1);
  assert.equal(profileReads[0].args.id, '5');
  assert.equal(button(form(), '导入资料').props.loading, true);
  change(input(form(), 'label', '成员姓名'), '手动输入');
  assert.equal(button(form(), '导入资料').props.loading, false, 'typing over the import makes it obsolete');
  profileReads[0].resolve({ id: 5, username: '旧查询', avatar: 'old.png', role: 'admin' });
  await settle();
  assert.equal(input(form(), 'label', '成员姓名').props.value, '手动输入');
  assert.equal(fx.toasts.length, 0);

  button(form(), '导入资料').props.onClick();
  profileReads[1].resolve({ id: 5, username: '小明', avatar: 'uploads/a.png', role: 'admin' });
  await settle();
  assert.equal(input(form(), 'label', '成员姓名').props.value, '小明');
  assert.equal(input(form(), 'label', '头衔').props.value, '管理员');
  assert.equal(find(form(), (node) => node.type === '@/components/Select:default' && node.props.label === '栏目').props.value, 'manager');
  assert.equal(input(form(), 'label', '备用头像链接').props.value, 'uploads/a.png');
  assert.deepEqual(fx.toasts.at(-1), ['已导入「小明」的资料', 'success']);

  change(input(form(), 'label', '关联站内用户 ID'), '99');
  button(form(), '导入资料').props.onClick();
  profileReads[2].reject(new fx.errors.ApiError('http', { status: 404 }));
  await settle();
  assert.equal(input(form(), 'label', '关联站内用户 ID').props.error, '没有 ID 为 99 的用户', 'an unknown account is said on its field');

  button(form(), '导入资料').props.onClick();
  fx.hooks.dispose();
  profileReads[3].reject(new Error('late failure'));
  await settle();
  assert.equal(fx.toasts.length, 1, 'a form that has gone says nothing');
});

test('a team save refreshes the public roster after leaving its editor but cannot affect another account', async () => {
  for (const changeAccount of [false, true]) {
    const response = deferred();
    const payloads = [];
    const fx = fixture('TeamTab', {
      addTeamMember: (_, payload) => { payloads.push(payload); return response.promise; },
    }, { 'admin-team': [] }, { expand: ['TeamMemberForm'] });
    fx.render();
    fx.hooks.effects();
    change(input(adminForm(fx.render(), '添加团队成员'), 'label', '成员姓名'), ' 新成员 ');
    adminForm(fx.render(), '添加团队成员').props.onSubmit();
    assert.deepEqual(JSON.parse(JSON.stringify(payloads)), [{
      name: '新成员', role: '', category: 'developer', user_id: 0, avatar_url: '', link_url: '', order_num: 0,
    }], 'the original console body: user_id 0 and empty strings for what is not set');
    fx.hooks.dispose();
    if (changeAccount) fx.session.token = 'account-B';
    response.resolve(Response.json({ success: true }));
    await settle();
    assert.equal(fx.refreshes.includes('team-members'), !changeAccount);
    assert.equal(fx.refreshes.includes('admin-team'), !changeAccount);
    assert.equal(fx.toasts.length, 0);
  }
});

test('a member is edited under its row; binding an account links the card, an external link survives otherwise', async () => {
  const member = { id: 3, name: '老成员', role: '画师', category: 'special', user_id: 0, avatar_url: '', link_url: 'https://example.test/me', order_num: 2 };
  const payloads = [];
  const fx = fixture('TeamTab', {
    updateTeamMember: (_, payload) => { payloads.push(payload); return Promise.resolve(Response.json({ success: true })); },
  }, { 'admin-team': [member] });
  fx.render();
  fx.hooks.effects();
  await iconButton(actionCell(fx.render(), member), '编辑成员 老成员').props.onClick({ currentTarget: {} });
  const editor = () => expandTree(byType(fx.render(), 'DataTable').props.expandedRow(member), ['TeamMemberForm']);
  assert.equal(editor().props.id, 'team-inline-3-editor');
  change(input(editor(), 'label', '排序号'), '1.5');
  adminForm(editor()).props.onSubmit();
  assert.equal(payloads.length, 0);
  assert.equal(input(editor(), 'label', '排序号').props.error, '排序号须为整数');
  change(input(editor(), 'label', '排序号'), '-1');
  adminForm(editor()).props.onSubmit();
  assert.equal(payloads.at(-1).link_url, 'https://example.test/me', 'no account bound: the stored link is kept');
  assert.equal(payloads.at(-1).order_num, -1);
  await settle();

  await iconButton(actionCell(fx.render(), member), '编辑成员 老成员').props.onClick({ currentTarget: {} });
  change(input(editor(), 'label', '关联站内用户 ID'), '9');
  adminForm(editor()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(payloads.at(-1))), {
    name: '老成员', role: '画师', category: 'special', user_id: 9, avatar_url: '', link_url: 'user:9', order_num: -1, id: 3,
  });
  await settle();
  assert.deepEqual(fx.toasts.at(-1), ['已保存成员「老成员」', 'success']);
  assert.ok(fx.refreshes.includes('team-members'), '/about reads the roster again');
  fx.hooks.dispose();
});

test('a shop item is refused on its own fields, saved with the original console body, and edited under its row', async () => {
  const item = { id: 6, name: '改名卡', description: '', image_url: 'uploads/shop/a.png', price: 30, stock: 4, active: 1 };
  const payloads = [];
  const fx = fixture('ShopTab', {
    adminSaveShopItem: (_, payload) => { payloads.push(payload); return Promise.resolve(Response.json({ success: true })); },
  }, { 'admin-shop': [item] }, { expand: ['ShopItemForm'] });
  fx.render();
  fx.hooks.effects();
  const form = () => adminForm(fx.render(), '添加商品');
  change(input(form(), 'label', '价格（金币）'), '');
  change(input(form(), 'label', '库存'), '1.5');
  form().props.onSubmit();
  assert.equal(payloads.length, 0, 'a malformed number is no longer sent as 0');
  assert.equal(input(form(), 'label', '商品名称').props.error, '请填写商品名称');
  assert.equal(input(form(), 'label', '价格（金币）').props.error, '价格须为不小于 0 的整数');
  assert.equal(input(form(), 'label', '库存').props.error, '库存须为不小于 0 的整数');
  change(input(form(), 'label', '商品名称'), '头像框');
  change(input(form(), 'label', '价格（金币）'), '12');
  change(input(form(), 'label', '库存'), '0');
  form().props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(payloads)), [{
    id: 0, name: '头像框', description: '', image_url: '', price: 12, stock: 0, active: 1,
  }]);
  await settle();
  assert.deepEqual(fx.toasts.at(-1), ['已添加商品「头像框」', 'success']);
  assert.deepEqual(fx.refreshes, ['admin-shop', 'shop-items'], 'the shop page reads its list again too');

  const price = byType(fx.render(), 'DataTable').props.columns.find((column) => column.key === 'price').render(item);
  assert.ok(!JSON.stringify(price).includes('text-warning'), 'a price is not a severity');
  await iconButton(actionCell(fx.render(), item), '编辑商品 改名卡').props.onClick({ currentTarget: {} });
  const editor = () => expandTree(byType(fx.render(), 'DataTable').props.expandedRow(item), ['ShopItemForm']);
  find(editor(), (node) => node.type === '@/components/Checkbox:default').props.onChange(false);
  adminForm(editor()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(payloads.at(-1))), {
    id: 6, name: '改名卡', description: '', image_url: 'uploads/shop/a.png', price: 30, stock: 4, active: 0,
  });
  fx.hooks.dispose();
});

async function openGlossary(fx) {
  fx.render();
  fx.hooks.effects();
  await flush();
  return fx.render();
}
const glossaryTags = [1, 2].map((id) => ({
  id, en: `tag-${id}`, cn: id === 1 ? '标签' : '', cat: 'general', count: 0, description: '', aliases: [], is_restricted: 1,
}));
const glossaryData = (tags = glossaryTags) => ({ 'admin-dictionary': { tags, total: tags.length, stats: { total: 10, translated: 4, leaderboard: [] } } });
const dialog = (tree, name) => find(tree, (node) => node.type === `./${name}:default`);

test('a new tag is checked against the dictionary, and a confirmed save clears tag lookups once', async () => {
  const saves = [];
  let exists = true;
  const fx = fixture('glossary/GlossaryTab', {
    checkTagExists: async () => exists,
    saveDictionaryTag: (_, payload) => { const result = deferred(); saves.push({ payload, ...result }); return result.promise; },
  }, glossaryData());
  fx.dictionaryCache.set('missing-tag', null);
  let tree = await openGlossary(fx);
  button(tree, '添加新标签').props.onClick();
  assert.equal(dialog(fx.render(), 'CreateTagDialog').props.open, true);
  const form = { en: ' Missing-Tag ', translations: '缺失, 别名', cat: 'general', count: 3, description: '' };
  dialog(fx.render(), 'CreateTagDialog').props.onSave(form);
  await settle();
  assert.equal(saves.length, 0, 'a tag the dictionary holds is not written again');
  assert.equal(dialog(fx.render(), 'CreateTagDialog').props.duplicate, 'missing-tag', 'and the field says so');

  exists = false;
  dialog(fx.render(), 'CreateTagDialog').props.onSave(form);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].payload)), {
    en: 'missing-tag', cn: '缺失', aliases: ['别名'], cat: 'general', count: 3, description: '',
    is_restricted: 0, is_original_translation: 0, is_sensitive: 0,
  });
  saves[0].resolve(Response.json({ success: false, error: '保存被拒绝' }));
  await settle();
  assert.equal(fx.dictionaryCache.size, 1, 'a rejected save leaves the lookups alone');
  assert.equal(dialog(fx.render(), 'CreateTagDialog').props.open, true);
  dialog(fx.render(), 'CreateTagDialog').props.onSave(form);
  await settle();
  saves[1].resolve(Response.json({ success: true }));
  await settle();
  assert.equal(fx.dictionaryCache.size, 0, 'cached misses are stale once the tag exists');
  assert.equal(fx.refreshes.filter((name) => name === 'dictionary-tag').length, 1);
  assert.equal(dialog(fx.render(), 'CreateTagDialog').props.open, false);
  assert.deepEqual(fx.toasts.at(-1), ['已添加标签「missing-tag」', 'success']);
  fx.hooks.dispose();
});

test('an edit carries the row flags through, writes an untranslated name as empty, and reads the list again after closing', async () => {
  const saves = [];
  const fx = fixture('glossary/GlossaryTab', {
    saveDictionaryTag: (_, payload) => { saves.push(payload); return Promise.resolve(Response.json({ success: true })); },
  }, glossaryData());
  let tree = await openGlossary(fx);
  await iconButton(actionCell(tree, glossaryTags[0]), '编辑标签 tag-1').props.onClick({ currentTarget: {} });
  const editor = () => byType(fx.render(), 'DataTable').props.expandedRow(glossaryTags[0]);
  assert.equal(editor().type.name, 'TagEditor');
  editor().props.onSave({
    id: 1, en: 'tag-1', cn: '', aliases: [], cat: 'general', count: 0, description: '',
    is_restricted: 1, is_original_translation: 0, is_sensitive: 0,
  });
  await settle();
  assert.equal(saves.length, 1);
  assert.equal(editor().props.closing, true);
  assert.equal(fx.data['admin-dictionary'].tags[0].cn, '', 'the row shows what was saved at once');
  const before = fx.refreshes.filter((name) => name === 'admin-dictionary').length;
  editor().props.onExitComplete();
  assert.equal(fx.refreshes.filter((name) => name === 'admin-dictionary').length, before + 1, 'and is read again once the editor has gone');
  fx.hooks.dispose();
});

test('the editor sends the original body: flags kept, no translation is empty', () => {
  const model = load('components/admin/glossary/model.ts', plainModules);
  const tag = { id: 7, en: 'pony', cn: '未翻译', aliases: [], cat: 'species', count: 5, description: '', is_restricted: 1, is_sensitive: '1' };
  const form = model.tagFormOf(tag);
  assert.equal(form.translations, '', '未翻译 is no translation, not a name');
  assert.deepEqual(JSON.parse(JSON.stringify(model.tagSavePayload({ ...form, translations: '小马，马 , 小马' }, tag))), {
    en: 'pony', cn: '小马', aliases: ['马'], cat: 'species', count: 5, description: '',
    is_restricted: 1, is_original_translation: 0, is_sensitive: 1, id: 7,
  });
  assert.equal(model.tagSavePayload(form, tag).cn, '');
  assert.equal(model.exportText([tag, { ...tag, en: 'zebra', cn: '斑马', aliases: ['马'] }]), '# pony =\nzebra = 斑马, 马');
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.parseImport(model.exportText([{ ...tag, cn: '小马', aliases: ['马'] }])).tasks)),
    [{ en: 'pony', cn: '小马', aliases: ['马'], cat: 'general', count: 0, description: '' }],
    'an export imports again',
  );
  assert.equal(model.historyTime('2026-09-30 16:30:00'), '2026/10/01 00:30', 'history times are UTC');
  assert.equal(model.pageSizeOf('150'), 150);
  assert.equal(model.pageSizeOf('15'), 100);
});

for (const operation of ['import', 'delete', 'sync']) {
  test(`glossary bulk ${operation} is one write and invalidates tag lookups once`, async () => {
    const writes = [];
    const answer = (body) => (...args) => { writes.push(args.slice(1)); return Promise.resolve(Response.json({ success: true, ...body })); };
    const fx = fixture('glossary/GlossaryTab', {
      batchImportDictionaryTags: answer({ created: 2, skipped: 0, failed: 0 }),
      batchDeleteDictionaryTags: answer({ deleted_count: 2 }),
    }, glossaryData());
    fx.dictionaryCache.set('missing-tag', null);
    let tree = await openGlossary(fx);
    if (operation === 'import') {
      dialog(tree, 'BatchImportDialog').props.onImport([
        { en: 'tag-one', cn: '标签一', aliases: [], cat: 'general', count: 0, description: '' },
        { en: 'tag-two', cn: '标签二', aliases: [], cat: 'general', count: 0, description: '' },
      ]);
      assert.equal(fx.asked.at(-1).title, '确认批量导入');
      await settle();
      assert.deepEqual(fx.toasts.at(-1), ['已导入 2 个标签', 'success']);
    } else if (operation === 'delete') {
      byType(tree, 'DataTable').props.columns.find((column) => column.key === 'select').header.props.onChange();
      button(fx.render(), '批量删除（2）').props.onClick();
      assert.equal(fx.asked.at(-1).message, '确定要永久删除选中的 2 个标签吗？此操作无法恢复。');
      await settle();
      assert.deepEqual(JSON.parse(JSON.stringify(writes)), [[[1, 2]]], 'one request names every id');
      assert.equal(button(fx.render(), '批量删除（2）'), undefined, 'the selection is gone with the rows');
    } else {
      dialog(tree, 'SyncDialog').props.onFinished({ created: 2, skipped: 3, failedTags: 0, failedPages: 0, stopped: false });
      assert.deepEqual(fx.toasts.at(-1), ['已同步：新增 2 个，跳过 3 个', 'success']);
    }
    if (operation !== 'sync') assert.equal(writes.length, 1);
    assert.equal(fx.dictionaryCache.size, 0);
    assert.equal(fx.refreshes.filter((name) => name === 'dictionary-tag').length, 1);
    assert.ok(fx.refreshes.includes('admin-dictionary'), 'the list is read again');
    fx.hooks.dispose();
  });
}

test('a bulk write confirmed after leaving the glossary still invalidates lookup caches', async () => {
  const response = deferred();
  const fx = fixture('glossary/GlossaryTab', { batchImportDictionaryTags: () => response.promise }, glossaryData());
  const tree = await openGlossary(fx);
  dialog(tree, 'BatchImportDialog').props.onImport([{ en: 'new-tag', cn: '新词', aliases: [], cat: 'general', count: 0, description: '' }]);
  await flush();
  fx.hooks.dispose();
  fx.dictionaryCache.set('new-tag', null);
  response.resolve(Response.json({ success: true, created: 1, skipped: 0, failed: 0 }));
  await settle();
  assert.equal(fx.dictionaryCache.has('new-tag'), false);
  assert.equal(fx.toasts.length, 0, 'an unmounted editor does not show a completion toast');
});

test('handling a feedback opens its tag under its row, and saving the tag closes the feedback', async () => {
  const handled = [];
  const fx = fixture('glossary/GlossaryTab', {
    saveDictionaryTag: () => Promise.resolve(Response.json({ success: true })),
    handleTagFeedback: (...args) => { handled.push(args.slice(1)); return Promise.resolve(Response.json({ success: true })); },
  }, glossaryData());
  await openGlossary(fx);
  const feedback = { id: 31, tag_name: 'TAG-2', content: '缺少翻译\n建议的正确翻译：标签二', username: '访客', status: 'pending', created_at: '2026-10-01 08:00:00' };
  dialog(fx.render(), 'FeedbackDialog').props.onHandle(feedback);
  assert.equal(find(fx.render(), (node) => node.type === '@/components/SearchInput:default').props.value, 'TAG-2');
  fx.hooks.effects();
  await new Promise((resolve) => setTimeout(resolve, 450));
  const editor = byType(fx.render(), 'DataTable').props.expandedRow(glossaryTags[1]);
  assert.equal(editor?.type.name, 'TagEditor', 'the filtered list opens the tag the feedback names');
  assert.equal(editor.props.workOrder.id, 31);
  editor.props.onSave({ id: 2, en: 'tag-2', cn: '标签二', aliases: [], cat: 'general', count: 0, description: '' });
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(handled)), [[31, 'processed', '已采纳并写入词库', 'pending']]);
  assert.ok(fx.refreshes.includes('admin-tag-feedback'), 'the queue reads again');
  fx.hooks.dispose();
});

test('a malformed admin list fails its own tab with a named message, never the whole console', () => {
  const fx = fixture();
  assert.throws(() => fx.queries.adminList({ success: true, users: {} }, 'users', '用户列表'), /用户列表加载失败/);
  assert.throws(() => fx.queries.adminList({ success: true, reports: 'x' }, 'reports', '举报'), /举报加载失败/);
  assert.throws(() => fx.queries.adminList({ success: false, error: '无权限' }, 'users', '用户列表'), /无权限/);
  assert.throws(() => fx.queries.adminList({ success: false }, 'users', '用户列表'), /用户列表加载失败/);
  assert.deepEqual(fx.queries.adminList({ success: true, users: [{ id: 1 }, null, 3] }, 'users', '用户列表'), [{ id: 1 }]);
  assert.deepEqual(
    fx.queries.adminList({ success: true, data: { links: [{ id: 2 }] } }, ['data.links', 'links'], '徽章链接'),
    [{ id: 2 }],
  );
  assert.deepEqual(fx.queries.adminList({ success: true, links: [{ id: 3 }] }, ['data.links', 'links'], '徽章链接'), [{ id: 3 }]);
});


test('leaving during a new tag existence read never sends the following save', async () => {
  const checked = deferred();
  let writes = 0;
  const fx = fixture('glossary/GlossaryTab', {
    checkTagExists: () => checked.promise,
    saveDictionaryTag: async () => { writes++; return Response.json({ success: true }); },
  }, glossaryData());
  await openGlossary(fx);
  dialog(fx.render(), 'CreateTagDialog').props.onSave({ en: 'pony', translations: '', cat: 'general', count: 0, description: '' });
  fx.hooks.dispose();
  checked.resolve(false);
  await settle();
  assert.equal(writes, 0);
  assert.equal(fx.toasts.length, 0);
});

test('role choices preserve current values and restrict self, administrator and founder changes', () => {
  const rules = load('components/admin/users/rules.ts', plainModules);
  const founder = { id: 2, role: 'super_admin' };
  assert.ok(rules.roleChoice(founder, founder).locked);
  assert.ok(rules.roleChoice(founder, { id: 3, role: 'super_admin' }).locked);
  assert.ok(rules.roleChoice({ id: 4, role: 'admin' }, { id: 5, role: 'admin' }).locked);
  assert.equal(rules.roleChoice({ id: 1, role: 'super_admin' }, founder).locked, null);
  const ordinary = rules.roleChoice({ id: 4, role: 'admin' }, { id: 5, role: 'user' });
  assert.equal(ordinary.options.some((option) => option.value === 'admin'), false);
  const initial = rules.initialUserForm({ id: 5, username: 'Name', role: 'user', gender: 'male' });
  assert.equal(initial.gender, '男');
  assert.equal(rules.userUpdatePayload({ id: 5, username: 'Name', role: 'user', gender: 'male' }, initial, true), null);
});

test('a long unpaged response renders one page and resets pagination when its filter changes', () => {
  const fx = fixture('WealthTab', {}, { 'admin-users': usersOf(Array.from({ length: 120 }, (_, i) => ({ id: i + 1, username: `user-${i}`, experience: 0, coins: 0 }))) });
  let tree = fx.render();
  assert.equal(byType(tree, 'DataTable').props.rows.length, 50);
  const pager = find(tree, (node) => node.type?.name === 'AdminPager');
  pager.props.onPageChange(3);
  tree = fx.render();
  assert.equal(byType(tree, 'DataTable').props.rows[0].id, 101);
  byType(tree, 'SearchInput').props.onChange('user-1');
  tree = fx.render();
  assert.equal(find(tree, (node) => node.type?.name === 'AdminPager').props.page, 1);
  fx.hooks.dispose();
});

test('glossary bulk toasts say only the counts that arrived — never an invented 0', async () => {
  const imports = [];
  const fx = fixture('glossary/GlossaryTab', {
    batchImportDictionaryTags: async () => { imports.push(1); return Response.json(imports.length === 1 ? { success: true } : { success: true, created: 2, skipped: 1 }); },
  }, glossaryData());
  const tree = await openGlossary(fx);
  const task = { en: 'new-tag', cn: '新词', aliases: [], cat: 'general', count: 0, description: '' };
  dialog(tree, 'BatchImportDialog').props.onImport([task]);
  await settle();
  assert.equal(fx.toasts.at(-1)[0], '已完成导入', 'no counts: the import is known, its size is not');
  assert.equal(fx.toasts.at(-1)[1], 'success', 'an absent `failed` is none reported');
  dialog(fx.render(), 'BatchImportDialog').props.onImport([task]);
  await settle();
  assert.equal(fx.toasts.at(-1)[0], '已导入 2 个标签，跳过 1 个已有的标签');
  fx.hooks.dispose();
});

// ---------------------------------------------------------------------------------------------
// Review part 6 (`part6-review.md`): regressions that need this file's panel harness. The pure and
// route-level cases are in `testReviewPart6.mjs`.
// ---------------------------------------------------------------------------------------------

test('review P6-F2: a feedback closes only when its own tag is saved, never on a neighbour or an unrelated add', async () => {
  const handled = [];
  const fx = fixture('glossary/GlossaryTab', {
    saveDictionaryTag: () => Promise.resolve(Response.json({ success: true })),
    checkTagExists: async () => false,
    handleTagFeedback: (...args) => { handled.push(args.slice(1)); return Promise.resolve(Response.json({ success: true })); },
  }, glossaryData());
  await openGlossary(fx);
  const feedback = { id: 31, tag_name: 'TAG-2', content: '建议的正确翻译：标签二', username: '访客', status: 'pending', created_at: '2026-10-01 08:00:00' };
  dialog(fx.render(), 'FeedbackDialog').props.onHandle(feedback);
  fx.hooks.effects();
  await new Promise((resolve) => setTimeout(resolve, 450));
  /* The search the feedback opened (a substring match) also lists tag-1; the operator saves that one. */
  await iconButton(actionCell(fx.render(), glossaryTags[0]), '编辑标签 tag-1').props.onClick({ currentTarget: {} });
  const neighbour = byType(fx.render(), 'DataTable').props.expandedRow(glossaryTags[0]);
  assert.equal(neighbour.props.workOrder, null, 'the neighbour does not offer the feedback');
  neighbour.props.onSave({ id: 1, en: 'tag-1', cn: '标签', aliases: [], cat: 'general', count: 0, description: '改了简介' });
  await settle();
  assert.deepEqual(handled, [], 'saving another tag leaves the feedback pending');

  /* Nor does adding an unrelated tag through 添加新标签. */
  button(fx.render(), '添加新标签').props.onClick();
  assert.equal(dialog(fx.render(), 'CreateTagDialog').props.workOrder, null, 'an unprefilled add is not the feedback');
  dialog(fx.render(), 'CreateTagDialog').props.onSave({ en: 'other-tag', translations: '别的', cat: 'general', count: 0, description: '' });
  await settle();
  assert.deepEqual(handled, [], 'adding another tag leaves the feedback pending');

  /* Saving the tag it names closes it. */
  const own = byType(fx.render(), 'DataTable').props.expandedRow(glossaryTags[1])
    ?? (await iconButton(actionCell(fx.render(), glossaryTags[1]), '编辑标签 tag-2').props.onClick({ currentTarget: {} }), byType(fx.render(), 'DataTable').props.expandedRow(glossaryTags[1]));
  own.props.onSave({ id: 2, en: 'tag-2', cn: '标签二', aliases: [], cat: 'general', count: 0, description: '' });
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(handled)), [[31, 'processed', '已采纳并写入词库', 'pending']]);
  fx.hooks.dispose();
});

test('review P6-F4: the user editor holds a changed API key to the shared 20-character rule, and lets an unbind through', async () => {
  const user = { id: 7, username: 'Alice', email: 'a@example.test', role: 'user', is_banned: 0, api_key: 'legacy key with spaces' };
  const requests = [];
  const fx = fixture('UsersTab', {
    adminUpdateUser: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
  }, { 'admin-users': usersOf([user]) });
  fx.render();
  fx.hooks.effects();
  await iconButton(actionCell(fx.render(), user), '编辑用户 Alice').props.onClick({ currentTarget: {} });
  const editor = () => {
    const table = byType(fx.render(), 'DataTable');
    return expandTree(table.props.expandedRow(user), ['UserEditor']);
  };
  /* An untouched legacy key is not re-validated: the account stays editable. */
  change(input(editor(), 'id', 'users-inline-7-username'), 'Alicia');
  adminForm(editor()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), { target_id: 7, username: 'Alicia' });
  requests.length = 0;
  fx.hooks.dispose();

  const fx2 = fixture('UsersTab', {
    adminUpdateUser: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
  }, { 'admin-users': usersOf([user]) });
  fx2.render();
  fx2.hooks.effects();
  await iconButton(actionCell(fx2.render(), user), '编辑用户 Alice').props.onClick({ currentTarget: {} });
  const editor2 = () => expandTree(byType(fx2.render(), 'DataTable').props.expandedRow(user), ['UserEditor']);
  for (const bad of ['abcdefghij+lmnopqrst', 'abcdefghij.lmnopqrst', 'short', 'abcdefghijklmnopqrstu']) {
    change(input(editor2(), 'id', 'users-inline-7-api-key'), bad);
    adminForm(editor2()).props.onSubmit();
    assert.equal(requests.length, 0, `${bad} is refused before sending`);
    assert.match(input(editor2(), 'id', 'users-inline-7-api-key').props.error, /20 位/);
  }
  change(input(editor2(), 'id', 'users-inline-7-api-key'), 'aB3_-aB3_-aB3_-aB3_-');
  adminForm(editor2()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), { target_id: 7, api_key: 'aB3_-aB3_-aB3_-aB3_-' });
  fx2.hooks.dispose();
});

test('review P6-F5: a server-paged list moves off a page it no longer has', async () => {
  const fx = fixture('NotificationsTab', {}, { 'admin-notifications': { rows: [{ id: 1, user_id: 0, title: 't', content: 'c', created_at: '2026-10-01 08:00:00' }], totalPages: 2, total: 21 } });
  fx.render();
  fx.hooks.effects();
  const pager = () => find(fx.render(), (node) => node.type?.name === 'AdminPager');
  pager().props.onPageChange(2);
  fx.render();
  assert.equal(fx.reads.filter((read) => read.name === 'admin-notifications').at(-1).args.page, 2);
  /* The last notice on page 2 is deleted: the re-read says there is one page now. */
  fx.data['admin-notifications'] = { rows: [], totalPages: 1, total: 20 };
  fx.render();
  assert.equal(fx.reads.filter((read) => read.name === 'admin-notifications').at(-1).args.page, 1);
  assert.equal(pager().props.page, 1);
  fx.hooks.dispose();

  const feedback = fixture('glossary/FeedbackDialog', {}, {
    'admin-tag-feedback': { rows: [{ id: 9, tag_name: 'a', content: 'x', username: 'u', status: 'pending', created_at: '2026-10-01 08:00:00' }], summary: { pending: 41, processed: 0, rejected: 0 }, totalPages: 2 },
  }, { expose: 'FeedbackDialog' });
  const render = () => feedback.hooks.render(() => feedback.subject({ open: true, token: feedback.session.token, onClose() {}, onHandle() {} }));
  render();
  feedback.hooks.effects();
  find(render(), (node) => node.type === '@/components/Pagination:default').props.onPageChange(2);
  render();
  assert.equal(feedback.reads.filter((read) => read.name === 'admin-tag-feedback').at(-1).args.page, 2);
  /* The page's last feedback is handled: the queue now has one page, and the dialog must not sit on
     an empty page 2 with its pager gone. */
  feedback.data['admin-tag-feedback'] = { rows: [], summary: { pending: 40, processed: 1, rejected: 0 }, totalPages: 1 };
  render();
  assert.equal(feedback.reads.filter((read) => read.name === 'admin-tag-feedback').at(-1).args.page, 1);
  feedback.hooks.dispose();
});

test('review P6-F7: 屏蔽标签 refuses a comma, which every visitor\'s search would read as AND', async () => {
  const adds = [];
  const fx = fixture('BlockTagsTab', {
    getBlockTags: async () => ({ success: true }),
    adminAddBlockTag: (_, payload) => { adds.push(payload); return Promise.resolve(Response.json({ success: true })); },
  }, { 'admin-block-tags': { safe: [] } }, {
    modules: { '@/lib/blockFilters': { BLOCK_FILTER_KEYS: ['safe', 'spoilers', 'banAnthro', 'banDiscomfort', 'onlyPony'], installBlockFilters() {}, parseBlockFilters: () => ({}) } },
  });
  fx.render();
  fx.hooks.effects();
  const addButton = () => find(fx.render(), (node) => node.type === '@/components/Button:default' && typeof node.props.children === 'string' && node.props.children.includes('添加'));
  const opener = addButton();
  if (opener) opener.props.onClick();
  const field = () => find(fx.render(), (node) => node.type === '@/components/Input:Input');
  assert.ok(field(), 'the add field is open');
  for (const typed of ['explicit, grimdark', 'explicit，grimdark']) {
    change(field(), typed);
    const form = find(fx.render(), (node) => typeof node.props?.onSubmit === 'function');
    form.props.onSubmit({ preventDefault() {} });
    assert.equal(adds.length, 0, `${typed} is not sent`);
    assert.match(field().props.error, /逗号/);
  }
  fx.hooks.dispose();
});

test('review P6-F8: adding or deducting zero coins is refused; setting zero is a change', () => {
  const user = { id: 5, username: '测试用户', experience: 50, coins: 20 };
  const requests = [];
  const fx = fixture('WealthTab', {
    adminUpdateWealth: (_, payload) => { requests.push(payload); return new Promise(() => {}); },
  }, { 'admin-users': usersOf([user]) }, { expand: ['WealthDialog'] });
  fx.render();
  fx.hooks.effects();
  button(actionCell(fx.render(), user), '修改资产').props.onClick();
  const dialog = () => modal(fx.render(), '修改资产 · 测试用户');
  const op = () => find(dialog(), (node) => node.type === '@/components/Select:default' && node.props.label === '操作');
  for (const [value, label] of [['add', '增加金币的原因'], ['sub', '扣除金币的原因']]) {
    op().props.onChange(value);
    change(input(dialog(), 'label', '数值'), '0');
    change(input(dialog(), 'label', label), '调整');
    adminForm(dialog()).props.onSubmit();
    assert.equal(requests.length, 0, `${value} 0 is not sent`);
    assert.match(input(dialog(), 'label', '数值').props.error, /须大于 0/);
  }
  op().props.onChange('set');
  change(input(dialog(), 'label', '数值'), '0');
  change(input(dialog(), 'label', '金币变动的原因'), '清零');
  adminForm(dialog()).props.onSubmit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ target_id: 5, coins_op: 'set', coins_value: 0, reason: '清零' }]);
  fx.hooks.dispose();
});

test('review P6-F6: renaming a 角色 corrects the read, never mints an unsaved draft of the whole roster', async () => {
  const ponies = [{ name: 'Twilight', path: 'twilight', preview: '', enabled: true }, { name: 'Rarity', path: 'rarity', preview: '', enabled: false }];
  const fx = fixture('catalogTools/PoniesTab', {}, { 'admin-catalog-ponies': { enabled: true, ponies, skipped: 0 } }, {
    modules: (deps) => {
      const errors = load('lib/api/errors.ts');
      const catalog = { CatalogOutcomeUnknown: class extends errors.ApiError {}, savePonyName: async () => ({ success: true, new_name: 'Twilight Sparkle' }) };
      return {
        '@/lib/api/adminCatalogTools': catalog,
        '@/lib/desktopPonies/queries': { ponyCatalog: { expire() {} }, myPonies: { expire() {} }, ponyConfigs: { expire() {} } },
        './useCatalogMutation': load('components/admin/catalogTools/useCatalogMutation.ts', { ...deps, '@/lib/api/errors': errors, '@/lib/api/adminCatalogTools': catalog }),
      };
    },
  });
  fx.render();
  fx.hooks.effects();
  const tree = fx.render();
  button(actionCell(tree, ponies[0]), '名称与台词').props.onClick();
  const editor = find(fx.render(), (node) => node.type?.name === 'PonyEditor');
  editor.props.onRenamed('Twilight Sparkle');
  const after = fx.render();
  assert.deepEqual(fx.data['admin-catalog-ponies'].ponies.map((row) => row.name), ['Twilight Sparkle', 'Rarity'], 'the read shows the saved name');
  assert.ok(fx.refreshes.includes('admin-catalog-ponies'), 'and is read again underneath');
  /* No draft: 刷新 re-reads without asking to discard settings nobody changed. */
  const header = find(after, (node) => node.type === '../SectionHeader:default');
  header.props.onRefresh();
  assert.equal(fx.asked.length, 0, 'refresh asks nothing — there is nothing unsaved');
  fx.hooks.dispose();
});
