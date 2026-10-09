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
const json = (data, status = 200) => Response.json(data, { status });
function fixtureApi() {
  const requests = []; let reply = { success: true };
  const record = async (action, options = {}) => { requests.push({ action, ...options }); return json(reply); };
  const api = load('lib/api/adminCatalogTools.ts', { './http': { picponyRequest: record, picponyPostJson: (action, body, options) => record(action, { ...options, method: 'POST', body }) } });
  return { api, requests, response: (data) => { reply = data; } };
}

test('badge dictionary saves/deletes and link deletion use exact original payloads', async () => {
  const { api, requests } = fixtureApi();
  await api.saveBadgeDescription('admin', ' 徽章 ', ' 简介 ');
  await api.deleteBadgeDescription('admin', '徽章'); await api.deleteBadgeLink('admin', 8);
  assert.deepEqual(plain(requests), [
    { action: 'admin_save_badge_dict', token: 'admin', method: 'POST', body: { badge_name: '徽章', description: '简介' } },
    { action: 'admin_delete_badge_dict', token: 'admin', method: 'POST', body: { badge_name: '徽章' } },
    { action: 'admin_delete_badge_link', token: 'admin', method: 'POST', body: { id: 8 } },
  ]);
  assert.throws(() => api.deleteBadgeLink('admin', 0));
  assert.equal(requests.length, 3);
});
test('purchase reads keep keyword and signal; malformed amounts cannot enable refunds', async () => {
  const { api, requests, response } = fixtureApi(); const controller = new AbortController();
  const row = { id: '2', user_id: '5', username: '用户', item_name: '徽章', quantity: '2', total_amount: '40', status: 'completed', created_at: '2026-10-03 10:00:00' };
  response({ success: true, records: [row] });
  const records = await api.getShopPurchases('admin', '用户', controller.signal);
  assert.equal(records.rows[0].total_amount, 40); assert.equal(records.skipped, 0);
  assert.equal(requests[0].signal, controller.signal); assert.deepEqual(plain(requests[0].query), { keyword: '用户' });
  /* An unreadable amount still cannot enable a refund — the row is **dropped**, not presented, and
     the count is reported so the operator knows something was skipped. Failing the whole read
     instead left the panel unusable and hid every readable row with it. */
  for (const amount of [undefined, '', -1, 1.5, 'garbage', '9007199254740992']) {
    response({ success: true, records: [{ ...row, total_amount: amount }, { ...row, id: '3' }] });
    const partial = await api.getShopPurchases('admin', '');
    assert.equal(partial.skipped, 1, `amount ${String(amount)} must be skipped`);
    assert.equal(partial.rows.length, 1); assert.equal(partial.rows[0].id, 3);
  }
  /* The array itself still has to be an array: `{}` where records belong is a broken response. */
  response({ success: true, records: {} }); await assert.rejects(api.getShopPurchases('admin', ''));
  response({ success: true, records: [{ id: 7, user_id: 5, username: '', reason: '旧购买', amount: '-40', created_at: row.created_at }] });
  assert.equal((await api.getLegacyShopPurchases('admin', '')).rows[0].amount, -40);
  response({ success: true }); await api.refundShopPurchase('admin', 2);
  assert.deepEqual(plain(requests.at(-1).body), { id: 2 });
});
test('mascot create/edit/activation and ponies configuration/name/speech bodies match original', async () => {
  const { api, requests } = fixtureApi(); const model = load('lib/adminCatalogTools/model.ts');
  await api.saveMascot('t', model.mascotPayload(' 彩彩 ', '/mascot.png', '你好\n\n 欢迎'));
  await api.saveMascot('t', model.mascotPayload('彩彩', '/mascot.png', '你好', 9));
  await api.toggleMascot('t', 9, false); await api.deleteMascot('t', 9);
  await api.savePonies('t', true, [{ name: '紫悦', path: 'ponies/twilight/', preview: '', enabled: false }]);
  await api.savePonyName('t', 'ponies/twilight/', 'Twilight', ' 紫悦 ');
  await api.savePonySpeech('t', 'ponies/twilight/', 'hello', '友谊');
  assert.deepEqual(plain(requests.map(({ action, body }) => ({ action, body }))), [
    { action: 'admin_add_mascot', body: { name: '彩彩', image_url: '/mascot.png', tips: ['你好', '欢迎'] } },
    { action: 'admin_edit_mascot', body: { id: 9, name: '彩彩', image_url: '/mascot.png', tips: ['你好'] } },
    { action: 'admin_toggle_mascot_active', body: { id: 9, is_active: false } },
    { action: 'admin_delete_mascot', body: { id: 9 } },
    { action: 'save_ponies_config', body: { enabled: true, ponies: [{ name: '紫悦', path: 'ponies/twilight/', preview: '', enabled: false }] } },
    { action: 'save_pony_name', body: { path: 'ponies/twilight/', old_name: 'Twilight', new_name: '紫悦' } },
    { action: 'save_pony_speech', body: { path: 'ponies/twilight/', speech_name: 'hello', new_text: '友谊' } },
  ]);
});
test('pony read maps config.enabled and wire names; scan preserves drafts and missing roles', async () => {
  const { api, response, requests } = fixtureApi();
  response({ success: true, config: { enabled: '0' }, ponies: [{ pony_name: '紫悦', pony_path: 'p/ts', preview: '', enabled: '1' }] });
  const result = await api.getPonies('t'); assert.equal(result.enabled, false); assert.equal(result.ponies[0].enabled, true);
  const { mergeDiscovery } = load('lib/adminCatalogTools/model.ts');
  const merged = mergeDiscovery(result.ponies, [{ name: '原名', path: 'p/ts', preview: '', enabled: false }, { name: '新角色', path: 'p/new', preview: '', enabled: false }]);
  assert.equal(merged[0].name, '紫悦'); assert.equal(merged[0].enabled, true); assert.equal(merged[1].enabled, false);
  response({ success: true, ponies: [{ name: '新角色', path: 'p/new', preview: '' }] }); await api.scanPonies('t'); assert.equal(requests.at(-1).action, 'scan_ponies');
  response({ success: true, speeches: [{ name: 'hello', text: '你好', audio: ['hello.mp3'] }] }); await api.getPonySpeeches('t', '紫悦', 'p/ts'); assert.deepEqual(plain(requests.at(-1).query), { name: '紫悦', path: 'p/ts' });
});
test('translation cleanup sends bodyless POSTs', async () => {
  const { api, requests } = fixtureApi(); await api.clearTranslationQueue('t'); await api.clearTranslationFailures('t');
  assert.deepEqual(plain(requests), [{ action: 'admin_clear_translation_queue', token: 't', method: 'POST' }, { action: 'admin_clear_translation_failures', token: 't', method: 'POST' }]);
});
test('image upload field, MIME and size bounds; unsafe asset schemes are refused', async () => {
  const { api, requests } = fixtureApi(); const model = load('lib/adminCatalogTools/model.ts');
  await api.uploadShopImage('t', new File(['png'], 'photo.png', { type: 'image/png' }));
  assert.equal(requests[0].body.get('shop_image').name, 'photo.png'); assert.equal([...requests[0].body.keys()].length, 1);
  for (const [size, type] of [[0, 'image/png'], [2097153, 'image/png'], [1, 'image/svg+xml']]) assert.throws(() => model.validateImage({ size, type }, 'mascot'));
  assert.throws(() => model.assetUrl('javascript:alert(1)')); assert.throws(() => model.assetUrl('https://secret:password@example.com/file.png'));
});
test('missing/HTML/5xx acknowledgements stay unknown and no write is retried; 403 stays a refusal', async () => {
  const { api } = fixtureApi(); let calls = 0;
  for (const response of [json({}), new Response('<html>secret</html>'), json({ success: false }, 500)]) await assert.rejects(api.catalogWrite(async () => { calls++; return response; }), (error) => error instanceof api.CatalogOutcomeUnknown);
  assert.equal(calls, 3);
  await assert.rejects(api.catalogWrite(async () => json({ success: false, error: '<b>secret</b>' }, 403)), (error) => error.status === 403 && !error.retryable && !error.message.includes('secret'));
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

test('import bounds and direct links reject malformed files, private literals and credential URLs', () => {
  const m = load('lib/adminCatalogTools/importModel.ts');
  for (const file of [{ name: 'file.exe', size: 10 }, { name: 'db.gz', size: 0 }, { name: '../db.gz', size: 10 }, { name: 'db.gz', size: 8589934593 }]) assert.throws(() => m.validatePackage(file, 'images'));
  assert.throws(() => m.validatePackage({ name: 'bad.ppsync', size: 268435457 }, 'dictionary'));
  for (const url of ['javascript:test', 'http://localhost/a', 'http://127.1/a', 'http://[::1]/a', 'https://user:pass@example.com/a', 'https://x.internal/a']) assert.throws(() => m.importUrl(url));
  assert.equal(m.importUrl('https://example.com/data.db.gz'), 'https://example.com/data.db.gz');
});
async function staged(m) {
  const file = new File([new Uint8Array(m.CHUNK_BYTES + 3)], 'fixture.db');
  const job = { id: 'fixture-import-1', dataset: 'images', filename: file.name, size: file.size, totalChunks: 2, chunks: [], fingerprint: await m.fingerprint(file), phase: 'paused', percent: 0 };
  return { file, job };
}
test('chunk upload preserves acknowledged partial work, pauses between requests, reconciles before resuming', async () => {
  const m = load('lib/adminCatalogTools/importModel.ts'); const { file, job } = await staged(m);
  const requests = []; const progress = []; let stopped = false;
  const result = await m.uploadChunks(job, file, { status: async () => ({ chunks: [] }), send: async (body) => { requests.push(body); stopped = true; }, current: () => true, stop: () => stopped, progress: (row) => progress.push(row) });
  assert.equal(result.phase, 'paused'); assert.deepEqual(plain(result.chunks), [0]); assert.equal(requests.length, 1);
  const body = requests[0]; assert.deepEqual([...body.keys()].sort(), ['action', 'chunk', 'chunk_index', 'filename', 'total_chunks', 'total_size', 'upload_id'].sort()); assert.equal(body.get('chunk').size, m.CHUNK_BYTES);
  const resumed = await m.uploadChunks(result, file, { status: async () => ({ chunks: [0] }), send: async (body) => requests.push(body), current: () => true, stop: () => false, progress: () => {} });
  assert.equal(resumed.phase, 'staged'); assert.equal(requests.length, 2); assert.equal(requests[1].get('chunk_index'), '1'); assert.equal(requests[1].get('chunk').size, 3);
  assert.ok(requests.every((request) => request.get('action') === 'upload_chunk'));
});
test('chunk error never finalizes, never retries blindly and account change sends no later chunk', async () => {
  const m = load('lib/adminCatalogTools/importModel.ts'); const { file, job } = await staged(m); let sends = 0;
  await assert.rejects(m.uploadChunks(job, file, { status: async () => ({ chunks: [] }), send: async () => { sends++; throw new Error('lost'); }, current: () => true, stop: () => false, progress: () => {} })); assert.equal(sends, 1);
  let current = true;
  await m.uploadChunks(job, file, { status: async () => ({ chunks: [] }), send: async () => { sends++; current = false; }, current: () => current, stop: () => false, progress: () => {} }); assert.equal(sends, 2);
  const different = new File([new Uint8Array(file.size).fill(1)], file.name);
  await assert.rejects(m.uploadChunks(job, different, { status: () => { throw new Error('should not read'); } }));
});
test('done is checked against task identity and complete counters; partial batches never become success', () => {
  const m = load('lib/adminCatalogTools/importModel.ts'); const job = { id: 'fixture-import-1', dataset: 'dictionary', phase: 'submitted', percent: 0 };
  assert.throws(() => m.importStatus({ upload_id: 'another', stage: 'done', valid_count: 1 }, job));
  assert.throws(() => m.importStatus({ upload_id: job.id, stage: 'done', valid_count: 1 }, job));
  const data = { upload_id: job.id, stage: 'done', valid_count: 3, created_count: 1, updated_count: 1, skipped_count: 0, failed_count: 1 };
  assert.equal(m.importStatus(data, job).phase, 'error'); assert.equal(m.importStatus({ ...data, failed_count: 0 }, job).phase, 'done');
  assert.equal(m.importStatus({ ...data, upload_id: undefined, failed_count: 0 }, job).phase, 'done', 'dictionary status does not require an undocumented ID echo');
  assert.equal(m.importStatus({ upload_id: job.id, stage: 'saving', percent: 100 }, job).percent, 99);
  const settled = m.importStatus({ ...data, failed_count: 0 }, job);
  assert.equal(m.importStatus({ success: true, status: 'processing' }, settled, false).phase, 'done', 'late POST acknowledgement cannot regress a completed poll');
});
/**
 * One upstream for the import proxy: `api.php?action=get_user` answers the admin check
 * (`verifyAdmin`), anything else is the fixed importer. `imports` is what actually crossed the
 * boundary, `checks` is what the gate cost.
 */
function importUpstream({ role = 'admin', user = true, verifyStatus = 200, verifyThrows = false, answer } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.includes('action=get_user')) {
      if (verifyThrows) throw new Error('upstream down');
      if (verifyStatus !== 200) return json({ success: false, error: 'no' }, verifyStatus);
      return json(user ? { success: true, user: { id: 1, username: 'a', role } } : { success: true });
    }
    return json(answer ?? { success: true, stage: 'done', upload_id: 'fixture-import-1' });
  };
  const of = (kind) => calls.filter((c) => c.url.includes('action=get_user') === (kind === 'checks'));
  return { fetcher, calls, checks: () => of('checks'), imports: () => of('imports') };
}
const post = (dataset, body, token = 'fixture', { headers = {}, ...init } = {}) =>
  new Request(`https://front.test/admin/import-tools/${dataset}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body, ...init });
/** A body that produces nothing until it is told to, so "was it read?" is observable. */
function heldBody() {
  let pulls = 0; let push;
  /* `highWaterMark: 0`: a stream primes its own queue with one `pull()` on construction, which is not
     anybody reading it. With none, `pull` runs only for a consumer's `read()`. */
  const stream = new ReadableStream({ start(controller) { push = controller; }, pull() { pulls++; } }, { highWaterMark: 0 });
  return { stream, pulls: () => pulls, close: () => push.close(), send: (bytes) => push.enqueue(bytes) };
}
test('fixed import routes rebuild exact fields, forward only caller authorization, strip backend HTML and paths', async () => {
  const { handleImport } = load('lib/adminCatalogTools/importProxy.ts');
  const up = importUpstream({ answer: { success: true, stage: 'done', upload_id: 'fixture-import-1', image_count: 4, target_path: '/secret/database', message: '<script>secret</script>' } });
  const form = new FormData(); form.set('action', 'import_from_url'); form.set('upload_id', 'fixture-import-1'); form.set('url', 'https://example.com/database.gz');
  const response = await handleImport(post('images', form, 'fixture', { headers: { Cookie: 'secret=cookie' } }), 'images', up.fetcher);
  assert.equal(response.status, 200);
  /* The gate runs first, with the caller's own bearer and no cache. */
  assert.equal(up.calls[0].url, 'https://picpony.top/api.php?action=get_user');
  assert.equal(up.calls[0].init.headers.Authorization, 'Bearer fixture');
  assert.equal(up.calls[0].init.cache, 'no-store'); assert.equal(up.calls[0].init.redirect, 'manual');
  const forwarded = up.imports()[0];
  assert.equal(forwarded.url, 'https://picpony.top/image_tags_importer.php');
  assert.deepEqual(plain(forwarded.init.headers), { Authorization: 'Bearer fixture', Accept: 'application/json' }); assert.equal(forwarded.init.redirect, 'manual');
  const result = await response.json(); assert.equal(result.target_path, undefined); assert.equal(result.message, undefined);
  form.set('target', 'https://malicious.test');
  assert.equal((await handleImport(post('images', form), 'images', up.fetcher)).status, 400);
  assert.equal(up.imports().length, 1);
  /* One verdict per token: the second post reuses it. */
  assert.equal(up.checks().length, 1);
  assert.equal((await handleImport(new Request('https://front.test/admin/import-tools/images?action=last_update'), 'images', up.fetcher)).status, 401);
  assert.equal((await handleImport(new Request('https://front.test/admin/import-tools/dictionary?action=chunk_status&upload_id=fixture-import-1', { headers: { Authorization: 'Bearer fixture' } }), 'dictionary', up.fetcher)).status, 400);
  /* A GET is never verified: it carries no body, and a check would double every progress poll. */
  assert.equal(up.checks().length, 1);
});
test('proxy verifies actual streamed size and chunk geometry before any upstream call', async () => {
  const { importForm, handleImport } = load('lib/adminCatalogTools/importProxy.ts'); const m = load('lib/adminCatalogTools/importModel.ts'); const { file, job } = await staged(m);
  const valid = m.chunkForm(job, file, 1); assert.equal(importForm('images', valid).get('chunk').size, 3);
  valid.set('total_size', String(file.size + 1)); assert.throws(() => importForm('images', valid));
  const oversized = new Request('https://front.test/admin/import-tools/images', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(m.CHUNK_BYTES * 2) }, body: 'x' });
  /* A declared oversize body is refused before the admin check and before a byte is held. */
  assert.equal((await handleImport(oversized, 'images', () => { throw new Error('must not forward'); })).status, 413);
  const dict = new FormData(); dict.set('upload_id', 'fixture-import-1'); dict.set('package', new File(['data'], 'package.ppsync'));
  assert.deepEqual([...importForm('dictionary', dict).keys()].sort(), ['package', 'upload_id']);
});
test('G2-001: a non-administrator cannot hold the one body slot, and no body is read to find out', async () => {
  const { handleImport } = load('lib/adminCatalogTools/importProxy.ts');
  const type = { 'content-type': 'multipart/form-data; boundary=x' };
  for (const [label, options, status] of [
    ['an ordinary account', { role: 'user' }, 403],
    ['an editor, who is not offered 数据导入', { role: 'editor' }, 403],
    ['a success envelope with no user record', { user: false }, 503],
    ['a token the backend does not know', { verifyStatus: 401 }, 401],
    ['a token the backend refuses', { verifyStatus: 403 }, 403],
    ['a backend that is down', { verifyThrows: true }, 503],
    ['a backend that answers 500', { verifyStatus: 500 }, 503],
  ]) {
    const up = importUpstream(options); const held = heldBody();
    const response = await handleImport(post('dictionary', held.stream, `token-${status}-${Object.keys(options).join('_') || 'none'}`, { headers: type, duplex: 'half' }), 'dictionary', up.fetcher);
    assert.equal(response.status, status, label);
    assert.equal(up.imports().length, 0, `${label}: nothing forwarded`);
    assert.equal(held.pulls(), 0, `${label}: the body was never read`);
  }
});
test('G2-001: an administrator holds the slot, a stranger cannot, and an unknown verdict is not remembered', async () => {
  const { handleImport, verifyAdmin } = load('lib/adminCatalogTools/importProxy.ts');
  const type = { 'content-type': 'multipart/form-data; boundary=x' };
  const up = importUpstream();
  /* The slot is taken only after the check passes, so it is the administrator's own upload that
     holds it — and a second request meets 导入服务正忙 rather than a stranger's slow body. */
  const held = heldBody(); const control = new AbortController();
  const first = handleImport(post('dictionary', held.stream, 'fixture', { headers: type, duplex: 'half', signal: control.signal }), 'dictionary', up.fetcher);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(held.pulls() > 0, 'the administrator s body is being read');
  const busy = await handleImport(post('dictionary', 'x', 'fixture', { headers: type }), 'dictionary', up.fetcher);
  assert.equal(busy.status, 503); assert.equal((await busy.json()).error, '导入服务正忙，请稍后重试');
  /* A disconnect releases it: the response is a refusal rather than a held slot. */
  control.abort();
  assert.equal((await first).status, 400);
  const after = await handleImport(post('dictionary', (() => { const f = new FormData(); f.set('upload_id', 'fixture-import-1'); f.set('package', new File(['data'], 'package.ppsync')); return f; })(), 'fixture'), 'dictionary', up.fetcher);
  assert.equal(after.status, 200, 'the slot went back');
  /* An unknown verdict is never cached: the next request asks again rather than inheriting a 503. */
  const down = importUpstream({ verifyThrows: true });
  assert.equal(await verifyAdmin('other', down.fetcher), 'unknown');
  assert.equal(await verifyAdmin('other', down.fetcher), 'unknown');
  assert.equal(down.checks().length, 2);
  /* A pass is remembered per token for a window, and a refusal for a shorter one. */
  const clock = { t: 1_000_000 };
  const window = importUpstream();
  const now = () => clock.t;
  assert.equal(await verifyAdmin('warm', window.fetcher, now), 'admin');
  assert.equal(await verifyAdmin('warm', window.fetcher, now), 'admin');
  assert.equal(window.checks().length, 1, 'a long upload does not re-check per chunk');
  clock.t += 61_000;
  assert.equal(await verifyAdmin('warm', window.fetcher, now), 'admin');
  assert.equal(window.checks().length, 2, 'the window expires');
  const refused = importUpstream({ role: 'user' });
  assert.equal(await verifyAdmin('cold', refused.fetcher, now), 'denied');
  clock.t += 6000;
  assert.equal(await verifyAdmin('cold', refused.fetcher, now), 'denied');
  assert.equal(refused.checks().length, 2, 'a refusal is re-asked after 5s, so a promotion lands');
  /* One account's verdict is never another's. */
  assert.equal(await verifyAdmin('warm', refused.fetcher, now), 'admin');
});
test('G2-001: a trickled body is abandoned so it cannot hold the slot for minutes', async () => {
  const { bounded } = load('lib/adminCatalogTools/importProxy.ts');
  const clock = { t: 0 };
  /* Ten bytes every ten seconds: nothing is idle, and at 1 B/s it would need years for a package. */
  const trickle = new ReadableStream({
    pull(controller) { clock.t += 10_000; controller.enqueue(new Uint8Array(10)); },
  });
  const request = new Request('https://front.test/x', { method: 'POST', body: trickle, duplex: 'half' });
  await assert.rejects(bounded(request, 1024 * 1024, { now: () => clock.t }), /stalled/);
  assert.ok(clock.t <= 50_000, `abandoned inside a minute, not ${clock.t}ms`);
  /* No bytes at all — an administrator's connection that died mid-upload — is the same refusal, and
     the slot goes back: the next upload is served rather than answered 导入服务正忙. */
  const { handleImport } = load('lib/adminCatalogTools/importProxy.ts');
  const up = importUpstream(); const silent = heldBody();
  const stalled = await handleImport(post('dictionary', silent.stream, 'stalled-token', { headers: { 'content-type': 'multipart/form-data; boundary=x' }, duplex: 'half' }), 'dictionary', up.fetcher, { idleMs: 40 });
  assert.equal(stalled.status, 408); assert.equal((await stalled.json()).error, '上传中断或过慢，请重新上传');
  assert.equal(up.imports().length, 0, 'nothing reached the importer');
  const next = new FormData(); next.set('upload_id', 'fixture-import-1'); next.set('package', new File(['data'], 'package.ppsync'));
  assert.equal((await handleImport(post('dictionary', next, 'stalled-token'), 'dictionary', up.fetcher, { idleMs: 40 })).status, 200, 'the slot was released');
  /* A body that arrives at a usable rate is unaffected, however long it is. */
  clock.t = 0;
  let left = 40;
  const quick = new ReadableStream({
    pull(controller) { clock.t += 10_000; if (!left--) return controller.close(); controller.enqueue(new Uint8Array(1024 * 1024)); },
  });
  const whole = await bounded(new Request('https://front.test/x', { method: 'POST', body: quick, duplex: 'half' }), 64 * 1024 * 1024, { now: () => clock.t });
  assert.equal(whole.byteLength, 40 * 1024 * 1024);
});


test('saved imports retain fractional progress and completed counters on reload', () => {
  const model = load('lib/adminCatalogTools/importModel.ts');
  const job = { id: 'fixture_job_123', dataset: 'images', filename: 'images.db', size: 100,
    totalChunks: 1, chunks: [0], fingerprint: 'fixture', phase: 'processing', percent: 12.5 };
  assert.equal(model.parseJob(job, 'images').percent, 12.5);
  const done = { ...job, phase: 'done', percent: 100, counts: { image_count: 42, failed_count: 0 } };
  assert.deepEqual(plain(model.parseJob(done, 'images').counts), done.counts);
  for (const percent of [NaN, Infinity, -1, 101, null]) assert.throws(() => model.parseJob({ ...job, percent }, 'images'));
});

test('P1-F6: the body slot is held until the upstream answers, and a large package gets a longer budget', async () => {
  const { handleImport, upstreamTimeout } = load('lib/adminCatalogTools/importProxy.ts');
  assert.equal(upstreamTimeout('GET', 0), 15_000);
  assert.equal(upstreamTimeout('POST', 0), 90_000);
  assert.equal(upstreamTimeout('POST', 256 * 1024 * 1024), 90_000 + 256_000, 'a 256 MB package is not held to 90s');
  let release;
  const up = importUpstream();
  const fetcher = async (url, init) => {
    if (String(url).includes('action=get_user')) return up.fetcher(url, init);
    await new Promise((resolve) => { release = resolve; });
    return json({ success: true, stage: 'done', upload_id: 'fixture-import-1' });
  };
  const form = () => { const f = new FormData(); f.set('upload_id', 'fixture-import-1'); f.set('package', new File(['data'], 'package.ppsync')); return f; };
  const first = handleImport(post('dictionary', form()), 'dictionary', fetcher);
  for (let i = 0; i < 20 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(release, 'the first import reached the upstream');
  const busy = await handleImport(post('dictionary', form()), 'dictionary', up.fetcher);
  assert.equal(busy.status, 503, 'the package is still held in memory, so the slot is too');
  release();
  assert.equal((await first).status, 200);
  const after = await handleImport(post('dictionary', form()), 'dictionary', up.fetcher);
  assert.equal(after.status, 200, 'the slot went back once the upstream answered');
});
