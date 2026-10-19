/**
 * Transport failure contracts for `/api/v1` (`api()` / `apiRequest()`): one typed error carrying
 * the backend's `error.code`, one message table, bounded reads, writes never retried except the
 * one CSRF refresh, a dead session noticed once, and user query text that cannot escape the
 * device filters. No live service.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testApiErrors');

const originalFetch = globalThis.fetch;
const values = new Map();
const events = [];
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent(event) { events.push(event.type); return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};
globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {}, cookie: '' };
globalThis.fetch = async () => { throw new Error('Unexpected request during initialisation'); };

const errors = await import('../lib/api/errors.ts');
const { ApiError, apiErrorMessage, isRetryable, isNotFound, isAborted, statusMessage, toApiError, FAILURE_MESSAGES } = errors;
const http = await import('../lib/api/http.ts');
const { subscribeToasts } = await import('../lib/toast.ts');
const client = await import('../lib/api/client.ts');
const derpi = await import('../lib/api/derpi.ts');
const { balanceUserQuery, buildSearchQueryFrom } = await import('../lib/searchQuery.ts');
const { LS_KEYS } = await import('../lib/constants.ts');
const route = await import('../lib/route.ts');
await route.ensureRoutePolicy();

beforeEach(() => {
  values.clear();
  events.length = 0;
});
after(() => {
  globalThis.fetch = originalFetch;
  mock.timers.reset();
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('ApiError carries one Chinese sentence and decides retry and not-found from what failed', () => {
  const rate = new ApiError('http', { status: 429, serverMessage: 'Too Many Requests' });
  assert.equal(rate.message, '请求过于频繁，请稍后再试', 'a rate limit is described by the service fact');
  assert.equal(rate.retryable, true);
  assert.equal(new ApiError('http', { status: 503 }).message, '服务暂时不可用，请稍后再试');
  const missing = new ApiError('http', { status: 404 });
  assert.equal(missing.notFound, true);
  assert.equal(missing.retryable, false);
  assert.equal(missing.message, '内容不存在或已被删除');
  const refused = new ApiError('http', { status: 403, serverMessage: '该用户未公开收藏夹' });
  assert.equal(refused.message, '该用户未公开收藏夹', "a refusal is best said in the backend's words");
  assert.equal(refused.retryable, false);
  assert.equal(new ApiError('envelope', { serverMessage: '<b>html</b>' }).message, FAILURE_MESSAGES.generic,
    'markup is never shown as a sentence');
  assert.equal(new ApiError('syntax').retryable, false);
  assert.equal(new ApiError('network').message, '网络连接失败，请检查网络后再试');
  assert.equal(new ApiError('timeout').message, '请求超时，请稍后再试');
  assert.equal(new ApiError('http', { status: 400, notFound: true }).notFound, true);
  assert.equal(statusMessage(502), '服务暂时不可用，请稍后再试');
  assert.equal(statusMessage(418), FAILURE_MESSAGES.generic);
});

test('apiErrorMessage keeps Chinese sentences and never shows an engine error', () => {
  assert.equal(apiErrorMessage(new TypeError('Failed to fetch')), FAILURE_MESSAGES.network);
  assert.equal(apiErrorMessage(new Error('收藏夹加载失败')), '收藏夹加载失败');
  assert.equal(apiErrorMessage(new Error('Cannot read properties of null')), FAILURE_MESSAGES.generic);
  assert.equal(apiErrorMessage(new SyntaxError('Unexpected token <'), '帖子加载失败'), '帖子加载失败');
  assert.equal(apiErrorMessage({ status: 429 }), '请求过于频繁，请稍后再试', 'the legacy status shape still reads');
  assert.equal(apiErrorMessage(new DOMException('stop', 'AbortError')), FAILURE_MESSAGES.aborted);
  assert.equal(isAborted(new DOMException('stop', 'AbortError')), true);
  assert.equal(isNotFound({ status: 404 }), true);
  assert.equal(isRetryable(new DOMException('stop', 'AbortError')), false);
  const abort = new DOMException('stop', 'AbortError');
  assert.equal(toApiError(abort), abort, 'a cancellation stays the caller’s own error');
  assert.equal(toApiError(abort, true).kind, 'timeout', 'our own deadline is a timeout');
});

test('a read has a deadline, a write has none, and the caller’s abort is not a failure', async (t) => {
  /* `deadlineSignal` unrefs its timer so a real process can exit; here that timer is the only
     thing pending, and on Node 22 the event loop drained before it fired, cancelling this test
     and every one after it (review P1-F4). A ref'd handle keeps the loop alive for the test. */
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  let seen;
  globalThis.fetch = (_, init) => {
    seen = init;
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  };
  await assert.rejects(http.api('GET', '/me/tasks', { token: 't', timeoutMs: 20 }), (error) =>
    error instanceof ApiError && error.kind === 'timeout');
  const controller = new AbortController();
  const pending = http.apiRequest('GET', '/me/tasks', { token: 't', signal: controller.signal });
  await flush();
  controller.abort(new DOMException('left the page', 'AbortError'));
  await assert.rejects(pending, (error) => error.name === 'AbortError' && !(error instanceof ApiError));
  const write = new AbortController();
  const posting = http.apiRequest('POST', '/me/block-groups', { token: 't', json: { name: 'x' }, signal: write.signal });
  await flush();
  assert.equal(seen.signal, write.signal, 'a write takes exactly the caller’s signal, no deadline');
  write.abort();
  await assert.rejects(posting);
});

test('the request speaks /api/v1: path, query, Bearer, CSRF on writes only, and the error body', async () => {
  values.set(LS_KEYS.userInfo, JSON.stringify({ token: 't', csrfToken: 'csrf-1', username: 'pony' }));
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init, headers: new Headers(init.headers) });
    return init.method === 'GET'
      ? Response.json({ folders: [] })
      : Response.json({ error: { code: 'ALREADY_EXISTS', message: '名称已存在' } }, { status: 409 });
  };
  assert.deepEqual(await http.api('GET', '/me/favorite-folders', { token: 't', query: { page: 2, q: undefined, tag: ['a', 'b'] } }), { folders: [] });
  assert.equal(sent[0].url, '/api/v1/me/favorite-folders?page=2&tag=a&tag=b');
  assert.equal(sent[0].url.includes('action='), false);
  assert.equal(sent[0].headers.get('Authorization'), 'Bearer t');
  assert.equal(sent[0].headers.has('X-CSRF-Token'), false, 'a read carries no CSRF token');
  assert.equal(sent[0].init.body, undefined, 'a GET has no body');
  await assert.rejects(http.api('POST', `/me/favorite-folders`, { token: 't', json: { name: 'x' }, idempotencyKey: 'k1' }), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 409 && error.code === 'ALREADY_EXISTS' && error.message === '名称已存在');
  assert.equal(sent[1].headers.get('X-CSRF-Token'), 'csrf-1');
  assert.equal(sent[1].headers.get('Content-Type'), 'application/json');
  assert.equal(sent[1].headers.get('Idempotency-Key'), 'k1');
  assert.equal(sent[1].init.body, JSON.stringify({ name: 'x' }));
  assert.equal(sent.length, 2, 'a refused write is never sent again');
  assert.equal(http.seg('a/b c'), 'a%2Fb%20c');
});

test('a CSRF_MISMATCH write refreshes the token and is sent once more; nothing else is retried', async () => {
  values.set(LS_KEYS.userInfo, JSON.stringify({ token: 't', csrfToken: 'stale', username: 'pony' }));
  const sent = [];
  let mismatches = 1;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    const headers = new Headers(init?.headers);
    sent.push({ path, method: init?.method ?? 'GET', csrf: headers.get('X-CSRF-Token') });
    if (path === '/api/v1/auth/csrf') return Response.json({ csrf_token: 'fresh' });
    if (mismatches > 0) {
      mismatches -= 1;
      return Response.json({ error: { code: 'CSRF_MISMATCH', message: 'csrf' } }, { status: 403 });
    }
    return new Response(null, { status: 204 });
  };
  assert.equal(await http.api('DELETE', '/me/favorite-folders/3', { token: 't' }), undefined, 'a 204 is undefined');
  assert.deepEqual(sent.map(({ path, method, csrf }) => `${method} ${path} ${csrf}`), [
    'DELETE /api/v1/me/favorite-folders/3 stale',
    'GET /api/v1/auth/csrf null',
    'DELETE /api/v1/me/favorite-folders/3 fresh',
  ]);
  assert.equal(JSON.parse(values.get(LS_KEYS.userInfo)).csrfToken, 'fresh', 'the refreshed token is kept beside the session');

  /* A second mismatch after the refresh is the answer: one resend, never a loop. */
  sent.length = 0;
  mismatches = 2;
  await assert.rejects(http.api('PATCH', '/me/favorite-folders/3', { token: 't', json: { name: 'y' } }), (error) =>
    error instanceof ApiError && error.status === 403 && error.code === 'CSRF_MISMATCH');
  assert.equal(sent.filter(({ path }) => path === '/api/v1/me/favorite-folders/3').length, 2);

  /* Any other 403 is a refusal, not a stale token: no refresh, no resend. */
  sent.length = 0;
  globalThis.fetch = async (url, init) => {
    sent.push({ path: String(url), method: init?.method });
    return Response.json({ error: { code: 'FORBIDDEN', message: '没有权限' } }, { status: 403 });
  };
  await assert.rejects(http.api('POST', '/me/forum/threads', { token: 't', json: {} }), (error) => error.code === 'FORBIDDEN');
  assert.equal(sent.length, 1);
  /* A 5xx or a network failure on a write is never retried either — it may have been acted on. */
  sent.length = 0;
  globalThis.fetch = async (url, init) => { sent.push({ path: String(url), method: init?.method }); return new Response('', { status: 502 }); };
  await assert.rejects(http.api('POST', '/me/forum/threads', { token: 't', json: {} }), (error) => error.status === 502);
  globalThis.fetch = async (url, init) => { sent.push({ path: String(url), method: init?.method }); throw new TypeError('fetch failed'); };
  await assert.rejects(http.api('POST', '/me/forum/threads', { token: 't', json: {} }), (error) => error instanceof ApiError && error.kind === 'network');
  assert.equal(sent.length, 2);
});

test('a 401 on GET /me ends that session once; other resources confirm before signing anyone out', async (t) => {
  const notices = [];
  const stop = subscribeToasts((notice) => notices.push(notice));
  t.after(stop);
  values.set(LS_KEYS.userInfo, JSON.stringify({ token: 'dead', username: 'pony' }));
  const unauthorized = () => Response.json({ error: { code: 'UNAUTHORIZED', message: '未登录' } }, { status: 401 });
  globalThis.fetch = async () => unauthorized();
  await http.apiRequest('GET', '/me', { token: 'dead' });
  await flush();
  assert.equal(values.has(LS_KEYS.userInfo), false);
  assert.deepEqual(events, ['user_info_updated']);
  assert.deepEqual(notices.map(({ message }) => message), ['登录已过期，请重新登录']);
  await http.apiRequest('GET', '/me', { token: 'dead' });
  assert.equal(notices.length, 1, 'concurrent or repeated failures announce one expiry');

  /* A newer login is never signed out by an older request's 401. */
  values.set(LS_KEYS.userInfo, JSON.stringify({ token: 'fresh', username: 'pony' }));
  events.length = 0;
  await http.apiRequest('GET', '/me', { token: 'dead' });
  await flush();
  assert.equal(JSON.parse(values.get(LS_KEYS.userInfo)).token, 'fresh');
  assert.deepEqual(events, []);
  assert.equal(notices.length, 1, 'an old response cannot announce that a newer login expired');

  /* Another resource's 401 is checked against GET /me: a live session survives it. */
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = new URL(String(url), 'https://app.invalid').pathname;
    asked.push(path);
    return path === '/api/v1/me' ? Response.json({ user: { id: 1 } }) : unauthorized();
  };
  await Promise.all([
    http.apiRequest('POST', '/me/password/verify', { token: 'fresh', json: { password: 'x' } }),
    http.apiRequest('GET', '/me/favorites', { token: 'fresh' }),
  ]);
  await flush();
  await flush();
  assert.equal(asked.filter((path) => path === '/api/v1/me').length, 1, 'one confirmation per token in flight');
  assert.equal(asked.filter((path) => path === '/api/v1/me/password/verify').length, 1, 'the 401 write is not resent');
  assert.equal(JSON.parse(values.get(LS_KEYS.userInfo)).token, 'fresh');

  globalThis.fetch = async () => unauthorized();
  await http.apiRequest('GET', '/me/favorites', { token: 'fresh' });
  await flush();
  await flush();
  assert.equal(values.has(LS_KEYS.userInfo), false, 'a confirmed dead session ends');
  assert.equal(notices.length, 2, 'the confirmed expiry has its own report');
});

test('the Derpibooru ladder is bounded and keeps the last status when it runs out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0;
  globalThis.fetch = (_, init) => {
    calls += 1;
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  };
  const started = Date.now();
  let failure;
  const pending = client.proxyFetch('https://trixiebooru.org/api/v1/json/images/1').catch((error) => { failure = error; });
  for (let elapsed = 0; elapsed < 40_000 && !failure; elapsed += 250) {
    t.mock.timers.tick(250);
    await flush();
  }
  await pending;
  assert.ok(failure instanceof ApiError && failure.kind === 'timeout', String(failure));
  assert.ok(Date.now() - started <= client.DERPI_TOTAL_BUDGET_MS, `took ${Date.now() - started}ms`);
  assert.equal(calls, 2, 'two 12s attempts fit the budget; a third is not started');
  t.mock.timers.reset();

  let status = 503;
  calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('', { status }); };
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  failure = undefined;
  const exhausted = client.proxyFetch('https://trixiebooru.org/api/v1/json/images/1').catch((error) => { failure = error; });
  for (let i = 0; i < 20 && !failure; i += 1) {
    t.mock.timers.tick(500);
    await flush();
  }
  await exhausted;
  assert.ok(failure instanceof ApiError && failure.status === 503 && calls === 3, `${failure} after ${calls}`);
  t.mock.timers.reset();

  status = 429;
  calls = 0;
  await assert.rejects(client.proxyFetch('https://trixiebooru.org/api/v1/json/images/1'), (error) =>
    error instanceof ApiError && error.status === 429 && error.message === '请求过于频繁，请稍后再试');
  assert.equal(calls, 1, 'a rate limit is never retried or failed over');
});

test('a search Derpibooru cannot parse is a syntax error without 重试', async () => {
  globalThis.fetch = async () => Response.json({ error: 'Search parsing error' }, { status: 400 });
  await assert.rejects(derpi.getImages('pony (unclosed'), (error) =>
    error instanceof ApiError && error.kind === 'syntax' && !error.retryable);
  await assert.rejects(derpi.getImages(), (error) => error instanceof ApiError && error.kind === 'http',
    'the feed has no user text to blame');
});

test('user query text cannot close the group that scopes the device filters to it', () => {
  assert.equal(balanceUserQuery('fluttershy OR (rarity, safe)'), 'fluttershy OR (rarity, safe)', 'balanced text is unchanged');
  assert.equal(balanceUserQuery('suggestive) OR (suggestive'), 'suggestive\\) OR \\(suggestive');
  assert.equal(balanceUserQuery('twilight)'), 'twilight\\)');
  assert.equal(balanceUserQuery('rarity (eqg'), 'rarity \\(eqg');
  assert.equal(balanceUserQuery('"pony ) OR (x'), '\\"pony \\) OR \\(x', 'an unterminated quote no longer hides parentheses');
  assert.equal(balanceUserQuery('"a (b" OR c'), '"a (b" OR c', 'parentheses inside a closed quote are literal');
  assert.equal(balanceUserQuery('pony\\'), 'pony\\\\', 'a trailing backslash cannot escape the group');
  assert.equal(balanceUserQuery('pony\\)'), 'pony\\)', 'an escaped parenthesis is left alone');
  const settings = { contentFilter: 'safe', banAnthro: false, onlyPony: false, hiddenTags: [] };
  const built = decodeURIComponent(buildSearchQueryFrom(settings, 'suggestive) OR (suggestive'));
  assert.ok(built.startsWith('(suggestive\\) OR \\(suggestive), '), built);
  assert.match(built, /, -suggestive/);
  const blacklisted = decodeURIComponent(buildSearchQueryFrom({ ...settings, contentFilter: 'developer', banDiscomfort: false }, 'pony', undefined, [5, 3]));
  assert.equal(blacklisted, '(pony), -id:3, -id:5', 'the public blacklist applies in every mode');
});
