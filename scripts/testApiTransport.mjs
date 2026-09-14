/** API request contracts, exercised against isolated responses without a live backend. */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testApiTransport');

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { __picponyRoutePolicy: { api: 'direct', image: 'direct' } };
globalThis.fetch = async () => { throw new Error('Unexpected request during API initialization'); };

const { picponyRequest, picponyPostJson, readJson } = await import('../lib/api/http.ts');
const picpony = await import('../lib/api/picpony.ts');
const admin = await import('../lib/api/admin.ts');
const derpi = await import('../lib/api/derpi.ts');
const { claimBadge } = await import('../lib/api/badges.ts');
const { ensureRoutePolicy } = await import('../lib/route.ts');
await ensureRoutePolicy();

let calls;
let respond;
beforeEach(() => {
  calls = [];
  respond = () => Response.json({ success: true });
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: new URL(String(url), 'https://app.invalid'), init };
    calls.push(request);
    return respond(request);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test('query encoding preserves meaningful falsy values and request options', async () => {
  const response = Response.json({ success: true });
  respond = () => response;
  const controller = new AbortController();
  const headers = new Headers({ 'X-Request-Test': 'preserved', Authorization: 'old value' });
  const keyword = '小马 &action=delete_user#fragment + / ?';
  assert.equal(await picponyRequest('get_dictionary', {
    token: 'current-session',
    query: { keyword, page: 0, enabled: false, empty: '', missing: undefined },
    cache: 'no-store', credentials: 'include', headers, signal: controller.signal,
  }), response, 'raw Response remains available to callers');
  const { url, init } = calls[0];
  assert.equal(url.origin, 'https://app.invalid');
  assert.equal(url.pathname, '/api.php');
  assert.deepEqual(url.searchParams.getAll('action'), ['get_dictionary']);
  assert.equal(url.searchParams.get('keyword'), keyword);
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('page'), '0');
  assert.equal(url.searchParams.get('enabled'), 'false');
  assert.equal(url.searchParams.get('empty'), '');
  assert.equal(url.searchParams.has('missing'), false);
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer current-session');
  assert.equal(new Headers(init.headers).get('X-Request-Test'), 'preserved');
  assert.equal(headers.get('Authorization'), 'old value', 'caller headers are never mutated');
  assert.equal(init.signal, controller.signal);
  assert.equal(init.cache, 'no-store');
  assert.equal(init.credentials, 'include');
  assert.equal('token' in init, false);
  assert.equal('query' in init, false);
});

test('JSON mutations preserve payloads and explicit authentication', async () => {
  await picpony.register({ username: '小马', password: 'test-only' });
  await picpony.changeUsername('session', 'pony & friends');
  await picpony.resendVerifyCode('session');
  await admin.adminToggleMaintenance('session', { maintenance_mode: false, maintenance_message: '' });
  await claimBadge('session', 'claim-token&value');
  const contracts = [
    ['register', { username: '小马', password: 'test-only' }, null],
    ['change_username', { new_username: 'pony & friends' }, 'Bearer session'],
    ['resend_verify_code', {}, 'Bearer session'],
    ['admin_toggle_maintenance', { maintenance_mode: false, maintenance_message: '' }, 'Bearer session'],
    ['user_claim_badge', { token: 'claim-token&value' }, 'Bearer session'],
  ];
  assert.equal(calls.length, contracts.length);
  for (const [index, [action, body, authorization]] of contracts.entries()) {
    const { url, init } = calls[index];
    assert.equal(url.searchParams.get('action'), action);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), body);
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    assert.equal(new Headers(init.headers).get('Authorization'), authorization);
  }
});

test('file uploads retain their field names and let the browser set multipart boundaries', async () => {
  const file = new File(['image bytes'], 'pony.png', { type: 'image/png' });
  const uploads = [
    [picpony.uploadAvatar, 'upload_avatar', 'avatar'],
    [picpony.uploadBanner, 'upload_banner', 'banner'],
    [picpony.uploadForumImage, 'upload_forum_image', 'image'],
    [admin.adminUploadMascotImage, 'admin_upload_mascot_image', 'mascot_file'],
  ];
  for (const [upload, action, field] of uploads) {
    await upload('session', file);
    const { url, init } = calls.at(-1);
    assert.equal(url.searchParams.get('action'), action);
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);
    assert.deepEqual([...init.body.keys()], [field]);
    assert.equal(await init.body.get(field).text(), 'image bytes');
    assert.equal(new Headers(init.headers).get('Content-Type'), null);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer session');
  }
});

test('bodyless mutations and captcha requests retain their distinct wire contracts', async () => {
  await picpony.clearBrowsingHistory('session');
  await admin.adminRefreshDeveloperPassword('session');
  await picpony.captchaGet();
  await picpony.captchaVerify(0, '');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(new Headers(calls[0].init.headers).get('Content-Type'), null);
  assert.equal(calls[1].init.body, undefined);
  assert.equal(new Headers(calls[1].init.headers).get('Content-Type'), 'application/json');
  for (const { url, init } of calls.slice(2)) {
    assert.equal(url.pathname, '/api.php', 'captcha cookies must go through the same-origin proxy');
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('Authorization'), null);
  }
  assert.deepEqual(JSON.parse(calls[3].init.body), { x: 0 });
});

test('dictionary and audit filters retain optional fields, timestamps and encoded values', async () => {
  const keyword = 'name + other&action=unexpected';
  await picpony.getDictionary('session', {
    page: 0, limit: 0, keyword, category: '', untranslated: 0, wiki_overlap: 0,
  });
  const dictionary = calls[0].url.searchParams;
  assert.equal(dictionary.get('keyword'), keyword);
  for (const name of ['page', 'limit', 'category']) assert.equal(dictionary.has(name), false);
  for (const name of ['untranslated', 'wiki_overlap']) assert.equal(dictionary.get(name), '0');
  assert.match(dictionary.get('_t'), /^\d+$/);

  await admin.getTagFeedback('session', { status: '', keyword });
  const feedback = calls[1].url.searchParams;
  assert.equal(feedback.get('action'), 'admin_get_tag_feedback');
  assert.equal(feedback.has('status'), false);
  assert.equal(feedback.get('keyword'), keyword);
  assert.equal(feedback.get('page'), '1');
  assert.equal(feedback.get('limit'), '40');

  await admin.adminGetAllMessages('session', 0);
  await admin.adminGetAllMessages('session', 12);
  assert.equal(calls[2].url.searchParams.has('user_id'), false);
  assert.equal(calls[3].url.searchParams.get('user_id'), '12');
});

test('upload reads preserve query authentication, normalize pages and reject failures', async () => {
  const upload = { id: 12, name: 'example' };
  respond = () => Response.json({ success: true, uploads: [upload], total_pages: 0 });
  assert.deepEqual(await picpony.getUserUploads('12&action=other', 2, 24, 'owner&secret'), {
    uploads: [upload], totalPages: 1,
  });
  const { url, init } = calls[0];
  assert.equal(url.searchParams.get('user_id'), '12&action=other');
  assert.deepEqual(url.searchParams.getAll('action'), ['get_user_uploads']);
  assert.equal(url.searchParams.get('token'), 'owner&secret');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(new Headers(init.headers).has('Authorization'), false);

  respond = () => Response.json({ success: true });
  assert.deepEqual(await picpony.getUserUploads('12'), { uploads: [], totalPages: 1 });
  assert.equal(calls.at(-1).url.searchParams.has('token'), false);
  respond = () => Response.json({ success: false, message: 'uploads unavailable' });
  await assert.rejects(picpony.getUserUploads('12'), /uploads unavailable/);
  respond = () => Response.json({ success: true }, { status: 403 });
  await assert.rejects(picpony.getUserUploads('12'), /获取用户上传记录失败/);
});

test('resource-backed adapters pass cancellation through without returning an empty success', { timeout: 5000 }, async () => {
  const reads = [
    (signal) => admin.adminGetAllMessages('session', 12, signal),
    (signal) => picpony.getDictionary('session', { keyword: 'pony' }, signal),
    (signal) => picpony.getDeveloperStatus('session', signal),
    (signal) => picpony.getUserUploads('12', 1, 12, 'session', signal),
    (signal) => derpi.getDerpiProfile('12', signal),
    (signal) => derpi.searchDerpiImages('uploader_id:12', 1, 24, signal),
  ];
  for (const read of reads) {
    const controller = new AbortController();
    const reason = new DOMException('view changed', 'AbortError');
    let requestStarted;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    respond = ({ init }) => new Promise((_, reject) => {
      requestStarted();
      assert.equal(init.signal, controller.signal);
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const count = calls.length;
    const pending = read(controller.signal);
    await started;
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.equal(calls.length, count + 1, 'cancellation must not start a retry');
  }
});

test('HTTP and network mutation failures are never retried implicitly', async () => {
  const mutations = [
    () => picpony.toggleFave('session', 12),
    () => admin.adminUpdateUser('session', { id: 12 }),
    () => picponyPostJson('post_comment', { image_id: 12, body: 'one comment' }, { token: 'session' }),
  ];
  for (const mutate of mutations) {
    let count = calls.length;
    respond = () => Response.json({ success: false }, { status: 503 });
    assert.equal((await mutate()).status, 503);
    assert.equal(calls.length, count + 1);
    const failure = new TypeError('network unavailable');
    respond = () => { throw failure; };
    count = calls.length;
    await assert.rejects(mutate(), (error) => error === failure);
    assert.equal(calls.length, count + 1);
  }
});

test('body-read failures remain rejections rather than fabricated API envelopes', async () => {
  const failure = new DOMException('body cancelled', 'AbortError');
  const response = new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
  await assert.rejects(readJson(response), (error) => error === failure);
});
