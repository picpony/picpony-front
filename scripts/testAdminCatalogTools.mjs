/** F5 E2 contracts and import sequencing. All transport and browser state are local fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function load(file, overrides = {}, globals = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, console, Error, TypeError, Response, Request, File, Blob, FormData, URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout, process: { env: {} }, ...globals,
    require: (name) => {
      if (name in overrides) return overrides[name];
      const target = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name);
      return load(`${target}.ts`, overrides, globals, cache);
    },
  }, { filename: file });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const errors = load('lib/api/errors.ts');
/** `/api/v1` with no network: every call is recorded as `{ method, path, ...options }` and answers `reply`. */
function fixtureApi() {
  const requests = []; let reply = {};
  const call = async (method, apiPath, options = {}) => {
    requests.push({ method, path: apiPath, ...options });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(method, apiPath) : reply;
  };
  const http = { api: call, seg: (value) => encodeURIComponent(String(value)) };
  const mutations = { adminWrite: async (method, apiPath, options = {}) => { const data = await call(method, apiPath, { ...options, idempotencyKey: 'key' }); return data && typeof data === 'object' ? data : {}; } };
  const api = load('lib/api/adminCatalogTools.ts', { './http': http, './errors': errors, '@/lib/adminMutations': mutations });
  return { api, requests, response: (data) => { reply = data; } };
}
const shape = (requests) => plain(requests.map(({ method, path: p, json, query }) => ({ method, path: p, ...(json === undefined ? {} : { json }), ...(query === undefined ? {} : { query }) })));

test('badge dictionary saves/deletes and campaign deletion use the /api/v1 resources', async () => {
  const { api, requests } = fixtureApi();
  await api.saveBadgeDescription('admin', ' 徽章 ', ' 简介 ');
  await api.deleteBadgeDescription('admin', '徽章'); await api.deleteBadgeLink('admin', 8);
  assert.deepEqual(shape(requests), [
    { method: 'PUT', path: '/admin/badges/dictionary/%E5%BE%BD%E7%AB%A0', json: { description: '简介' } },
    { method: 'DELETE', path: '/admin/badges/dictionary/%E5%BE%BD%E7%AB%A0' },
    { method: 'DELETE', path: '/admin/badges/campaigns/8' },
  ]);
  assert.ok(requests.every((r) => r.idempotencyKey), 'every console write carries an Idempotency-Key');
  assert.throws(() => api.deleteBadgeLink('admin', 0));
  assert.equal(requests.length, 3);
});
test('purchase pages read by cursor with keyword and signal; a refund is one POST', async () => {
  const { api, requests, response } = fixtureApi(); const controller = new AbortController();
  const row = { id: 2, user_id: 5, username: '用户', item_id: 1, item_name: '徽章', quantity: 2, unit_price: 20, total_amount: 40, status: 'completed', created_at: '2026-10-03T02:00:00Z', refunded_at: null };
  response({ records: [row], next_cursor: 2 });
  const page = await api.getShopPurchases('admin', ' 用户 ', undefined, controller.signal);
  assert.equal(page.rows[0].total_amount, 40); assert.equal(page.next, 2);
  assert.equal(requests[0].signal, controller.signal);
  assert.deepEqual(plain(requests[0].query), { keyword: '用户', limit: api.PURCHASE_PAGE });
  response({ records: [], next_cursor: null });
  assert.equal((await api.getShopPurchases('admin', '', 2)).next, null);
  assert.equal(requests[1].query.before, 2);
  response({ records: [{ id: 7, user_id: 5, username: 'u', reason: '购买商品：旧', amount: -40, balance_after: 0, created_at: row.created_at }], next_cursor: null });
  assert.equal((await api.getLegacyShopPurchases('admin', '')).rows[0].amount, -40);
  assert.equal(requests.at(-1).path, '/admin/shop/legacy-purchases');
  response({ purchase_id: 2, refunded: 40, balance: 40 }); await api.refundShopPurchase('admin', 2);
  assert.deepEqual(shape([requests.at(-1)]), [{ method: 'POST', path: '/admin/shop/purchases/2/refunds' }]);
});
test('mascot and pony writes name the revision; 台词 is one text of at most 500 characters', async () => {
  const { api, requests } = fixtureApi(); const model = load('lib/adminCatalogTools/model.ts');
  await api.saveMascot('t', 4, model.mascotPayload(' 彩彩 ', '/mascot.png', '你好\n\n 欢迎'));
  await api.saveMascot('t', 5, model.mascotPayload('彩彩', '/mascot.png', '你好'), 9);
  await api.toggleMascot('t', 6, 9, false); await api.deleteMascot('t', 7, 9); await api.saveMascotSwitch('t', 8, true);
  await api.savePonies('t', 3, true, [{ name: '紫悦', path: 'ponies/twilight/', preview: '', enabled: false }]);
  await api.savePonyName('t', 3, 'ponies/twilight/', 'Twilight', ' 紫悦 ');
  await api.savePonySpeech('t', 3, 'ponies/twilight/', 'hello', '友谊');
  assert.deepEqual(shape(requests), [
    { method: 'POST', path: '/admin/mascots', json: { expected_revision: 4, name: '彩彩', image_url: '/mascot.png', tips: '你好\n欢迎' } },
    { method: 'PUT', path: '/admin/mascots/9', json: { expected_revision: 5, name: '彩彩', image_url: '/mascot.png', tips: '你好' } },
    { method: 'POST', path: '/admin/mascots/9/activation', json: { expected_revision: 6, is_active: false } },
    { method: 'DELETE', path: '/admin/mascots/9', json: { expected_revision: 7 } },
    { method: 'PUT', path: '/admin/mascot-config', json: { expected_revision: 8, enabled: true } },
    { method: 'PUT', path: '/admin/ponies', json: { expected_revision: 3, enabled: true, ponies: [{ name: '紫悦', path: 'ponies/twilight/', preview: '', enabled: false }] } },
    { method: 'PUT', path: '/admin/ponies/ponies%2Ftwilight%2F/name', json: { expected_revision: 3, old_name: 'Twilight', new_name: '紫悦' } },
    { method: 'PUT', path: '/admin/ponies/ponies%2Ftwilight%2F/speeches', json: { expected_revision: 3, speech_name: 'hello', new_text: '友谊' } },
  ]);
  assert.throws(() => model.mascotPayload('彩彩', '/m.png', '字'.repeat(501)), /500/);
  assert.equal(model.mascotPayload('彩彩', '/m.png', '字'.repeat(500)).tips.length, 500);
  assert.equal(model.tipCount('一\n\n二\n'), 2);
});
test('mascot and pony reads keep the revision; scan preserves drafts and missing roles', async () => {
  const { api, response, requests } = fixtureApi();
  response({ enabled: true, revision: 4, tips: [], mascots: [{ id: 1, name: '彩彩', image_url: '/api/v1/mascots/images/a', tips: '你好\n欢迎', is_active: true, created_at: 'x' }] });
  const mascots = await api.getMascots('t');
  assert.equal(mascots.revision, 4); assert.equal(mascots.mascots[0].tips, '你好\n欢迎');
  response({ enabled: false, revision: 2, ponies: [{ name: '紫悦', path: 'p/ts', preview: '', enabled: true }] });
  const result = await api.getPonies('t'); assert.equal(result.enabled, false); assert.equal(result.revision, 2); assert.equal(result.ponies[0].enabled, true);
  const { mergeDiscovery } = load('lib/adminCatalogTools/model.ts');
  const merged = mergeDiscovery(result.ponies, [{ name: '原名', path: 'p/ts', preview: '', enabled: false }, { name: '新角色', path: 'p/new', preview: '', enabled: false }]);
  assert.equal(merged[0].name, '紫悦'); assert.equal(merged[0].enabled, true); assert.equal(merged[1].enabled, false);
  response({ ponies: [{ name: '新角色', path: 'p/new', preview: '' }] }); await api.scanPonies('t');
  assert.deepEqual(shape([requests.at(-1)]), [{ method: 'POST', path: '/admin/ponies/scans' }]);
  response({ path: 'p/ts', speeches: [{ name: 'hello', text: '你好', audio: ['hello.mp3'] }] });
  assert.equal((await api.getPonySpeeches('t', 'p/ts'))[0].text, '你好');
  assert.equal(requests.at(-1).path, '/admin/ponies/p%2Fts/speeches');
});
test('translation cleanup sends bodyless POSTs', async () => {
  const { api, requests } = fixtureApi(); await api.clearTranslationQueue('t'); await api.clearTranslationFailures('t');
  assert.deepEqual(shape(requests), [{ method: 'POST', path: '/admin/translation/queue-clearances' }, { method: 'POST', path: '/admin/translation/failure-resets' }]);
});
test('mascot image MIME and size bounds follow the backend; unsafe asset schemes are refused', () => {
  const model = load('lib/adminCatalogTools/model.ts');
  for (const [size, type] of [[0, 'image/png'], [5 * 1024 * 1024 + 1, 'image/png'], [1, 'image/svg+xml']]) assert.throws(() => model.validateImage({ size, type }, 'mascot'));
  model.validateImage({ size: 5 * 1024 * 1024, type: 'image/webp' }, 'mascot');
  assert.throws(() => model.assetUrl('javascript:alert(1)')); assert.throws(() => model.assetUrl('https://secret:password@example.com/file.png'));
  assert.equal(model.assetUrl('/api/v1/mascots/images/abc'), '/api/v1/mascots/images/abc');
});
test('a lost or 5xx acknowledgement stays unknown and no write is retried; 403 stays a refusal', async () => {
  const { api } = fixtureApi(); let calls = 0;
  for (const failure of [new errors.ApiError('network'), new errors.ApiError('timeout'), new errors.ApiError('http', { status: 500 }), new TypeError('boom')]) {
    await assert.rejects(api.catalogWrite(async () => { calls++; throw failure; }), (error) => error instanceof api.CatalogOutcomeUnknown);
  }
  assert.equal(calls, 4);
  await assert.rejects(api.catalogWrite(async () => { throw new errors.ApiError('http', { status: 403, serverMessage: '需要管理员权限', message: '需要管理员权限', retryable: false }); }), (error) => error.status === 403 && !(error instanceof api.CatalogOutcomeUnknown));
  await assert.rejects(api.catalogWrite(async () => { throw new errors.ApiError('http', { status: 501 }); }), (error) => /尚未提供/.test(error.message));
});
test('mutation duplicate press and account switch discard late UI callbacks', async () => {
  let token = 'first'; const cleanup = []; const updates = []; const state = [];
  const react = { useRef: (value) => ({ current: value }), useState: (value) => { const index = state.length; state.push(value); return [value, (next) => updates.push({ index, next })]; }, useEffect: (effect) => cleanup.push(effect()) };
  const { useCatalogMutation } = load('components/admin/catalogTools/useCatalogMutation.ts', { react, '@/lib/hooks': { readToken: () => token }, '@/lib/api/adminCatalogTools': { CatalogOutcomeUnknown: class extends Error {} } });
  const mutation = useCatalogMutation('first'); let release; let calls = 0; let success = 0;
  const request = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const pending = mutation.run(request, () => success++); await mutation.run(request, () => success++); assert.equal(calls, 1);
  token = 'second'; cleanup.forEach((fn) => fn()); token = 'first'; release({}); await pending;
  assert.equal(success, 0); assert.equal(updates.filter((row) => row.next === false).length, 0);
});
test('acknowledged catalogue cache changes outlive their view but never a different account', async () => {
  for (const changed of [false, true]) {
    let token = 'first'; const cleanup = [];
    const react = { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}], useEffect: (effect) => cleanup.push(effect()) };
    const { useCatalogMutation } = load('components/admin/catalogTools/useCatalogMutation.ts', { react, '@/lib/hooks': { readToken: () => token }, '@/lib/api/adminCatalogTools': { CatalogOutcomeUnknown: class extends Error {} } });
    const mutation = useCatalogMutation('first'); let release; let committed = 0; let ui = 0;
    const waiting = mutation.run(() => new Promise((resolve) => { release = resolve; }), () => ui++, () => committed++);
    cleanup.forEach((fn) => fn()); if (changed) token = 'second'; release({ success: true }); await waiting;
    assert.equal(committed, changed ? 0 : 1); assert.equal(ui, 0);
  }
});
