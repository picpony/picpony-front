/** F5 site administration: cached-original contracts, strict boundaries, no real transport. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, overrides = {}, globals = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, Error, Response, URL, URLSearchParams, AbortController, Headers, DOMException, setTimeout, clearTimeout, ...globals,
    require: (name) => {
      if (name in overrides) return overrides[name];
      const target = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name);
      return load(`${target}.ts`, overrides, globals, cache);
    },
  }, { filename: file });
  return exports;
}
const model = load('lib/adminSiteTools/model.ts');
const cloud = { semantic_cloud_enabled: true, semantic_cloud_base_url: 'https://models.example.test/v1/chat/completions', semantic_cloud_model: 'pony', semantic_cloud_timeout_ms: '15000', semantic_cloud_api_key: '', semantic_cloud_clear_key: false };
const assistant = { name: '彩彩', base_url: 'https://models.example.test/v1', models_url: '', model: 'pony', api_key: '', timeout_ms: '15000', max_tokens: '800', temperature: '0', enabled: true, clear_key: false, model_candidates: ['pony'], system_prompt: '温柔地回答' };
const catalog = { model_catalog: ['pony'], model_candidates: ['pony'], model_benchmarks: { pony: { ok: true, latency_ms: 25 } }, model: 'pony' };
function fixture(payload = { success: true }, status = 200, imageOk = true) {
  const calls = [];
  const images = [];
  let currentToken = 'fixture-token';
  const hooks = { clearUserInfo() {}, readToken: () => currentToken, readUserInfo: () => ({ api_key: '' }) };
  const api = load('lib/api/adminSiteTools.ts', {
    './admin': {}, './messages': { readAnnouncementHistory() {} }, '@/lib/hooks': hooks,
    '@/lib/constants': { PICPONY_API_BASE: 'https://fixture.test/api.php', DERPIBOORU_API_BASE: 'https://fixture.test/api/v1/json', IMAGE_CDN_BASE: 'https://cdn.fixture.test/?url=', IMAGE_WORKER_BASE: 'https://worker.fixture.test/?url=', IMAGE_PROBE_URL: 'https://images.fixture.test/probe.png', PICPONY_API_ORIGIN: 'https://site.fixture.test' },
    '@/lib/route': { ensureRoutePolicy: async () => {}, refreshRoutePolicy: async () => {}, buildApiLineUrl: (url) => url, resolveApiLine: () => 'direct', apiPolicy: () => 'auto',
      /* The real `probeImage` decodes a bitmap, which is the only evidence an image proxy is up. */
      probeImage: async (url) => { images.push(String(url)); if (!imageOk) throw new Error('probe failed'); } },
  }, { fetch: async (url, options = {}) => { calls.push({ url: String(url), options }); return Response.json(typeof payload === 'function' ? payload(calls.length) : payload, { status }); } });
  return { api, calls, images, setToken: (token) => { currentToken = token; } };
}

test('numeric settings reject blank, fractions, exponent notation and unsafe values; explicit zero survives', () => {
  for (const bad of ['', ' ', '2.5', '1e3', '-1', '9007199254740992']) assert.equal(model.integer(bad, 0, 100000), null);
  assert.equal(model.fieldsPayload(model.quotaFields, { enabled: false, daily_points: '0', points_per_coin: '1' }).daily_points, 0);
  assert.equal(model.assistantPayload(assistant).temperature, 0);
  for (const [key, val] of [['timeout_ms', '999'], ['max_tokens', '4097'], ['temperature', '2.1']]) assert.throws(() => model.assistantPayload({ ...assistant, [key]: val }));
});
test('URL, origin, IP and date validation fails before submitting any setting', () => {
  for (const s of ['javascript:alert(1)', 'https://user:password@example.test', '//example.test', 'https://example.test/#secret']) assert.equal(model.webUrl(s), false);
  assert.equal(model.webUrl('https://example.test:10443/v1'), true);
  for (const s of ['2026-02-30', '2026-13-01', 'nonsense']) assert.throws(() => model.dateValue(s));
  assert.equal(model.dateValue('2024-02-29'), '2024-02-29');
  assert.equal(model.ipAddress('256.1.2.3'), false);
  assert.equal(model.ipAddress('2001:db8::1'), true);
  assert.equal(model.ipAddress('::ffff:192.168.1.1'), true);
  assert.throws(() => model.routePayload({ policy: 'third_party', third_party_urls: '', third_party_pass_api_key: false }));
  assert.throws(() => model.routePayload({ policy: 'third_party', third_party_urls: 'http://example.test', third_party_pass_api_key: false }));
  assert.throws(() => model.fieldsPayload(model.relayFields, { concurrency: '50', switchback_enabled: true, whitelisted_ips: 'broken', allowed_origins: '' }));
});
test('acknowledged policy patches affect only their own axis, honor valid server normalization and exclude secret fields', () => {
  assert.deepEqual(plain(model.savedRoutePatch('image', { policy: 'cdn' }, { success: true, api_key: 'secret' })), { global_image_route_policy: 'cdn' });
  assert.deepEqual(plain(model.savedRoutePatch('api', { policy: 'third_party', third_party_urls: 'https://one.test\nhttps://two.test', third_party_pass_api_key: false }, { global_api_third_party_url: 'https://two.test', semantic_cloud_api_key: 'secret' })), { global_api_route_policy: 'third_party', global_api_third_party_url: 'https://two.test', global_api_third_party_pass_api_key: false });
});
test('accepted cloud timing shares the public rule, handles key clearing, and cannot overwrite a concurrent mode save', () => {
  const cache = new Map();
  const globals = { window: {} };
  const { savedSemanticTiming } = load('lib/adminSiteTools/propagation.ts', {}, globals, cache);
  const status = load('lib/siteStatus.ts', {}, globals, cache);
  assert.deepEqual(plain(savedSemanticTiming(cloud, {}, true)), { estimateMs: 3500, timeoutMs: 17000 });
  assert.deepEqual(plain(savedSemanticTiming({ ...cloud, semantic_cloud_timeout_ms: '1000', semantic_cloud_clear_key: true }, {}, true)), { estimateMs: 7000, timeoutMs: 16000 });
  const timing = savedSemanticTiming({ ...cloud, semantic_cloud_timeout_ms: '1000', semantic_cloud_api_key: 'fixture-secret' }, { semantic_search_mode: 'legacy', semantic_cloud_api_key: 'echoed-secret', semantic_cloud_base_url: 'https://private.fixture.test' }, false);
  status.publishSavedSiteStatus({ semantic: { availability: 'off' } });
  status.publishSavedSiteStatus({ semantic: timing });
  assert.deepEqual(plain(status.getSavedSiteStatus()), { semantic: { availability: 'off', estimateMs: 3500, timeoutMs: 9000 } });
  assert.deepEqual(plain(savedSemanticTiming(cloud, { semantic_cloud_timeout_ms: 6000, semantic_cloud_has_key: true, semantic_search_estimate_ms: 1234 }, false)), { estimateMs: 1234, timeoutMs: 8000 });
});
test('announcement preserves original HTML/newline contract and rejects incomplete drafts', () => {
  assert.deepEqual(plain(model.announcementPayload({ version: ' v1 ', title: ' 更新 ', content: '<b>你好</b>\r\n第二行' })), { version: 'v1', title: '更新', content: '<b>你好</b><br>第二行' });
  assert.throws(() => model.announcementPayload({ version: '', title: '更新', content: '内容' }));
});
test('config secrets never become form defaults, clear and replace are mutually exclusive', () => {
  assert.equal(model.configValues(model.assistantFields, { ...assistant, api_key: 'server-secret' }).api_key, '');
  assert.throws(() => model.assistantPayload({ ...assistant, api_key: 'fixture-secret', clear_key: true }));
  assert.throws(() => model.cloudPayload({ ...cloud, semantic_cloud_api_key: 'fixture-secret', semantic_cloud_clear_key: true }));
  assert.throws(() => model.assistantPayload({ ...assistant, system_prompt: 'x'.repeat(12001) }));
});
test('atomic rate rule payload excludes labels and validates every rule', () => {
  const rules = [{ action: 'search', label: '搜索', max: '20', window: '60', key_type: 'ip' }];
  assert.deepEqual(plain(model.ratePayload(rules)), { rules: { search: { max: 20, window: 60, key_type: 'ip' } } });
  assert.throws(() => model.ratePayload([...rules, { ...rules[0], action: 'bad', window: '0' }]));
});

const mutations = [
  ['saveSemanticMode', [{ semantic_search_mode: 'qwen' }], 'admin_toggle_semantic_search', { semantic_search_mode: 'qwen' }],
  ['saveSemanticCloud', [cloud], 'admin_save_semantic_cloud', { ...cloud, semantic_cloud_timeout_ms: 15000 }],
  ['testSemanticCloud', [], 'admin_test_semantic_cloud', {}, { success: true, ms: 20 }],
  ['archiveFeedback', [7, false], 'admin_archive_semantic_feedback', { id: 7, archived: false }],
  ['deleteFeedback', [[7, 8]], 'admin_delete_semantic_feedback', { ids: [7, 8] }],
  ['saveApiRoute', [{ policy: 'third_party', third_party_urls: 'https://one.test\nhttps://two.test', third_party_pass_api_key: true }], 'admin_save_global_api_route_policy', { policy: 'third_party', third_party_urls: 'https://one.test\nhttps://two.test', third_party_pass_api_key: true }],
  ['saveImageRoute', [{ policy: 'cdn' }], 'admin_save_global_image_route_policy', { policy: 'cdn' }],
  ['saveRelayConfig', [{ concurrency: '60', switchback_enabled: false, whitelisted_ips: '127.0.0.1\n::1', allowed_origins: 'https://site.test' }], 'save_relay_config', { concurrency: 60, switchback_enabled: false, whitelisted_ips: ['127.0.0.1', '::1'], allowed_origins: ['https://site.test'] }],
  ['saveRateLimits', [[{ action: 'search', label: '搜索', max: '30', window: '60', key_type: 'user' }]], 'admin_save_rate_limit_rules', { rules: { search: { max: 30, window: 60, key_type: 'user' } } }],
  ['releaseLock', [9], 'admin_release_temporary_lock', { user_id: 9 }],
  ['banDeveloper', [9], 'admin_ban_developer', { target_id: 9 }],
  ['unbanDeveloper', [9], 'admin_unban_developer', { target_id: 9 }],
  ['toggleAccelerationBan', [9, true], 'admin_toggle_api_accel_ban', { id: 9, banned: 1 }],
  ['toggleAccelerationBan', [9, false], 'admin_toggle_api_accel_ban', { id: 9, banned: 0 }],
  ['generateWhitelistInvite', [], 'admin_generate_whitelist_invite', undefined, { success: true, url: 'https://picpony.test/invite/fixture' }],
  ['cleanupLegacyVerifications', [], 'admin_cleanup_legacy_derpi_verifications', undefined, { success: true, cleared_count: 2 }],
  ['saveAiQuota', [{ enabled: false, daily_points: '0', points_per_coin: '7' }], 'admin_save_ai_quota', { enabled: false, daily_points: 0, points_per_coin: 7 }],
  ['saveAssistantConfig', [assistant], 'admin_save_ai_assistant_config', { ...assistant, timeout_ms: 15000, max_tokens: 800, temperature: 0 }],
  ['testAssistant', [], 'admin_test_ai_assistant_provider', {}, { success: true, latency_ms: 20 }],
  ['listAssistantModels', [], 'admin_list_ai_assistant_models', {}, { success: true, ...catalog }],
  ['discoverAssistantModels', [assistant], 'admin_discover_ai_assistant_models', { ...assistant, timeout_ms: 15000, max_tokens: 800, temperature: 0 }, { success: true, ...catalog }],
];
for (const [method, args, action, body, response] of mutations) test(`original wire contract: ${action}${method === 'toggleAccelerationBan' ? ` banned=${args[1]}` : ''}`, async () => {
  const f = fixture(response);
  const result = await f.api[method]('fixture-token', ...args);
  assert.equal((await result.json()).success, true);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(new URL(call.url).searchParams.get('action'), action);
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.get('Authorization'), 'Bearer fixture-token');
  assert.deepEqual(call.options.body === undefined ? undefined : JSON.parse(call.options.body), body);
});
test('mutations require explicit success and never retry ambiguous/malformed responses', async () => {
  for (const response of [{}, { success: 'true' }, { success: false }, []]) {
    const f = fixture(response);
    await assert.rejects(f.api.banDeveloper('fixture-token', 9));
    assert.equal(f.calls.length, 1);
  }
});
test('confidential errors preserve refusal vs capability status without reflecting credentials', async () => {
  for (const status of [400, 403, 404, 501]) {
    const f = fixture({ success: false, error: 'fixture-secret 是无效密钥' }, status);
    await assert.rejects(f.api.saveAssistantConfig('fixture-token', assistant), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /fixture-secret/);
      if (status === 404 || status === 501) assert.match(error.message, /尚未提供/);
      return true;
    });
  }
});
test('feedback pagination preserves exact query/filter and cancellation', async () => {
  const f = fixture({ success: true, items: [], total: 21, page: 2 });
  const controller = new AbortController();
  const page = await f.api.readFeedback('fixture-token', { status: 'archived', q: ' 中文 ', page: 2 }, controller.signal);
  const query = Object.fromEntries(new URL(f.calls[0].url).searchParams);
  assert.deepEqual(query, { action: 'admin_list_semantic_feedback', page: '2', per_page: '20', status: 'archived', q: '中文' });
  assert.equal(page.totalPages, 2);
  controller.abort();
  assert.equal(f.calls[0].options.signal.aborted, true);
});
test('malformed lists and required config never render as successful empty data', async () => {
  await assert.rejects(fixture({ success: true, items: null, total: 0 }).api.readFeedback('fixture-token', { status: 'new', q: '', page: 1 }));
  await assert.rejects(fixture({ success: true, quota_config: {} }).api.readAiQuota('fixture-token'));
  await assert.rejects(fixture({ success: true, logs: [], dates: [], total: 'bad', available: true }).api.readRelayErrors('fixture-token', { page: 1, date: '' }));
  await assert.rejects(fixture({ success: true }).api.listAssistantModels('fixture-token'));
});
test('model benchmarks accept fractional milliseconds and errors without an ok field', () => {
  const f = fixture();
  const result = f.api.modelList({ model_catalog: ['a', 'b'], model_benchmarks: { a: { ok: true, latency_ms: 10.25 }, b: { error: 'unavailable' } } });
  assert.equal(result.benchmarks.a.latency, 10.25);
  assert.equal(result.benchmarks.b.ok, false);
  assert.throws(() => f.api.modelList({ model_catalog: {}, model_benchmarks: {} }));
});
test('manual accelerator checks judge an image line by a decode and an API line by its status', async () => {
  /* The three image lines are proxies: an opaque `fetch` resolves on a 500 as readily as on a 200,
     so only a decoded bitmap answers "does this line work" (AGENTS, "Request lines"). They must make
     no `fetch` at all; the four API/site lines still report their HTTP status. */
  const f = fixture({ success: true }, 503), reports = [];
  await f.api.checkServiceLines('fixture-token', new AbortController().signal, (row) => reports.push(row));
  assert.equal(reports.length, 7);
  assert.equal(f.images.length, 3, 'three image lines are decoded, not fetched');
  assert.ok(f.images.every((url) => /[?&]_t=\d+/.test(url)), 'an image probe must not be answered from cache');
  assert.equal(f.calls.length, 4);
  assert.deepEqual(reports.filter((r) => r.status === 'decoded').map((r) => r.name), ['图片加速服务器', '图片 CDN', '图片直连']);
  assert.ok(reports.filter((r) => r.status !== 'decoded').every((r) => r.status === 503 && !r.error));
  assert.ok(f.calls.every((r) => r.options.credentials === 'omit' && r.options.signal));

  const failing = fixture({ success: true }, 200, false), failed = [];
  await failing.api.checkServiceLines('fixture-token', new AbortController().signal, (row) => failed.push(row));
  const image = failed.find((r) => r.name === '图片 CDN');
  assert.equal(image.status, null); assert.equal(image.error, '无法加载图片');

  const stopped = fixture(), controller = new AbortController();
  await assert.rejects(stopped.api.checkServiceLines('fixture-token', controller.signal, () => controller.abort()), (e) => e.name === 'AbortError');
  assert.equal(stopped.images.length, 1, 'cancellation is observed between probes');
  assert.equal(stopped.calls.length, 0);
});
test('site-stat collection completes all totals and abandons stale account before any subsequent request', async () => {
  const f = fixture(() => ({ total: 42 }));
  assert.deepEqual(plain(await f.api.collectSiteStats('fixture-token', () => true)), { images: 42, tags: 42, comments: 42 });
  assert.equal(f.calls.length, 3);
  assert.equal(new URL(f.calls[0].url).searchParams.get('filter_id'), '56027');
  const stale = fixture(() => { stale.setToken('other-account'); return { total: 42 }; });
  assert.equal(await stale.api.collectSiteStats('fixture-token', () => true), null);
  assert.equal(stale.calls.length, 1);
  const failed = fixture({ total: 'bad' });
  await assert.rejects(failed.api.collectSiteStats('fixture-token', () => true));
  assert.equal(failed.calls.length, 1);
});

/* ---- F7 FX3 (admin2): optional fields, timestamp units, outcome-unknown writes, derived views ---- */
test('G2-005 / NEW-1: 最后请求 reads its unit from the magnitude — the same instant in ms or s prints the same', async () => {
  const instant = Date.UTC(2025, 9, 3, 14, 0, 0);
  assert.equal(model.epochStamp(instant), instant, 'a millisecond stamp is kept (both original consoles read it as one)');
  assert.equal(model.epochStamp(instant / 1000), instant, 'a second stamp is scaled');
  assert.equal(model.epochStamp(String(instant)), instant);
  assert.equal(model.epochStamp(String(instant / 1000)), instant);
  /* The boundary: 1e11 seconds is the year 5138, 1e11 milliseconds is 1973. */
  assert.equal(model.epochStamp(99_999_999_999), 99_999_999_999_000);
  assert.equal(model.epochStamp(100_000_000_000), 100_000_000_000);
  assert.equal(model.epochStamp('2026-10-03 22:00:00'), '2026-10-03 22:00:00', 'a formatted stamp is kept as text');
  for (const bad of [null, undefined, '', '  ', -1, Number.NaN, {}]) assert.equal(model.epochStamp(bad), null);
  for (const last_seen of [instant, instant / 1000]) {
    const f = fixture({ success: true, stats: [{ ip: '1.2.3.4', username: '', total: 1, search: 0, normal: 1, last_seen }], pagination: { total: 1 } });
    const page = await f.api.readRelayStats('fixture-token', { range: '1', date: '', page: 1, sort: 'total', order: 'desc' });
    assert.equal(page.rows[0].last_seen, instant);
  }
});
test('NEW-3: an error log that does not exist yet is an empty log, not a failed page', async () => {
  for (const envelope of [{}, { dates: null }, { available: null }, { available: false }, { dates: [] }]) {
    const page = await fixture({ success: true, logs: [], total: 0, page: 1, ...envelope }).api.readRelayErrors('fixture-token', { page: 1, date: '' });
    assert.equal(page.available, false, JSON.stringify(envelope));
    assert.deepEqual(plain(page.dates), []);
    assert.equal(page.rows.length, 0);
  }
  const live = await fixture({ success: true, logs: [], total: 0, page: 1, available: true, dates: ['2026-10-01'] }).api.readRelayErrors('fixture-token', { page: 1, date: '' });
  assert.equal(live.available, true); assert.deepEqual(plain(live.dates), ['2026-10-01']);
  /* A wrong type is still a broken response — only absence is information. */
  await assert.rejects(fixture({ success: true, logs: [], total: 0, available: true, dates: { a: 1 } }).api.readRelayErrors('fixture-token', { page: 1, date: '' }));
  await assert.rejects(fixture({ success: true, logs: [], total: 0, available: 'yes', dates: [] }).api.readRelayErrors('fixture-token', { page: 1, date: '' }));
});
test('G2-003: a missing has_key or a missing latency is unknown, never a failed panel or an invented 0', async () => {
  const config = { success: true, name: '彩彩', base_url: 'https://models.example.test/v1', models_url: '', model: 'pony', timeout_ms: 15000, max_tokens: 800, temperature: 0, enabled: true, system_prompt: '', model_candidates: ['pony'], model_catalog: ['pony', 'mare'], model_benchmarks: { pony: { ok: true }, mare: { ok: true, latency_ms: 25 } } };
  const read = await fixture(config).api.readAssistantConfig('fixture-token');
  assert.equal(read.hasKey, false, 'no flag is no saved key');
  assert.equal(read.values.name, '彩彩');
  assert.equal(read.benchmarks.pony.ok, true); assert.equal(read.benchmarks.pony.latency, null);
  assert.equal(read.benchmarks.mare.latency, 25);
  assert.equal((await fixture({ ...config, has_key: true }).api.readAssistantConfig('fixture-token')).hasKey, true);
  /* A wrong type still fails: absence is information, a garbled flag is not. */
  await assert.rejects(fixture({ ...config, has_key: 'maybe' }).api.readAssistantConfig('fixture-token'));
  assert.throws(() => fixture().api.modelList({ model_catalog: ['a'], model_benchmarks: { a: { ok: true, latency_ms: 'fast' } } }));
  /* A test that answered without timing itself is a working connection. */
  assert.equal((await (await fixture({ success: true }).api.testAssistant('fixture-token')).json()).success, true);
  assert.equal((await (await fixture({ success: true, model: 'pony' }).api.testSemanticCloud('fixture-token')).json()).success, true);
});
test('G2-009: a write nobody heard the answer to is outcome-unknown, held without a retry; a refusal stays a refusal', async () => {
  const unknown = (error) => { assert.equal(error.name, 'ApiError'); assert.match(error.message, /未能确认操作结果/); assert.equal(error.retryable, false); return true; };
  /* No answer at all. */
  const lost = fixture(() => { throw new TypeError('socket hang up'); });
  await assert.rejects(lost.api.generateWhitelistInvite('fixture-token'), unknown);
  assert.equal(lost.calls.length, 1, 'never retried');
  /* An answer that does not say what happened. */
  for (const [payload, status] of [[{ success: false, error: '上游错误' }, 500], [{ success: true }, 502], [{}, 200], [{ success: 'true' }, 200], [[], 200]]) {
    const f = fixture(payload, status);
    await assert.rejects(f.api.generateWhitelistInvite('fixture-token'), unknown);
    assert.equal(f.calls.length, 1);
  }
  /* Answers: a refusal, a missing feature, a refusal by status. None of them is unknown. */
  await assert.rejects(fixture({ success: false, error: '权限不足' }, 200).api.banDeveloper('fixture-token', 9), (error) => { assert.doesNotMatch(error.message, /未能确认/); assert.equal(error.message, '权限不足'); return true; });
  await assert.rejects(fixture({ success: false }, 501).api.generateWhitelistInvite('fixture-token'), (error) => { assert.match(error.message, /尚未提供/); return true; });
  await assert.rejects(fixture({ success: false }, 403).api.generateWhitelistInvite('fixture-token'), (error) => { assert.doesNotMatch(error.message, /未能确认/); return true; });
  /* Minted, but the address is unusable: the catalogue's uncertain state, with the sentence that says so. */
  await assert.rejects(fixture({ success: true, url: '/invite/relative' }).api.generateWhitelistInvite('fixture-token'), (error) => {
    assert.equal(error.message, '邀请链接已生成，但返回地址无效，请刷新后核对，勿重复生成');
    assert.equal(error.retryable, false);
    return true;
  });
  /* The class is the catalogue's own, so `useCatalogMutation` holds it: one rule, not two. */
  const f = fixture(() => { throw new TypeError('offline'); });
  const error = await f.api.cleanupLegacyVerifications('fixture-token').catch((e) => e);
  assert.ok(error instanceof f.api.WriteOutcomeUnknown);
  assert.equal(Object.getPrototypeOf(f.api.WriteOutcomeUnknown.prototype).constructor.name, 'CatalogOutcomeUnknown');
});
test('G2-019: the site tools derive from the shared documents; a view keeps its identity per answer', () => {
  const api = fixture().api;
  const doc = { success: true, semantic_search_mode: 'qwen', semantic_cloud_enabled: true, semantic_cloud_base_url: 'https://models.example.test/v1/chat/completions', semantic_cloud_model: 'pony', semantic_cloud_timeout_ms: 8000, semantic_cloud_has_key: true, global_api_route_policy: 'third_party', global_api_third_party_urls: ['https://one.test'], global_api_third_party_pass_api_key: false, global_image_route_policy: 'cdn' };
  const tools = api.siteToolsStatus(doc);
  assert.equal(tools.mode, 'qwen'); assert.equal(tools.hasKey, true);
  assert.equal(tools.api.policy, 'third_party'); assert.equal(tools.api.third_party_urls, 'https://one.test'); assert.equal(tools.image.policy, 'cdn');
  assert.throws(() => api.siteToolsStatus({ ...doc, global_api_third_party_urls: [7] }));
  assert.deepEqual(plain(api.visitorStats({ today_new_users: 7, online_users_30m: '3', today_visitors: 42, online_visitors_30m: 5 })), { today: 7, online: 3, visitors: 42, onlineVisitors: 5 });
  assert.throws(() => api.visitorStats(undefined), 'absent stats fail 访问统计 alone');
  const SKIP = Symbol('skip');
  const queries = load('components/admin/queries.ts', {
    '@/lib/resource': { SKIP, defineResource: (o) => o, useResource: () => ({}) },
    '@/lib/hooks': { readToken: () => 'fixture-token' },
  });
  let runs = 0;
  const view = queries.derived((source) => { runs += 1; if (source.bad) throw new Error('bad'); return { mode: source.mode }; });
  const first = { mode: 'a' };
  assert.equal(view(first), view(first), 'one answer, one view');
  assert.equal(runs, 1);
  assert.notEqual(view({ mode: 'a' }), view(first), 'a new answer is a new view');
  const broken = { bad: true };
  assert.throws(() => view(broken)); assert.throws(() => view(broken));
  assert.equal(runs, 3, 'a failure is remembered too');
});

test('review P6-O3: announcement breaks are kept in text and left out beside block tags', () => {
  assert.equal(model.announcementHtml('第一行\n第二行'), '第一行<br>第二行');
  assert.equal(model.announcementHtml('<ul>\n<li>一</li>\n<li>二</li>\n</ul>\n结尾'), '<ul>\n<li>一</li>\n<li>二</li>\n</ul>\n结尾');
  assert.equal(model.announcementHtml('a\r\nb'), 'a<br>b');
});
