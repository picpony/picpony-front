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
  vm.runInNewContext(code, { exports, Error, Response, URL, URLSearchParams, AbortController,
    require: (name) => {
      if (name in overrides) return overrides[name];
      const target = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name);
      return load(`${target}.ts`, overrides, cache);
    },
  }, { filename: file });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('R9-026 blank coins are omitted, explicit zero is retained, and unsafe numbers are refused', () => {
  const { wholeNumber, wealthPayload } = load('components/admin/wealth.ts');
  for (const invalid of ['', ' ', '-1', '1.5', '1e3', 'Infinity', '9007199254740992']) assert.equal(wholeNumber(invalid), null);
  const user = { id: 5, experience: 10, coins: 100 };
  const form = { experience: '10', experienceReason: '', coinsOp: 'set', coinsValue: '', coinsReason: '' };
  assert.equal(wealthPayload(user, form), null);
  /* `PATCH /admin/users/{id}/wealth` names the balances it was made against (409 when they moved). */
  assert.deepEqual(plain(wealthPayload(user, { ...form, experience: '12', experienceReason: '活动' })), { expected_coins: 100, expected_experience: 10, experience: 12, experience_reason: '活动' });
  assert.deepEqual(plain(wealthPayload(user, { ...form, coinsValue: '0', coinsReason: '调整' })), { expected_coins: 100, expected_experience: 10, coins: { operation: 'set', amount: 0 }, coins_reason: '调整' });
});

test('badge audiences reject a bad ID instead of silently granting to a shorter list', () => {
  const { parseUserIds, grantPayload } = load('components/admin/badges.ts');
  assert.deepEqual(plain(parseUserIds('2，3、2 4')), [2, 3, 4]);
  for (const text of ['2,0', '2,-3', '2,three', '2,1.5', '2,9007199254740992']) assert.equal(parseUserIds(text), null);
  const form = { name: ' 活动 ', color: '#abcdef', target: 'dates', userIds: '2,3', startDate: '2026-09-01', endDate: '2026-09-30', permanent: false, expiresAt: '2026-12-31' };
  assert.deepEqual(plain(grantPayload(form)), { name: '活动', color: '#abcdef', registered_from: '2026-09-01', registered_through: '2026-09-30', expires_on: '2026-12-31' });
  assert.deepEqual(plain(grantPayload({ ...form, target: 'users', permanent: true })), { name: '活动', color: '#abcdef', user_ids: [2, 3] });
});

test('R9-023 a malformed price or stock never becomes a free or unavailable item', () => {
  const { shopForm, shopPayload } = load('components/admin/shop.ts');
  const form = { ...shopForm(), name: '商品' };
  for (const field of ['price', 'stock']) for (const value of ['', '-1', '2.5', '1e3', '9007199254740992']) {
    const result = shopPayload({ ...form, [field]: value });
    assert.ok(result.errors[field]);
    assert.equal(result.payload, undefined);
  }
  assert.equal(shopPayload({ ...form, price: '0', stock: '0' }).payload.price, 0);
});

test('R9-033/035 glossary exports round-trip translated names and aliases, without inventing translations', () => {
  const { parseImport, exportText, pageSizeOf } = load('components/admin/glossary/model.ts');
  const tags = [{ en: 'twilight sparkle', cn: '紫悦', aliases: ['暮光闪闪', 'ts'] }, { en: 'pony', cn: '未翻译', aliases: [] }];
  const result = parseImport(exportText(tags));
  assert.deepEqual(plain(result.tasks), [{ en: 'twilight sparkle', cn: '紫悦', aliases: ['暮光闪闪', 'ts'], cat: 'general', count: 0, description: '' }]);
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
  const history = load('lib/api/history.ts', { './http': http, './errors': errors, '@/lib/utils': { randomId: () => 'k' } });
  /* The shape testPersonalScreens pins: ISO with Z, whole seconds kept whole. */
  assert.equal(history.utcStamp('2026-10-01 12:00:00'), '2026-10-01T12:00:00Z');
  assert.equal(history.utcStamp('2026-10-01T20:00:00+08:00'), '2026-10-01T12:00:00Z');
  assert.equal(history.utcStamp('garbage'), null);
  /* The backend's row: `viewed_at` is UTC. */
  const at = (stamp) => history.historyEntryOf({ image_id: 7, preview_url: '', uploader: '', viewed_at: stamp, previous_viewed_at: null }).viewedAt;
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
  const present = shopForm({ id: 4, name: 'x', description: '', image_url: null, price: 0, stock: 7, active: true });
  assert.deepEqual([present.price, present.stock], ['0', '7']);
  assert.ok(shopPayload({ ...present, price: '' }, { id: 4 }).errors.price, 'a save cannot write a price nobody typed');

  const { teamForm } = load('components/admin/team.ts', { '@/lib/roles': { roleInfo: () => ({ label: '' }) } });
  /* `order_num` is a NOT NULL integer on `GET /team-members`. */
  assert.equal(teamForm({ id: 1, name: '成员', order_num: 0 }).order, '0');
  assert.equal(teamForm({ id: 1, name: '成员', order_num: -2 }).order, '-2');

  /* The wealth form always knows the balances (`GET /admin/users` answers both), so a blank field is
     simply "unchanged". */
  const { wealthPayload } = load('components/admin/wealth.ts');
  const form = { experience: '', experienceReason: '', coinsOp: 'set', coinsValue: '5', coinsReason: '补发' };
  assert.deepEqual(plain(wealthPayload({ id: 9, username: 'u', coins: 1, experience: 2 }, form)), { expected_coins: 1, expected_experience: 2, coins: { operation: 'set', amount: 5 }, coins_reason: '补发' },
    'an experience left blank is not sent');
});

/* G4-011: one rule for a failure's two lines, table or not. */
test('G4-011 a failure prints its title once and the own sentence of the error only when it adds one', () => {
  const queries = load('components/admin/queries.ts', {
    '@/lib/resource': { defineResource: (options) => options, SKIP: Symbol('skip'), useResource: () => ({}) },
    '@/lib/hooks': { readToken: () => 'token' },
  });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', '屏蔽库加载失败')), { title: '屏蔽库加载失败' });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', '网络连接失败，请检查网络后再试')), { title: '屏蔽库加载失败', message: '网络连接失败，请检查网络后再试' });
  assert.deepEqual(plain(queries.retryError('屏蔽库加载失败', undefined)), { title: '屏蔽库加载失败' });
  assert.deepEqual(plain(queries.tableError('屏蔽库加载失败', '屏蔽库加载失败')), { error: '屏蔽库加载失败' });
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
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const stub = () => null;
  const modules = {
    react: { Component: class { constructor(props) { this.props = props; } }, Fragment: 'Fragment' },
    'react/jsx-runtime': { jsx: stub, jsxs: stub },
    '@/lib/utils': { cn: (...names) => names.filter(Boolean).join(' ') },
    '@/lib/appearance': { motionTier: () => tier },
    '@/lib/springTiming': { springTiming: () => ({ duration: 100, easing: 'linear' }) },
    '@/lib/tabPaneVisibility': { insideConcealedPane: () => false },
    '@/components/admin/tableMotion': { dropMove: stub, followersOf: () => [], precedersOf: () => [], startMove: stub },
    './Skeleton': stub, './EmptyState': stub, './ErrorRetry': stub,
  };
  vm.runInNewContext(code, { exports, document: {}, require: (name) => {
    assert.ok(name in modules, `unmocked dependency: ${name}`);
    return modules[name];
  } }, { filename: 'DataTable.tsx' });
  const DataTable = exports.default;
  const base = { columns: [], rowKey: (row) => row.id };
  /** One render's derived state, from the previous one. */
  const step = (state, props) => ({ ...state, ...DataTable.getDerivedStateFromProps({ ...base, ...props }, state) });
  const initial = (props) => step(new DataTable({ ...base, ...props }).state, props);
  const keys = (state) => state.entries.map((entry) => (entry.leaving ? `(${entry.key})` : entry.key)).join(' ').replace(/\u0000/g, '#');
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
  let edited = initial({ rows: rowsOf(1, 2), expandedRow: (row) => (row.id === 2 ? editor : null) });
  assert.equal(edited.expanded.get('2'), editor);
  /* Deleted from its own editor: the editor closes in the same commit the row goes in. */
  edited = step(edited, { rows: rowsOf(1), expandedRow: () => null });
  const leaver = edited.entries.find((entry) => entry.key === '2');
  assert.equal(leaver.leaving, true);
  assert.equal(leaver.expanded, editor, 'the editor leaves with its row instead of vanishing');

  let failed = initial({ rows: rowsOf(1, 2) });
  failed = step(failed, { rows: rowsOf(1, 2), error: '第 2 页加载失败', errorDetail: '请求超时，请稍后再试' });
  assert.equal(keys(failed), '#error 1 2', 'a failed page turn shows above the rows still on screen');
  failed = step(failed, { rows: rowsOf(1, 2) });
  const gone = failed.entries[0];
  assert.equal(keys(failed), '(#error) 1 2');
  assert.deepEqual(plain(gone.failure), { title: '第 2 页加载失败', detail: '请求超时，请稍后再试' }, 'it leaves with its own words');
});

test('a dropped leaver\'s columns are held through the merges that follow, and let go by an outright replacement', () => {
  const { step, initial, keys } = loadDataTable();
  /* `drop` writes the widths it read with the leaver still laid out; the next renders must keep them. */
  let state = { ...initial({ rows: rowsOf(1, 2, 3), listKey: 'p1' }), held: [40, 523.5, 261.75, 260] };
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
