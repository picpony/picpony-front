/** Boundary contracts for the existing F4 console. All transports are local fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function load(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      exports,
      Error,
      Response,
      URL,
      URLSearchParams,
      AbortController,
      require: (name) => {
        if (name in overrides) return overrides[name];
        const target = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name);
        return load(`${target}.ts`, overrides, cache);
      },
    },
    { filename: file },
  );
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('R9-026 blank coins are omitted, explicit zero is retained, and unsafe numbers are refused', () => {
  const { wholeNumber, wealthPayload } = load('components/admin/wealth.ts');
  for (const invalid of ['', ' ', '-1', '1.5', '1e3', 'Infinity', '9007199254740992'])
    assert.equal(wholeNumber(invalid), null);
  const user = { id: 5, experience: 10, coins: 100 };
  const form = {
    experience: '10',
    experienceReason: '',
    coinsOp: 'set',
    coinsValue: '',
    coinsReason: '',
  };
  assert.equal(wealthPayload(user, form), null);
  /* `PATCH /admin/users/{id}/wealth` names the balances it was made against (409 when they moved). */
  assert.deepEqual(plain(wealthPayload(user, { ...form, experience: '12', experienceReason: '活动' })), {
    expected_coins: 100,
    expected_experience: 10,
    experience: 12,
    experience_reason: '活动',
  });
  assert.deepEqual(plain(wealthPayload(user, { ...form, coinsValue: '0', coinsReason: '调整' })), {
    expected_coins: 100,
    expected_experience: 10,
    coins: { operation: 'set', amount: 0 },
    coins_reason: '调整',
  });
});

test('badge audiences reject a bad ID instead of silently granting to a shorter list', () => {
  const { parseUserIds, grantPayload } = load('components/admin/badges.ts');
  assert.deepEqual(plain(parseUserIds('2，3、2 4')), [2, 3, 4]);
  for (const text of ['2,0', '2,-3', '2,three', '2,1.5', '2,9007199254740992']) assert.equal(parseUserIds(text), null);
  const form = {
    name: ' 活动 ',
    color: '#abcdef',
    target: 'dates',
    userIds: '2,3',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    permanent: false,
    expiresAt: '2026-12-31',
  };
  assert.deepEqual(plain(grantPayload(form)), {
    name: '活动',
    color: '#abcdef',
    registered_from: '2026-09-01',
    registered_through: '2026-09-30',
    expires_on: '2026-12-31',
  });
  assert.deepEqual(plain(grantPayload({ ...form, target: 'users', permanent: true })), {
    name: '活动',
    color: '#abcdef',
    user_ids: [2, 3],
  });
});

test('R9-023 a malformed price or stock never becomes a free or unavailable item', () => {
  const { shopForm, shopPayload } = load('components/admin/shop.ts');
  const form = { ...shopForm(), name: '商品' };
  for (const field of ['price', 'stock'])
    for (const value of ['', '-1', '2.5', '1e3', '9007199254740992']) {
      const result = shopPayload({ ...form, [field]: value });
      assert.ok(result.errors[field]);
      assert.equal(result.payload, undefined);
    }
  assert.equal(shopPayload({ ...form, price: '0', stock: '0' }).payload.price, 0);
});

test('R9-033/035 glossary exports round-trip translated names and aliases, without inventing translations', () => {
  const { parseImport, exportText, pageSizeOf } = load('components/admin/glossary/model.ts');
  const tags = [
    { en: 'twilight sparkle', cn: '紫悦', aliases: ['暮光闪闪', 'ts'] },
    { en: 'pony', cn: '未翻译', aliases: [] },
  ];
  const result = parseImport(exportText(tags));
  assert.deepEqual(plain(result.tasks), [
    {
      en: 'twilight sparkle',
      cn: '紫悦',
      aliases: ['暮光闪闪', 'ts'],
      cat: 'general',
      count: 0,
      description: '',
    },
  ]);
  assert.equal(result.skipped, 0);
  assert.equal(pageSizeOf('50'), 50);
  for (const value of ['', null, 'garbage', 3, 151]) assert.equal(pageSizeOf(value), 100);
  assert.equal(parseImport('TAG = 译名\ntag = 重复\ninvalid').tasks.length, 1);
});

test('glossary history uses the cached original editor UTC contract and displays Beijing time', () => {
  const { historyTime } = load('components/admin/glossary/model.ts');
  assert.equal(historyTime('2026-09-24 12:00:00'), historyTime('2026-09-24T12:00:00Z'));
  assert.match(historyTime('2026-09-24 12:00:00'), /20:00/);
  assert.match(historyTime('2026-09-24T12:00:00+08:00'), /12:00/);
  assert.equal(historyTime('2026-09-24 17:30:00'), '2026/09/25 01:30', 'a UTC evening is the next Beijing morning');
  assert.equal(historyTime(null), '');
  assert.equal(historyTime('not a time'), 'not a time');
});

/* G4-018: three columns are UTC on the original front end's evidence (lib/format.ts names them);
   every other stamp is Beijing wall-clock. Both readings, one parser. */
test('G4-018 the three UTC columns and every other stamp are read by one parser in two zones', () => {
  const format = load('lib/format.ts');
  const iso = (date) => date.toISOString();
  /* An offset-less stamp: Beijing by default, UTC for the three columns. */
  assert.equal(iso(format.parseBackendTime('2026-08-31 17:30:00')), '2026-08-31T09:30:00.000Z');
  assert.equal(iso(format.parseBackendUtcTime('2026-08-31 17:30:00')), '2026-08-31T17:30:00.000Z');
  /* A stamp that names its zone is taken as written by both. */
  for (const zoned of ['2026-08-31T17:30:00Z', '2026-09-01T01:30:00+08:00', '2026-09-01T01:30:00+0800']) {
    assert.equal(iso(format.parseBackendUtcTime(zoned)), iso(format.parseBackendTime(zoned)));
  }
  assert.equal(format.parseBackendUtcTime(''), null);
  assert.equal(format.parseBackendUtcTime('0000-00-00 00:00:00'), null);
  assert.equal(iso(format.parseBackendUtcTime(Date.UTC(2026, 8, 1))), '2026-09-01T00:00:00.000Z');
  /* Every other column keeps the Beijing reading: a blacklist row written at noon prints noon. */
  assert.equal(format.formatDateTime('2026-09-24 12:00:00'), '2026/09/24 12:00');
});

test('G4-018 a late-night view lands on its Beijing day, and a day boundary splits where Beijing does', () => {
  const format = load('lib/format.ts');
  const errors = load('lib/api/errors.ts');
  const http = { api: async () => null, seg: String };
  const history = load('lib/api/history.ts', {
    './http': http,
    './errors': errors,
    '@/lib/utils': { randomId: () => 'k' },
  });
  /* The shape testPersonalScreens pins: ISO with Z, whole seconds kept whole. */
  assert.equal(history.utcStamp('2026-10-01 12:00:00'), '2026-10-01T12:00:00Z');
  assert.equal(history.utcStamp('2026-10-01T20:00:00+08:00'), '2026-10-01T12:00:00Z');
  assert.equal(history.utcStamp('garbage'), null);
  /* The backend's row: `viewed_at` is UTC. */
  const at = (stamp) =>
    history.historyEntryOf({
      image_id: 7,
      preview_url: '',
      uploader: '',
      viewed_at: stamp,
      previous_viewed_at: null,
    }).viewedAt;
  /* 17:30 UTC on 31 August is 01:30 on 1 September in Beijing: that day's group, at that clock. */
  assert.equal(format.beijingDateKey(at('2026-08-31 17:30:00')), '2026-09-01');
  assert.equal(format.formatClock(at('2026-08-31 17:30:00')), '01:30');
  /* The Beijing midnight is 16:00 UTC: 15:59 is still the 31st, 16:00 is the 1st. */
  assert.equal(format.beijingDateKey(at('2026-08-31 15:59:00')), '2026-08-31');
  assert.equal(format.beijingDateKey(at('2026-08-31 16:00:00')), '2026-09-01');
});

/* G4-015: a figure that did not arrive is never a zero in the console that sets it. */
test('G4-015 admin figures read absent as absent: tables print a dash, forms open empty', () => {
  const figures = load('components/admin/figures.ts');
  for (const absent of [undefined, null, '', '  ', true, false, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(figures.figureOf(absent), null, String(absent));
    assert.equal(figures.figureText(absent), '—');
    assert.equal(figures.figureField(absent), '');
  }
  assert.equal(figures.figureOf('0'), 0);
  assert.equal(figures.figureOf(-3), -3);
  assert.equal(figures.figureText(1234567), '1,234,567');
  assert.equal(figures.figureText('30'), '30');
  assert.equal(figures.figureField(0), '0');

  /* `GET /admin/shop/items` always answers integer prices and stock (`shop_items` NOT NULL), so the
     form reads them as they are; a field the operator clears is still refused. */
  const { shopForm, shopPayload } = load('components/admin/shop.ts');
  const present = shopForm({
    id: 4,
    name: 'x',
    description: '',
    image_url: null,
    price: 0,
    stock: 7,
    active: true,
  });
  assert.deepEqual([present.price, present.stock], ['0', '7']);
  assert.ok(shopPayload({ ...present, price: '' }, { id: 4 }).errors.price, 'a save cannot write a price nobody typed');

  const { teamForm } = load('components/admin/team.ts', {
    '@/lib/roles': { roleInfo: () => ({ label: '' }) },
  });
  /* `order_num` is a NOT NULL integer on `GET /team-members`. */
  assert.equal(teamForm({ id: 1, name: '成员', order_num: 0 }).order, '0');
  assert.equal(teamForm({ id: 1, name: '成员', order_num: -2 }).order, '-2');

  /* The wealth form always knows the balances (`GET /admin/users` answers both), so a blank field is
     simply "unchanged". */
  const { wealthPayload } = load('components/admin/wealth.ts');
  const form = {
    experience: '',
    experienceReason: '',
    coinsOp: 'set',
    coinsValue: '5',
    coinsReason: '补发',
  };
  assert.deepEqual(
    plain(wealthPayload({ id: 9, username: 'u', coins: 1, experience: 2 }, form)),
    {
      expected_coins: 1,
      expected_experience: 2,
      coins: { operation: 'set', amount: 5 },
      coins_reason: '补发',
    },
    'an experience left blank is not sent',
  );
});

/* G4-011: one rule for a failure's two lines, table or not. */
test('G4-011 a failure prints its title once and the own sentence of the error only when it adds one', () => {
  const queries = load('components/admin/queries.ts', {
    '@/lib/resource': {
      defineResource: (options) => options,
      SKIP: Symbol('skip'),
      useResource: () => ({}),
    },
    '@/lib/hooks': { readToken: () => 'token' },
  });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', '屏蔽库加载失败')), {
    title: '屏蔽库加载失败',
  });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', '网络连接失败，请检查网络后再试')), {
    title: '屏蔽库加载失败',
    message: '网络连接失败，请检查网络后再试',
  });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', undefined)), {
    title: '屏蔽库加载失败',
  });
  assert.deepEqual(plain(queries.tableError('屏蔽库加载失败', '屏蔽库加载失败')), {
    error: '屏蔽库加载失败',
  });
  assert.deepEqual(plain(queries.tableError('屏蔽库加载失败', undefined)), {});
});

test('R9-043 admin reads forward cancellation and the feedback queue reads by cursor', async () => {
  const requests = [];
  const controller = new AbortController();
  const errors = load('lib/api/errors.ts');
  const api = load('lib/api/admin.ts', {
    '@/lib/constants': { DERPIBOORU_API_BASE: 'https://fixture.invalid' },
    './client': {},
    './errors': errors,
    '@/lib/adminMutations': { adminWrite: async () => ({}), requestUuid: () => 'uuid' },
    './http': {
      api: async (method, apiPath, options) => {
        requests.push({ method, path: apiPath, options });
        if (apiPath === '/dictionary/tags') return { tags: [{ en: 'PONY' }] };
        if (apiPath === '/editor/dictionary/feedback') return { feedback: [], next_cursor: null };
        if (apiPath === '/admin/notifications') return { notifications: [], total: 0, total_pages: 1 };
        if (apiPath === '/team-members' || apiPath === '/admin/team-members') return { revision: 1, members: [] };
        return {};
      },
      seg: (value) => encodeURIComponent(String(value)),
    },
  });
  await api.getTagFeedback('fixture', { status: 'pending', before: 41 }, controller.signal);
  assert.equal(await api.checkTagExists('fixture', 'pony', controller.signal), true);
  assert.equal(await api.checkTagExists('fixture', 'missing', controller.signal), false);
  assert.ok(requests.every(({ options }) => options.signal === controller.signal));
  const feedback = requests.find(({ path: p }) => p === '/editor/dictionary/feedback').options.query;
  assert.equal(feedback.status, 'pending');
  assert.equal(feedback.before, 41);
});

/* M1-031: DataTable's row presence. The DOM half (FLIP, collapse, fades) is measured in a browser;
   the list half — who is leaving, where a leaver stays, when the list is replaced outright — is
   the static `getDerivedStateFromProps`, run here against the real component. */
function loadDataTable(tier = 'standard') {
  const source = readFileSync(path.join(root, 'components/DataTable.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    fileName: 'DataTable.tsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const stub = () => null;
  const modules = {
    react: {
      Component: class {
        constructor(props) {
          this.props = props;
        }
      },
      Fragment: 'Fragment',
    },
    'react/jsx-runtime': { jsx: stub, jsxs: stub },
    '@/lib/utils': { cn: (...names) => names.filter(Boolean).join(' ') },
    '@/lib/appearance': { motionTier: () => tier },
    '@/lib/springTiming': { springTiming: () => ({ duration: 100, easing: 'linear' }) },
    '@/lib/tabPaneVisibility': { insideConcealedPane: () => false },
    '@/components/admin/tableMotion': {
      dropMove: stub,
      followersOf: () => [],
      markLayoutOwned: stub,
      precedersOf: () => [],
      startMove: stub,
    },
    './LoadingIndicator': { PageLoadingIndicator: stub },
    './EmptyState': stub,
    './ErrorRetry': stub,
  };
  vm.runInNewContext(
    code,
    {
      exports,
      document: {},
      require: (name) => {
        assert.ok(name in modules, `unmocked dependency: ${name}`);
        return modules[name];
      },
    },
    { filename: 'DataTable.tsx' },
  );
  const DataTable = exports.default;
  const base = { columns: [], rowKey: (row) => row.id };
  /** One render's derived state, from the previous one. */
  const step = (state, props) => ({
    ...state,
    ...DataTable.getDerivedStateFromProps({ ...base, ...props }, state),
  });
  const initial = (props) => step(new DataTable({ ...base, ...props }).state, props);
  const keys = (state) =>
    state.entries
      .map((entry) => (entry.leaving ? `(${entry.key})` : entry.key))
      .join(' ')
      .replace(/\u0000/g, '#');
  return { step, initial, keys };
}
const rowsOf = (...ids) => ids.map((id) => ({ id }));

test('M1-031 a deleted row stays where it was, leaving; a row put back is simply present', () => {
  const { step, initial, keys } = loadDataTable();
  let state = initial({ rows: rowsOf(1, 2, 3, 4) });
  assert.equal(keys(state), '1 2 3 4');
  assert.equal(state.animate, false, 'the first rows are not an arrival');
  state = step(state, { rows: rowsOf(1, 3, 4) });
  assert.equal(keys(state), '1 (2) 3 4');
  assert.equal(state.animate, true);
  const shape = state.shape;
  /* A re-render with an equal list (a new array, as `usePagedRows` slices one every render) moves nothing. */
  state = step(state, { rows: rowsOf(1, 3, 4) });
  assert.equal(keys(state), '1 (2) 3 4');
  assert.equal(state.shape, shape, 'no change of shape, so no snapshot');
  /* A second delete while the first still fades: both leave, each in its own place. */
  state = step(state, { rows: rowsOf(1, 4) });
  assert.equal(keys(state), '1 (2) (3) 4');
  /* 撤销: back where it was. */
  state = step(state, { rows: rowsOf(1, 3, 4) });
  assert.equal(keys(state), '1 (2) 3 4');
  /* An arrival is an entry like any other. */
  state = step(state, { rows: rowsOf(1, 3, 4, 5) });
  assert.equal(keys(state), '1 (2) 3 4 5');
});

test('M1-031 a new page, a new filter, a list with nothing in common and 关闭 replace the rows outright', () => {
  const { step, initial, keys } = loadDataTable();
  let state = initial({ rows: rowsOf(1, 2, 3), listKey: '0:1' });
  state = step(state, { rows: rowsOf(1, 3), listKey: '0:2' });
  assert.equal(keys(state), '1 3', 'a change of listKey');
  assert.equal(state.animate, false);
  state = step(state, { rows: rowsOf(7, 8), listKey: '0:2' });
  assert.equal(keys(state), '7 8', 'nothing in common with the rows on screen');
  assert.equal(state.animate, false);
  state = step(state, { rows: [], loading: true, listKey: '0:2' });
  assert.equal(keys(state), '', 'loading shows the skeleton');
  state = step(state, { rows: rowsOf(7), listKey: '0:2' });
  assert.equal(keys(state), '7');
  assert.equal(state.animate, false, 'rows landing after a skeleton are not an arrival');

  const off = loadDataTable('off');
  let quiet = off.initial({ rows: rowsOf(1, 2, 3) });
  quiet = off.step(quiet, { rows: rowsOf(1, 3) });
  assert.equal(off.keys(quiet), '1 3', '关闭 keeps no leaver');
  assert.equal(quiet.animate, false);
});

test('M1-031 the empty and failure rows come and go as entries; a leaving row keeps the editor it showed', () => {
  const { step, initial, keys } = loadDataTable();
  let state = initial({ rows: rowsOf(1) });
  state = step(state, { rows: [] });
  assert.equal(keys(state), '(1) #empty', 'the last row leaves where 暂无数据 arrives');
  state = step(state, { rows: rowsOf(9) });
  assert.equal(keys(state), '(1) (#empty) 9');

  const editor = { type: 'InlineEditorPanel' };
  let edited = initial({
    rows: rowsOf(1, 2),
    expandedRow: (row) => (row.id === 2 ? editor : null),
  });
  assert.equal(edited.expanded.get('2'), editor);
  /* Deleted from its own editor: the editor closes in the same commit the row goes in. */
  edited = step(edited, { rows: rowsOf(1), expandedRow: () => null });
  const leaver = edited.entries.find((entry) => entry.key === '2');
  assert.equal(leaver.leaving, true);
  assert.equal(leaver.expanded, editor, 'the editor leaves with its row instead of vanishing');

  let failed = initial({ rows: rowsOf(1, 2) });
  failed = step(failed, {
    rows: rowsOf(1, 2),
    error: '第 2 页加载失败',
    errorDetail: '请求超时，请稍后再试',
  });
  assert.equal(keys(failed), '#error 1 2', 'a failed page turn shows above the rows still on screen');
  failed = step(failed, { rows: rowsOf(1, 2) });
  const gone = failed.entries[0];
  assert.equal(keys(failed), '(#error) 1 2');
  assert.deepEqual(
    plain(gone.failure),
    { title: '第 2 页加载失败', detail: '请求超时，请稍后再试' },
    'it leaves with its own words',
  );
});

test("a dropped leaver's columns are held through the merges that follow, and let go by an outright replacement", () => {
  const { step, initial, keys } = loadDataTable();
  /* `drop` writes the widths it read with the leaver still laid out; the next renders must keep them. */
  let state = {
    ...initial({ rows: rowsOf(1, 2, 3), listKey: 'p1' }),
    held: [40, 523.5, 261.75, 260],
  };
  state = step(state, { rows: rowsOf(1, 3), listKey: 'p1' });
  assert.equal(keys(state), '1 (2) 3');
  assert.deepEqual(state.held, [40, 523.5, 261.75, 260], 'a delete, an undo or an arrival keeps the floor');
  state = step(state, { rows: rowsOf(1, 3, 4), listKey: 'p1' });
  assert.deepEqual(state.held, [40, 523.5, 261.75, 260]);
  for (const [label, props] of [
    ['a page turn', { rows: rowsOf(1, 3), listKey: 'p2' }],
    ['a list with nothing in common', { rows: rowsOf(8, 9), listKey: 'p1' }],
    ['loading', { rows: [], loading: true, listKey: 'p1' }],
  ]) {
    const replaced = step({ ...state, held: [1, 2, 3, 4] }, props);
    assert.equal(replaced.held, null, `${label} sizes its own tracks`);
  }
});

test('tableMotion stops at modal scroll containers and marks FLIP layout ownership across two frames', () => {
  const frames = [];
  class FakeElement {
    constructor(name, attrs = []) {
      this.name = name;
      this.attrs = new Set(attrs);
      this.parentElement = null;
      this.previousElementSibling = null;
      this.nextElementSibling = null;
    }
    hasAttribute(name) {
      return this.attrs.has(name);
    }
    setAttribute(name) {
      this.attrs.add(name);
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    getBoundingClientRect() {
      return { top: 100, bottom: 160, height: 60 };
    }
  }
  const source = readFileSync(path.join(root, 'components/admin/tableMotion.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(
    code,
    {
      exports,
      HTMLElement: FakeElement,
      getComputedStyle: () => ({ position: 'static', transform: 'none' }),
      requestAnimationFrame: (fn) => {
        frames.push(fn);
        return frames.length;
      },
      cancelAnimationFrame: (id) => {
        frames[id - 1] = null;
      },
      require: (name) => {
        assert.equal(name, '@/lib/tabPaneVisibility');
        return { insideConcealedPane: () => false };
      },
    },
    { filename: 'tableMotion.ts' },
  );

  const link = (parent, children) => {
    children.forEach((child, i) => {
      child.parentElement = parent;
      child.previousElementSibling = children[i - 1] ?? null;
      child.nextElementSibling = children[i + 1] ?? null;
    });
  };
  const modal = new FakeElement('modal');
  const header = new FakeElement('dialog-header');
  const body = new FakeElement('dialog-body', ['data-app-scroll-container']);
  const footer = new FakeElement('dialog-footer');
  link(modal, [header, body, footer]);

  const intro = new FakeElement('intro');
  const table = new FakeElement('table');
  const row = new FakeElement('row');
  const nextRow = new FakeElement('next-row');
  const note = new FakeElement('after-table');
  link(body, [intro, table, note]);
  link(table, [row, nextRow]);

  const band = { top: 0, bottom: 900 };
  assert.deepEqual(
    plain(exports.followersOf(row, band).map((el) => el.name)),
    ['next-row', 'after-table'],
    'modal table followers stay inside the dialog scroll body and never move dialog footer',
  );
  assert.deepEqual(
    plain(exports.precedersOf(row, band).map((el) => el.name)),
    ['intro'],
    'modal table preceders stop at the dialog scroll body and never move dialog header',
  );

  exports.markLayoutOwned(table);
  assert.equal(table.hasAttribute('data-layout-owned'), true);
  frames.shift()();
  assert.equal(table.hasAttribute('data-layout-owned'), true, 'still marked through the first paint frame');
  frames.shift()();
  assert.equal(table.hasAttribute('data-layout-owned'), false, 'cleared after two animation frames');
});

test('FollowHeight track never clips growing loading panes and holds primed presses silently', async () => {
  const resizeCallbacks = [];
  const mutationCallbacks = [];
  const frames = [];
  const timers = [];
  const animations = [];
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      resizeCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  }
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      mutationCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
  }
  const makeNode = (height, attrs = {}, opts = {}) => {
    const listeners = new Map();
    const scroller = opts.scroller ?? null;
    const parentElement = opts.parentElement ?? { _minHeight: 552, _pad: 0 };
    return {
      _height: height,
      _top: opts.top ?? 112,
      _attrs: new Set(
        Object.entries(attrs)
          .filter(([, v]) => v)
          .map(([k]) => k),
      ),
      style: { height: '', clipPath: '' },
      parentElement,
      get offsetHeight() {
        const parsed = parseFloat(this.style.height);
        return Number.isFinite(parsed) ? parsed : this._height;
      },
      getBoundingClientRect() {
        const parsed = parseFloat(this.style.height);
        const h = Number.isFinite(parsed) ? parsed : this._height;
        const top = this._top - (scroller?.scrollTop ?? 0);
        return { top, bottom: top + h, height: h };
      },
      closest(sel) {
        return sel === '.app-scroller' ? scroller : null;
      },
      addEventListener(type, fn) {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener(type, fn) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn),
        );
      },
      dispatchEvent(event) {
        for (const fn of listeners.get(event.type) ?? []) fn(event);
        return true;
      },
      setAttribute(name) {
        this._attrs.add(name);
      },
      removeAttribute(name) {
        this._attrs.delete(name);
      },
      hasAttribute(name) {
        return this._attrs.has(name);
      },
      querySelector(sel) {
        if (sel === '[data-tab-primed]') return this._attrs.has('data-tab-primed') ? this : null;
        if (sel === '[data-tab-pane-leaving]') return this._attrs.has('data-tab-pane-leaving') ? this : null;
        if (sel === '[data-layout-owned]') return null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-page-loading]')
          return this._attrs.has('data-page-loading') ? [{ checkVisibility: () => true }] : [];
        return [];
      },
      animate(keyframes) {
        let resolveFinish;
        const finished = new Promise((r) => {
          resolveFinish = r;
        });
        const anim = {
          keyframes,
          cancelled: false,
          cancel() {
            this.cancelled = true;
            resolveFinish();
          },
          finish() {
            resolveFinish();
          },
          finished,
        };
        animations.push(anim);
        return anim;
      },
    };
  };
  const source = readFileSync(path.join(root, 'components/FollowHeight.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    fileName: 'FollowHeight.tsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const stub = () => null;
  const modules = {
    react: {
      Component: class {
        constructor(props) {
          this.props = props;
        }
      },
    },
    'react/jsx-runtime': { jsx: stub, jsxs: stub },
    '@/lib/appearance': { motionTier: () => 'standard' },
    '@/lib/springTiming': { springTiming: () => ({ duration: 200, easing: 'linear' }) },
  };
  vm.runInNewContext(
    code,
    {
      exports,
      ResizeObserver: FakeResizeObserver,
      MutationObserver: FakeMutationObserver,
      getComputedStyle: (el) => ({
        minHeight: `${el._minHeight ?? 0}px`,
        paddingTop: `${(el._pad ?? 0) / 2}px`,
        paddingBottom: `${(el._pad ?? 0) / 2}px`,
      }),
      requestAnimationFrame: (fn) => {
        frames.push(fn);
        return frames.length;
      },
      cancelAnimationFrame: (id) => {
        frames[id - 1] = null;
      },
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: (id) => {
        timers[id - 1] = null;
      },
      require: (name) => {
        assert.ok(name in modules, `unmocked dependency: ${name}`);
        return modules[name];
      },
    },
    { filename: 'FollowHeight.tsx' },
  );

  const FollowHeight = exports.default;
  const fh = new FollowHeight({ track: true, children: null });
  const outer = makeNode(320);
  const inner = makeNode(320);
  fh.setNode(outer);
  fh.setInner(inner);
  fh.componentDidMount();
  const resize = (h) => {
    inner._height = h;
    outer._height = h;
    resizeCallbacks[0]([{ borderBoxSize: [{ blockSize: h }], contentRect: { height: h } }]);
  };

  /* 1. Growing into an unvisited loading pane expands immediately instead of holding & slicing. */
  inner.setAttribute('data-tab-pane-leaving');
  inner.setAttribute('data-page-loading');
  resize(900);
  assert.equal(animations.length, 1, 'growing loading pane animates instead of holding');
  assert.deepEqual(plain(animations[0].keyframes), [{ height: '552px' }, { height: '900px' }]);
  animations[0].finish();
  await Promise.resolve();

  /* 2. Shrinking into a shorter loading placeholder holds at 900 without clipping, then expands if chunk grows past 900. */
  inner.removeAttribute('data-tab-pane-leaving');
  resize(650);
  assert.equal(animations.length, 1, 'shrinking loading pane holds at 900');
  assert.equal(outer.style.height, '900px');
  resize(1100);
  assert.equal(animations.length, 2, 'growing past the held height releases and animates immediately');
  assert.deepEqual(plain(animations[1].keyframes), [{ height: '900px' }, { height: '1100px' }]);
  animations[1].finish();
  await Promise.resolve();

  /* 3. Settling back to 320, then priming a taller visited tab (1100) holds silently with zero animation on press & cancel. */
  inner.removeAttribute('data-page-loading');
  resize(320);
  animations[2].finish();
  await Promise.resolve();
  const beforePrime = animations.length;
  inner.setAttribute('data-tab-primed');
  inner.setAttribute('data-tab-pane-leaving');
  resize(1100);
  assert.equal(animations.length, beforePrime, 'primed press does not animate height before click');
  assert.equal(outer.style.height, '552px', 'primed press holds outgoing floor height');
  /* Cancelling the press clears flags and returns to 320 with zero bounce. */
  inner.removeAttribute('data-tab-primed');
  inner.removeAttribute('data-tab-pane-leaving');
  inner._height = 320;
  outer._height = 320;
  mutationCallbacks.at(-1)();
  while (frames.length) frames.shift()?.();
  assert.equal(animations.length, beforePrime, 'cancelled prime releases silently with no height animation');
  assert.equal(outer.style.height, '');
  assert.equal(outer.style.clipPath, '');

  /* 4. Clicking a primed taller tab removes data-tab-primed and expands smoothly in sync with playback. */
  inner.setAttribute('data-tab-primed');
  inner.setAttribute('data-tab-pane-leaving');
  resize(1100);
  assert.equal(animations.length, beforePrime);
  inner.removeAttribute('data-tab-primed');
  mutationCallbacks.at(-1)();
  while (frames.length) frames.shift()?.();
  assert.equal(animations.length, beforePrime + 1, 'playing a primed taller tab expands immediately');
  assert.deepEqual(plain(animations.at(-1).keyframes), [{ height: '552px' }, { height: '1100px' }]);
  animations.at(-1).finish();
  await Promise.resolve();

  /* 5. Sibling sticky rail floor (`data-follow-height-floor`) prevents mid-card slicing between
     tabs shorter than the rail, and starts taller growths from the rail's actual bottom edge. */
  const railFloor = { getBoundingClientRect: () => ({ height: 860 }) };
  const rowParent = {
    _minHeight: 600,
    _pad: 48,
    parentElement: {
      querySelectorAll: (sel) => (sel === ':scope > * > [data-follow-height-floor]' ? [railFloor] : []),
    },
    contains: () => false,
  };
  const scroller = {
    scrollTop: 0,
    clientHeight: 900,
    get scrollHeight() {
      return outerRail.offsetHeight + 160;
    },
    getBoundingClientRect: () => ({ top: 64, bottom: 964 }),
  };
  const fhRail = new FollowHeight({ track: true, children: null });
  const outerRail = makeNode(400, {}, { parentElement: rowParent, scroller });
  const innerRail = makeNode(400, {}, { parentElement: rowParent, scroller });
  fhRail.setNode(outerRail);
  fhRail.setInner(innerRail);
  fhRail.componentDidMount();
  const resizeRail = (h) => {
    innerRail._height = h;
    outerRail._height = h;
    resizeCallbacks.at(-1)([{ borderBoxSize: [{ blockSize: h }], contentRect: { height: h } }]);
  };
  const beforeRail = animations.length;
  /* Two tabs both under the 812px rail content floor (860 - 48): zero animation, zero clipping. */
  resizeRail(750);
  assert.equal(animations.length, beforeRail, 'tabs within the sticky rail floor never clip or animate');
  /* Growing past the rail floor animates from 812px (true card bottom), never 552px. */
  resizeRail(1300);
  assert.equal(animations.length, beforeRail + 1);
  assert.deepEqual(plain(animations.at(-1).keyframes), [{ height: '812px' }, { height: '1300px' }]);
  animations.at(-1).finish();
  await Promise.resolve();
  /* Returning to a primed tall tab with restored scrollTop=500 releases synchronously via
     `picpony:tab-play` without clamping below the restored viewport reach. */
  resizeRail(400);
  animations.at(-1).finish();
  await Promise.resolve();
  innerRail.setAttribute('data-tab-primed');
  innerRail.setAttribute('data-tab-pane-leaving');
  resizeRail(1500);
  const beforePlay = animations.length;
  innerRail.removeAttribute('data-tab-primed');
  innerRail.dispatchEvent({ type: 'picpony:tab-play', detail: { scrollTop: 500 } });
  assert.equal(animations.length, beforePlay + 1, 'picpony:tab-play releases primed hold synchronously');
  const playStart = parseFloat(animations.at(-1).keyframes[0].height);
  assert.ok(playStart >= 1350, `restored scroll floor (${playStart}px) keeps scrollTop=500 reachable`);
});

test('admin registry loads panels lazily without Suspense throttling and recovers on chunk failure', async () => {
  const source = readFileSync(path.join(root, 'components/admin/registry.tsx'), 'utf8');
  assert.equal(
    /from ['"]next\/dynamic['"]/.test(source),
    false,
    'registry avoids next/dynamic Suspense 300ms fallback throttle',
  );

  const states = [];
  let cursor = 0;
  let pendingEffects = [];
  const react = {
    useState(initial) {
      const idx = cursor++;
      if (!(idx in states)) states[idx] = typeof initial === 'function' ? initial() : initial;
      return [
        states[idx],
        (next) => {
          states[idx] = typeof next === 'function' ? next(states[idx]) : next;
        },
      ];
    },
    useEffect(effect) {
      pendingEffects.push(effect);
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(source + '\nexports._panel = panel;', {
    fileName: 'registry.tsx',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const sections = load('components/admin/sections.ts', {
    'react-icons/md': new Proxy({}, { get: (_, name) => name }),
  });
  vm.runInNewContext(
    code,
    {
      exports,
      require: (name) => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        if (name === '@/components/ErrorRetry') return { default: 'ErrorRetry' };
        if (name === './AdminPaneSkeleton') return { default: 'AdminPaneSkeleton' };
        if (name === './sections') return sections;
        if (name === '@/lib/icons') return { ICON: { standard: 24 } };
        return new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : String(k)) });
      },
    },
    { filename: 'registry.tsx' },
  );

  let calls = 0;
  let resolveSecond;
  const Loaded = function LoadedTab() {
    return 'loaded';
  };
  const Lazy = exports._panel(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('offline'));
    return new Promise((resolve) => {
      resolveSecond = () => resolve({ default: Loaded });
    });
  }, '商店管理');

  const render = () => {
    cursor = 0;
    pendingEffects = [];
    const tree = Lazy({ token: 't', role: 'super_admin', viewerId: 1, openTab() {} });
    const run = pendingEffects.splice(0);
    run.forEach((fn) => fn());
    return tree;
  };

  /* Initial render shows the section-labelled skeleton, then surfaces ErrorRetry when chunk fails. */
  const first = render();
  assert.equal(first.type, 'AdminPaneSkeleton');
  assert.equal(first.props.label, '正在加载商店管理…');
  await Promise.resolve();
  await Promise.resolve();
  const failed = render();
  assert.equal(failed.type, 'ErrorRetry');
  assert.equal(failed.props.title, '商店管理加载失败');

  /* Retrying restarts the import and switches straight to the loaded component on resolve. */
  failed.props.onRetry();
  const retrying = render();
  assert.equal(retrying.type, 'AdminPaneSkeleton');
  resolveSecond();
  await Promise.resolve();
  await Promise.resolve();
  const ready = render();
  assert.equal(ready.type, Loaded);
});

test('admin console wraps TabPanes in FollowHeight floored by the sticky rail and restores scroll for top-level panels', () => {
  const adminPage = readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8');
  assert.match(adminPage, /<FollowHeight track>/, 'admin TabPanes uses FollowHeight track to avoid height snaps');
  assert.match(
    adminPage,
    /data-follow-height-floor=""/,
    'wide sticky rail declares data-follow-height-floor so FollowHeight never slices at min-h-150',
  );
  assert.match(adminPage, /data-tab-window-sticky-rail=\{wide \? '' : undefined\}/);

  const tabScroll = {};
  const scrollSource = ts.transpileModule(readFileSync(path.join(root, 'lib/tabScroll.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(scrollSource, {
    exports: tabScroll,
    require: () => ({ getAppScroller: () => null }),
  });

  const scroller = { scrollTop: 400, getBoundingClientRect: () => ({ top: 0 }) };
  const makePanel = ({ stickyRail, top }) => ({
    closest: (selector) =>
      selector === '[data-tab-window]'
        ? { hasAttribute: (attr) => stickyRail && attr === 'data-tab-window-sticky-rail' }
        : null,
    nextElementSibling: null,
    getBoundingClientRect: () => ({ top: top - scroller.scrollTop }),
  });

  assert.equal(tabScroll.tabMayRestore(makePanel({ stickyRail: true, top: 48 }), scroller), true);
  assert.equal(tabScroll.tabMayRestore(makePanel({ stickyRail: true, top: 140 }), scroller), false);
  assert.equal(tabScroll.tabMayRestore(makePanel({ stickyRail: false, top: 48 }), scroller), false);
});
