/** F5 site administration against `/api/v1`: wire contracts, strict boundaries, no real transport. */
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
  vm.runInNewContext(code, { exports, Error, TypeError, Response, URL, URLSearchParams, AbortController, Headers, DOMException, setTimeout, clearTimeout, crypto, ...globals,
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
const provider = { name: '彩彩', base_url: 'https://models.example.test/v1', models_url: '', model: 'pony', model_selection: 'auto', model_candidates: ['pony'], api_key: '', timeout_ms: '15000', max_tokens: '800', temperature: '0', thinking: 'off', system_prompt: '温柔地回答', enabled: true, is_primary: true, fallback_rank: '0', clear_key: false };

/**
 * The adapters with `./http`'s `api` and `@/lib/adminMutations` replaced: every call is recorded as
 * `{ method, path, options, write }` and answered by `reply(call, n)` (a value, or a throw).
 * `fetch` is only the Derpibooru reads and the line probes, which bypass the backend.
 */
function fixture(reply = () => ({}), { fetchPayload = { total: 1 }, fetchStatus = 200, imageOk = true } = {}) {
  const calls = [];
  const fetches = [];
  const images = [];
  let currentToken = 'fixture-token';
  const cache = new Map();
  const errors = load('lib/api/errors.ts', {}, {}, cache);
  const send = async (method, path, options = {}, write = false) => {
    const call = { method, path, options, write };
    calls.push(call);
    return reply(call, calls.length);
  };
  const http = {
    api: (method, path, options) => send(method, path, options),
    seg: (value) => encodeURIComponent(String(value)),
    deadlineSignal: (caller) => ({ signal: caller ?? new AbortController().signal, timedOut: () => false, dispose() {} }),
    readObject: async (res) => {
      const data = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new errors.ApiError('invalid');
      return data;
    },
  };
  const mutations = {
    requestUuid: () => '00000000-0000-4000-8000-000000000000',
    adminWrite: async (method, path, options) => (await send(method, path, { idempotencyKey: 'fixture-key', ...options }, true)) ?? {},
  };
  const api = load('lib/api/adminSiteTools.ts', {
    './http': http, '@/lib/adminMutations': mutations,
    './messages': { readAnnouncementHistory() {} },
    '@/lib/hooks': { readToken: () => currentToken, readUserInfo: () => ({ api_key: '' }) },
    '@/lib/constants': { DERPIBOORU_API_BASE: 'https://fixture.test/api/v1/json', IMAGE_CDN_BASE: 'https://cdn.fixture.test/?url=', IMAGE_WORKER_BASE: 'https://worker.fixture.test/?url=', IMAGE_PROBE_URL: 'https://images.fixture.test/probe.png', PICPONY_API_ORIGIN: 'https://site.fixture.test' },
    '@/lib/route': { ensureRoutePolicy: async () => {}, refreshRoutePolicy: async () => {}, buildApiLineUrl: (url) => url, resolveApiLine: () => 'direct', apiPolicy: () => 'auto',
      /* The real `probeImage` decodes a bitmap, which is the only evidence an image proxy is up. */
      probeImage: async (url) => { images.push(String(url)); if (!imageOk) throw new Error('probe failed'); } },
  }, { fetch: async (url, options = {}) => { fetches.push({ url: String(url), options }); return Response.json(typeof fetchPayload === 'function' ? fetchPayload(fetches.length) : fetchPayload, { status: fetchStatus }); } }, cache);
  return { api, calls, fetches, images, errors, setToken: (token) => { currentToken = token; } };
}
const refusal = (f, status, serverMessage = '权限不足') => new f.errors.ApiError('http', { status, serverMessage });

test('numeric settings reject blank, fractions, exponent notation and unsafe values; explicit zero survives', () => {
  for (const bad of ['', ' ', '2.5', '1e3', '-1', '9007199254740992']) assert.equal(model.integer(bad, 0, 100000), null);
  assert.equal(model.fieldsPayload(model.quotaFields, { enabled: false, daily_points: '0', points_per_coin: '1' }).daily_points, 0);
  assert.equal(model.providerPayload(provider).temperature, 0);
  for (const [key, val] of [['timeout_ms', '999'], ['max_tokens', '4097'], ['temperature', '2.1']]) assert.throws(() => model.providerPayload({ ...provider, [key]: val }));
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
test('the route editors offer auto on both lines, and the candidates are deduplicated in order', () => {
  assert.ok(model.apiRouteFields[0].options.some((o) => o.value === 'auto'));
  assert.ok(model.imageRouteFields[0].options.some((o) => o.value === 'auto'));
  assert.deepEqual(plain(model.routePayload({ policy: 'auto', third_party_urls: '', third_party_pass_api_key: false })), { policy: 'auto', third_party_urls: '', third_party_pass_api_key: false });
  assert.equal(model.routePayload({ policy: 'third_party', third_party_urls: 'https://two.test\nhttps://one.test https://two.test', third_party_pass_api_key: true }).third_party_urls, 'https://two.test\nhttps://one.test');
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
  assert.equal(model.providerValues({ ...provider, api_key: 'server-secret' }).api_key, '');
  assert.throws(() => model.providerPayload({ ...provider, api_key: 'fixture-secret', clear_key: true }));
  assert.throws(() => model.cloudPayload({ ...cloud, semantic_cloud_api_key: 'fixture-secret', semantic_cloud_clear_key: true }));
  assert.throws(() => model.providerPayload({ ...provider, system_prompt: 'x'.repeat(12001) }));
  assert.throws(() => model.textTranslationPayload({ enabled: true, endpoint: 'https://api.cognitive.microsofttranslator.com', region: '', target_language: 'zh-Hans', timeout_ms: '5000', api_key: 'k', clear_key: true }));
});
test('atomic rate rule payload excludes labels and validates every rule', () => {
  const rules = [{ action: 'search', label: '搜索', max: '20', window: '60', key_type: 'ip' }];
  assert.deepEqual(plain(model.ratePayload(rules)), { rules: { search: { max: 20, window: 60, key_type: 'ip' } } });
  assert.throws(() => model.ratePayload([...rules, { ...rules[0], action: 'bad', window: '0' }]));
});

/* [adapter, args, method, path, body] — every console write is one `adminWrite` (an Idempotency-Key). */
const mutations = [
  ['saveSemanticMode', [{ semantic_search_mode: 'qwen' }], 'PUT', '/admin/semantic-search', { semantic_search_mode: 'qwen' }],
  ['saveSemanticCloud', [cloud], 'PUT', '/admin/semantic-cloud', { ...cloud, semantic_cloud_timeout_ms: 15000 }],
  ['testSemanticCloud', [], 'POST', '/admin/semantic-cloud/tests', undefined],
  ['archiveFeedback', [7, false], 'PUT', '/admin/search/feedback/7/archive', { archived: false }],
  ['deleteFeedback', [[7, 8, 7]], 'POST', '/admin/search/feedback/deletions', { ids: [7, 8] }],
  ['saveApiRoute', [{ policy: 'third_party', third_party_urls: 'https://one.test\nhttps://two.test', third_party_pass_api_key: true }], 'PUT', '/admin/api-route-policy', { policy: 'third_party', third_party_urls: ['https://one.test', 'https://two.test'], third_party_pass_api_key: true }],
  ['saveApiRoute', [{ policy: 'auto', third_party_urls: '', third_party_pass_api_key: false }], 'PUT', '/admin/api-route-policy', { policy: 'auto', third_party_urls: [], third_party_pass_api_key: false }],
  ['saveImageRoute', [{ policy: 'auto' }], 'PUT', '/admin/image-route-policy', { policy: 'auto' }],
  ['saveRelayConfig', [{ concurrency: '60', switchback_enabled: false, whitelisted_ips: '127.0.0.1\n::1', allowed_origins: 'https://site.test' }], 'PUT', '/admin/relay-config', { concurrency: 60, switchback_enabled: false, whitelisted_ips: ['127.0.0.1', '::1'], allowed_origins: ['https://site.test'] }],
  ['saveRateLimits', [[{ action: 'search', label: '搜索', max: '30', window: '60', key_type: 'user' }]], 'PUT', '/admin/rate-limit-rules', { rules: { search: { max: 30, window: 60, key_type: 'user' } } }],
  ['releaseLock', [9], 'POST', '/admin/temporary-locks/9/release', undefined],
  ['toggleAccelerationBan', [9, true], 'POST', '/admin/api-accel-bans', { id: 9, banned: true }],
  ['toggleAccelerationBan', [9, false], 'POST', '/admin/api-accel-bans', { id: 9, banned: false }],
  ['saveAiQuota', [3, { enabled: false, daily_points: '0', points_per_coin: '7' }], 'PUT', '/admin/assistant/quota-config', { expected_revision: 3, enabled: false, daily_points: 0, points_per_coin: 7 }],
];
for (const [method, args, verb, route, body] of mutations) test(`wire contract: ${method} → ${verb} ${route}${method === 'toggleAccelerationBan' || method === 'saveApiRoute' ? ` (${JSON.stringify(args.at(-1))})` : ''}`, async () => {
  const f = fixture(() => ({ ok: true }));
  await f.api[method]('fixture-token', ...args);
  assert.equal(f.calls.length, 1);
  const [call] = f.calls;
  assert.equal(call.write, true, 'a console write goes through adminWrite (Idempotency-Key)');
  assert.equal(call.method, verb);
  assert.equal(call.path, route);
  assert.equal(call.options.token, 'fixture-token');
  assert.deepEqual(call.options.json === undefined ? undefined : plain(call.options.json), body);
  assert.equal(f.fetches.length, 0, 'nothing bypasses the transport');
});
test('assistant provider writes name the global revision and carry the backend retry key', async () => {
  const configuration = { revision: 5, default_system_prompt: '默认', providers: [] };
  const f = fixture(() => ({ saved_id: 'p1', configuration }));
  const draft = model.providerPayload(provider);
  const saved = await f.api.saveAssistantProvider('fixture-token', 4, draft);
  assert.equal(saved.savedId, 'p1'); assert.equal(saved.config.revision, 5);
  assert.equal(f.calls[0].method, 'POST'); assert.equal(f.calls[0].path, '/admin/assistant/providers');
  assert.equal(f.calls[0].options.json.expected_revision, 4);
  assert.match(f.calls[0].options.json.request_id, /^[0-9a-f-]{36}$/);
  assert.equal('api_key' in f.calls[0].options.json, false, 'an empty key is not sent');
  await f.api.saveAssistantProvider('fixture-token', 5, { ...draft, api_key: 'new-key' }, 'p 1');
  assert.equal(f.calls[1].method, 'PUT'); assert.equal(f.calls[1].path, '/admin/assistant/providers/p%201');
  assert.equal(f.calls[1].options.json.api_key, 'new-key');
  const removing = fixture(() => configuration);
  await removing.api.removeAssistantProvider('fixture-token', 5, 'p1');
  assert.equal(removing.calls[0].method, 'DELETE'); assert.equal(removing.calls[0].options.json.expected_revision, 5);
});
test('a refusal keeps its status and the backend sentence; a 501 says the server lacks it', async () => {
  for (const status of [400, 403, 409]) {
    const f = fixture((call) => { throw refusal(f, status, '配置版本已变化'); });
    await assert.rejects(f.api.saveRelayConfig('fixture-token', { concurrency: '60', switchback_enabled: false, whitelisted_ips: '', allowed_origins: '' }), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.message, '配置版本已变化');
      return true;
    });
    assert.equal(f.calls.length, 1, 'never retried');
  }
  const gone = fixture(() => { throw refusal(gone, 404, '用户不存在'); });
  await assert.rejects(gone.api.releaseLock('fixture-token', 9), (error) => { assert.equal(error.notFound, true); assert.equal(error.retryable, false); return true; });
  const missing = fixture(() => { throw refusal(missing, 501); });
  await assert.rejects(missing.api.releaseLock('fixture-token', 9), (error) => { assert.match(error.message, /尚未提供/); assert.equal(error.retryable, false); return true; });
});
test('feedback pagination sends the exact filter and cursor, and forwards cancellation', async () => {
  const f = fixture(() => ({ feedback: [{ id: 3, status: 'new', query: 'q', result: 'r', engine: 'qwen', username: null, created_at: '2026-10-01T00:00:00Z' }], next_cursor: 3, counts: { all: 21, new: 20, archived: 1 } }));
  const controller = new AbortController();
  const page = await f.api.readFeedback('fixture-token', { status: 'archived', q: ' 中文 ', before: 9 }, controller.signal);
  const [call] = f.calls;
  assert.equal(call.method, 'GET'); assert.equal(call.path, '/admin/search/feedback');
  assert.deepEqual(plain(call.options.query), { status: 'archived', keyword: '中文', before: 9, limit: 20 });
  assert.equal(call.options.signal, controller.signal);
  assert.equal(page.next, 3); assert.equal(page.rows[0].user, ''); assert.equal(page.counts.all, 21);
  await fixture(() => ({ feedback: [], next_cursor: null, counts: { all: 0, new: 0, archived: 0 } })).api.readFeedback('fixture-token', { status: 'new', q: '  ' });
});
test('the route panel reads both stored lines, with candidates, history and one revision', async () => {
  const f = fixture((call) => call.path === '/admin/api-route-policy'
    ? { global_api_route_policy: 'third_party', global_api_third_party_url: 'https://one.test', global_api_third_party_urls: ['https://one.test', 'https://two.test'], global_api_third_party_pass_api_key: true, relay_origin_previous_policy: 'auto', global_api_third_party_history: [{ time: '2026-10-18 10:00:00', url: 'https://one.test', reason: 'timeout' }, { url: 7 }], revision: 12 }
    : { global_image_route_policy: 'auto', revision: 12 });
  const routes = await f.api.readSiteRoutes('fixture-token');
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`).sort(), ['GET /admin/api-route-policy', 'GET /admin/image-route-policy']);
  assert.ok(f.calls.every((c) => c.write === false && c.options.json === undefined), 'a GET carries no body');
  assert.deepEqual(plain(routes.api), { policy: 'third_party', third_party_urls: 'https://one.test\nhttps://two.test', third_party_pass_api_key: true });
  assert.deepEqual(plain(routes.image), { policy: 'auto' });
  assert.equal(routes.revision, 12); assert.equal(routes.currentUrl, 'https://one.test'); assert.equal(routes.previousPolicy, 'auto');
  assert.deepEqual(plain(routes.history), [{ time: '2026-10-18 10:00:00', url: 'https://one.test', reason: 'timeout' }, { time: '', url: '', reason: '' }]);
});
test('the semantic panel reads the stored mode and cloud model; the key only as its mask', async () => {
  const f = fixture((call) => call.path === '/admin/semantic-search'
    ? { semantic_search_mode: 'qwen', semantic_search_enabled: true }
    : { semantic_cloud_enabled: true, semantic_cloud_base_url: 'https://models.example.test/v1', semantic_cloud_model: 'pony', semantic_cloud_timeout_ms: 8000, semantic_cloud_api_key_masked: 'sk-1********abcd', semantic_cloud_has_key: true, semantic_cloud_key_readable: true });
  const config = await f.api.readSemanticConfig('fixture-token');
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`).sort(), ['GET /admin/semantic-cloud', 'GET /admin/semantic-search']);
  assert.deepEqual(plain(config.mode), { semantic_search_mode: 'qwen' });
  assert.deepEqual(plain(config.cloud), { semantic_cloud_enabled: true, semantic_cloud_base_url: 'https://models.example.test/v1', semantic_cloud_model: 'pony', semantic_cloud_timeout_ms: '8000', semantic_cloud_api_key: '', semantic_cloud_clear_key: false });
  assert.equal(config.hasKey, true); assert.equal(config.masked, 'sk-1********abcd'); assert.equal(config.keyReadable, true);
});
test('访问统计 joins registrations and visitors by day and keeps the 30-minute online counts', async () => {
  const f = fixture((call) => call.path === '/admin/metrics/registrations'
    ? { stats: [{ date: '2026-10-18', new_users: 4 }, { date: '2026-10-17', new_users: 0 }] }
    : { timezone: 'Asia/Shanghai', source: 'site_visits', today_visitors: 42, online_visitors_30m: 5, today_new_users: 4, online_users_30m: 3, days: [{ date: '2026-10-18', visitors: 42, hits: 90 }] });
  const stats = await f.api.readStatistics('fixture-token');
  for (const call of f.calls) assert.deepEqual(plain(call.options.query), { days: 30 });
  assert.deepEqual(f.calls.map((c) => c.path).sort(), ['/admin/metrics/registrations', '/admin/metrics/visitors']);
  assert.deepEqual(plain(stats), { todayNewUsers: 4, onlineUsers: 3, todayVisitors: 42, onlineVisitors: 5, days: [{ date: '2026-10-18', newUsers: 4, visitors: 42, hits: 90 }, { date: '2026-10-17', newUsers: 0, visitors: null, hits: null }] });
});
test('API 加速 reads the whole ban list by cursor, and one account from its own record', async () => {
  const f = fixture((call) => call.options.query.after === undefined ? { users: [{ id: 2 }, { id: 5 }], total: 3, next_cursor: 5 } : { users: [{ id: 9 }], total: 3, next_cursor: null });
  const banned = await f.api.readAccelerationBans('fixture-token');
  assert.deepEqual([...banned], [2, 5, 9]);
  assert.deepEqual(f.calls.map((c) => plain(c.options.query)), [{ limit: 200 }, { after: 5, limit: 200 }]);
  const one = fixture(() => ({ user: { id: 9, api_accel_banned: true } }));
  assert.equal(await one.api.readAccelerationBan('fixture-token', 9), true);
  assert.equal(one.calls[0].path, '/admin/users/9');
});
test('typed reads map the handler DTOs without fallbacks', async () => {
  const quota = await fixture(() => ({ enabled: true, daily_points: 0, points_per_coin: 7, revision: 2 })).api.readAiQuota('fixture-token');
  assert.deepEqual(plain(quota), { values: { enabled: true, daily_points: '0', points_per_coin: '7' }, revision: 2 });
  const relay = await fixture(() => ({ concurrency: 50, switchback_enabled: true, switchback_attempts: 3, whitelisted_ips: ['::1'], allowed_origins: [] })).api.readRelayConfig('fixture-token');
  assert.deepEqual(plain(relay), { values: { concurrency: '50', switchback_enabled: true, whitelisted_ips: '::1', allowed_origins: '' }, attempts: 3 });
  const text = await fixture(() => ({ enabled: false, endpoint: 'https://api.cognitive.microsofttranslator.com', region: '', target_language: 'zh-Hans', timeout_ms: 5000, has_key: true, api_key_masked: 'abcd********wxyz' })).api.readTextTranslation('fixture-token');
  assert.equal(text.hasKey, true); assert.equal(text.values.api_key, ''); assert.equal(text.values.timeout_ms, '5000');
  const rates = await fixture(() => ({ rules: { search: { label: '', max: 3, window: 60, key_type: 'ip' } }, temporary_locks: [{ id: 4, username: 'u', attempts: 5, locked_until: null }], server_time: 1 })).api.readRateLimits('fixture-token');
  assert.deepEqual(plain(rates.rules), [{ action: 'search', label: 'search', max: '3', window: '60', key_type: 'ip' }]);
  assert.deepEqual(plain(rates.locks), [{ id: 4, username: 'u', attempts: 5, until: null }]);
});
test('model benchmarks accept fractional milliseconds and a failure carries its static code', async () => {
  const f = fixture(() => ({ revision: 3, models: ['a', 'b'], benchmarks: { a: { ok: true, latency_ms: 10.25 }, b: { ok: false, failure: { code: 'MODEL_TIMEOUT', upstream_status: null } }, c: { ok: true } }, selected_model: 'a', catalog_checked_at: null }));
  const result = await f.api.readProviderModels('fixture-token', 'p1');
  assert.equal(f.calls[0].path, '/admin/assistant/providers/p1/models');
  assert.equal(result.benchmarks.a.latency, 10.25);
  assert.equal(result.benchmarks.b.ok, false); assert.equal(result.benchmarks.b.failure, '请求超时');
  /* G2-003: a working model that did not report its duration is still a working model. */
  assert.equal(result.benchmarks.c.ok, true); assert.equal(result.benchmarks.c.latency, null);
  assert.equal(f.api.probeFailure({ code: 'MODEL_RATE_LIMIT', upstream_status: 429 }), '模型服务限流（HTTP 429）');
  assert.equal(f.api.probeFailure({ code: 'SOMETHING_NEW' }), '检查失败（SOMETHING_NEW）');
});
test('a probe re-sends the same body while the backend says running, and ends on a refusal', async () => {
  let n = 0;
  const f = fixture(() => (++n === 1 ? { state: 'running', retry_after_seconds: 0 } : { state: 'done', ok: true, revision: 8, result: { models: ['pony'], latency_ms: 12 } }));
  const result = await f.api.probeProvider('fixture-token', 'p1', 7, 'discover');
  assert.deepEqual(plain(result), { ok: true, revision: 8, result: { models: ['pony'], latency_ms: 12 } });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].path, '/admin/assistant/providers/p1/model-discoveries');
  assert.deepEqual(f.calls[0].options.json, f.calls[1].options.json, 'the poll repeats the same request_id');
  const refused = fixture(() => { throw refusal(refused, 409, '配置已变化'); });
  await assert.rejects(refused.api.probeProvider('fixture-token', 'p1', 7, 'benchmark', 'pony'), /配置已变化/);
  assert.equal(refused.calls.length, 1);
  assert.equal(refused.calls[0].options.json.model, 'pony');
});
test('manual accelerator checks judge an image line by a decode and an API line by its status', async () => {
  /* The three image lines are proxies: an opaque `fetch` resolves on a 500 as readily as on a 200,
     so only a decoded bitmap answers "does this line work" (AGENTS, "Request lines"). They must make
     no `fetch` at all; the four API/site lines still report their HTTP status. */
  const f = fixture(undefined, { fetchStatus: 503 }), reports = [];
  await f.api.checkServiceLines('fixture-token', new AbortController().signal, (row) => reports.push(row));
  assert.equal(reports.length, 7);
  assert.equal(f.images.length, 3, 'three image lines are decoded, not fetched');
  assert.ok(f.images.every((url) => /[?&]_t=\d+/.test(url)), 'an image probe must not be answered from cache');
  assert.equal(f.fetches.length, 4);
  assert.deepEqual(reports.filter((r) => r.status === 'decoded').map((r) => r.name), ['图片加速服务器', '图片 CDN', '图片直连']);
  assert.ok(reports.filter((r) => r.status !== 'decoded').every((r) => r.status === 503 && !r.error));
  assert.ok(f.fetches.every((r) => r.options.credentials === 'omit' && r.options.signal));
  assert.equal(f.calls.length, 0, 'the probes never reach the backend');

  const failing = fixture(undefined, { imageOk: false }), failed = [];
  await failing.api.checkServiceLines('fixture-token', new AbortController().signal, (row) => failed.push(row));
  const image = failed.find((r) => r.name === '图片 CDN');
  assert.equal(image.status, null); assert.equal(image.error, '无法加载图片');

  const stopped = fixture(), controller = new AbortController();
  await assert.rejects(stopped.api.checkServiceLines('fixture-token', controller.signal, () => controller.abort()), (e) => e.name === 'AbortError');
  assert.equal(stopped.images.length, 1, 'cancellation is observed between probes');
  assert.equal(stopped.fetches.length, 0);
});
test('site-stat collection completes all totals and abandons stale account before any subsequent request', async () => {
  const f = fixture(undefined, { fetchPayload: () => ({ total: 42 }) });
  assert.deepEqual(plain(await f.api.collectSiteStats('fixture-token', () => true)), { images: 42, tags: 42, comments: 42 });
  assert.equal(f.fetches.length, 3);
  assert.equal(new URL(f.fetches[0].url).searchParams.get('filter_id'), '56027');
  const stale = fixture(undefined, { fetchPayload: () => { stale.setToken('other-account'); return { total: 42 }; } });
  assert.equal(await stale.api.collectSiteStats('fixture-token', () => true), null);
  assert.equal(stale.fetches.length, 1);
  const failed = fixture(undefined, { fetchPayload: { total: 'bad' } });
  await assert.rejects(failed.api.collectSiteStats('fixture-token', () => true));
  assert.equal(failed.fetches.length, 1);
});

/* ---- F7 FX3 (admin2): timestamp units, optional fields, outcome-unknown writes, derived views ---- */
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
    const f = fixture(() => ({ stats: [{ ip: '1.2.3.4', username: '', total: 1, search: 0, normal: 1, last_seen }], pagination: { total: 1, page: 1 }, available: true }));
    const page = await f.api.readRelayStats('fixture-token', { range: '1', date: '', page: 1, sort: 'total', order: 'desc' });
    assert.equal(page.rows[0].last_seen, instant);
    assert.deepEqual(plain(f.calls[0].options.query), { page: 1, per_page: 20, range: '1', sort: 'total', order: 'desc' });
  }
});
test('NEW-3: a relay error log answers its own availability; a missing upstream status is unknown, never 0', async () => {
  const empty = await fixture(() => ({ logs: [], total: 0, page: 1, dates: [], available: false })).api.readRelayErrors('fixture-token', { page: 1, date: '' });
  assert.equal(empty.available, false); assert.deepEqual(plain(empty.dates), []); assert.equal(empty.rows.length, 0);
  const live = await fixture(() => ({ logs: [{ time_beijing: '2026-10-01 08:00:00', reason: 'dns', method: 'GET', phase: 'connect', target_host: 'derpi', target_path: '/x' }], total: 1, page: 1, available: true, dates: ['2026-10-01'] })).api.readRelayErrors('fixture-token', { page: 1, date: '2026-10-01' });
  assert.equal(live.available, true); assert.deepEqual(plain(live.dates), ['2026-10-01']);
  assert.equal(live.rows[0].status, null); assert.equal(live.rows[0].relay, null); assert.equal(live.rows[0].duration, null);
  assert.equal(live.rows[0].target, 'derpi/x');
  /* A wrong type in the relay's own rows is still a broken response. */
  await assert.rejects(fixture(() => ({ logs: [], total: 'bad', page: 1, available: true, dates: [] })).api.readRelayErrors('fixture-token', { page: 1, date: '' }));
  const invalid = fixture();
  await assert.rejects(invalid.api.readRelayErrors('fixture-token', { page: 1, date: '2026-02-30' }));
  assert.equal(invalid.calls.length, 0, 'an impossible date is refused before any request');
});
test('G2-009: a write nobody heard the answer to is outcome-unknown, held without a retry; a refusal stays a refusal', async () => {
  const unknown = (error) => { assert.equal(error.name, 'ApiError'); assert.match(error.message, /未能确认操作结果/); assert.equal(error.retryable, false); return true; };
  /* No answer at all, our own deadline, a 5xx other than 501. */
  for (const failure of [(f) => new TypeError('socket hang up'), (f) => new f.errors.ApiError('network'), (f) => new f.errors.ApiError('timeout'), (f) => refusal(f, 502, '上游错误')]) {
    const f = fixture(() => { throw failure(f); });
    await assert.rejects(f.api.saveImageRoute('fixture-token', { policy: 'cdn' }), unknown);
    assert.equal(f.calls.length, 1, 'never retried');
  }
  /* Answers: a refusal and a refusal by status. Neither is unknown. */
  const refused = fixture(() => { throw refusal(refused, 403, '权限不足'); });
  await assert.rejects(refused.api.toggleAccelerationBan('fixture-token', 9, true), (error) => { assert.doesNotMatch(error.message, /未能确认/); assert.equal(error.message, '权限不足'); return true; });
  /* The class is the catalogue's own, so `useCatalogMutation` holds it: one rule, not two. */
  const f = fixture(() => { throw new TypeError('offline'); });
  const error = await f.api.saveSemanticMode('fixture-token', { semantic_search_mode: 'off' }).catch((e) => e);
  assert.equal(error.constructor.name, 'CatalogOutcomeUnknown');
});
test('G2-019: a view keeps its identity per answer, and a failure is remembered too', () => {
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
