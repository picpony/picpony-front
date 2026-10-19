/** API request contracts, exercised against isolated responses without a live backend. */
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testApiTransport');

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { __picponyRoutePolicy: { api: 'direct', image: 'direct' } };
globalThis.fetch = async () => { throw new Error('Unexpected request during API initialization'); };

const { apiRequest, readApi } = await import('../lib/api/http.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const picpony = await import('../lib/api/picpony.ts');
const favorites = await import('../lib/api/favorites.ts');
const forum = await import('../lib/api/forum.ts');
const messaging = await import('../lib/api/messages.ts');
const admin = await import('../lib/api/admin.ts');
const derpi = await import('../lib/api/derpi.ts');
const { claimBadge } = await import('../lib/api/badges.ts');
const historyApi = await import('../lib/api/history.ts');
const blockGroupApi = await import('../lib/api/blockGroups.ts');
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
  const response = Response.json({ tags: [] });
  respond = () => response;
  const controller = new AbortController();
  const headers = new Headers({ 'X-Request-Test': 'preserved', Authorization: 'old value' });
  const keyword = '小马 &action=delete_user#fragment + / ?';
  assert.equal(await apiRequest('GET', '/dictionary/tags', {
    token: 'current-session',
    query: { keyword, page: 0, enabled: false, empty: '', missing: undefined },
    cache: 'no-store', credentials: 'include', headers, signal: controller.signal,
  }), response, 'raw Response remains available to callers');
  const { url, init } = calls[0];
  assert.equal(url.origin, 'https://app.invalid');
  assert.equal(url.pathname, '/api/v1/dictionary/tags');
  assert.equal(url.searchParams.has('action'), false, 'the backend refuses `?action=` with 400');
  assert.equal(url.searchParams.get('keyword'), keyword);
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('page'), '0');
  assert.equal(url.searchParams.get('enabled'), 'false');
  assert.equal(url.searchParams.get('empty'), '');
  assert.equal(url.searchParams.has('missing'), false);
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined, 'a GET never carries a body');
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer current-session');
  assert.equal(new Headers(init.headers).get('X-CSRF-Token'), null, 'a read carries no CSRF token');
  assert.equal(new Headers(init.headers).get('X-Request-Test'), 'preserved');
  assert.equal(headers.get('Authorization'), 'old value', 'caller headers are never mutated');
  /* A read carries its own deadline, so the request's signal is a derived one that follows
     the caller's. */
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
  controller.abort();
  assert.equal(init.signal.aborted, true, "the caller's abort reaches the request");
  assert.equal(init.cache, 'no-store');
  /* The same-origin proxy carries the `auth_bind` cookie: credentials stay same-origin. */
  assert.equal(init.credentials, 'same-origin');
  assert.equal('token' in init, false);
  assert.equal('query' in init, false);
  assert.equal('json' in init, false);
});

test('JSON mutations preserve payloads and explicit authentication', async () => {
  respond = () => Response.json({ already_applied: false });
  await admin.adminToggleMaintenance('session', { maintenance_mode: false, maintenance_message: '' });
  await admin.adminToggleTranslate('session', { translate_enabled: true });
  const contracts = [
    ['PUT', '/api/v1/admin/maintenance', { maintenance_mode: false, maintenance_message: '' }, 'Bearer session'],
    ['PUT', '/api/v1/admin/translation', { translate_enabled: true }, 'Bearer session'],
  ];
  assert.equal(calls.length, contracts.length);
  for (const [index, [method, path, body, authorization]] of contracts.entries()) {
    const { url, init } = calls[index];
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.has('action'), false);
    assert.equal(init.method, method);
    assert.deepEqual(JSON.parse(init.body), body);
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    assert.equal(new Headers(init.headers).get('Authorization'), authorization);
    assert.ok(new Headers(init.headers).get('Idempotency-Key'), 'an admin write carries its retry key');
  }
});

test('account writes are /api/v1 resources: path ids, native bodies, the bearer only when signed in', async () => {
  respond = () => Response.json({});
  await picpony.register({ username: '小马', email: 'p@example.test', password: 'test-only1', captchaProof: 'proof' });
  await picpony.changeUsername('session', 'pony & friends', 3);
  await picpony.resendRegistrationCode('v/1', 'proof');
  await picpony.confirmRegistration('v1', '123456');
  await picpony.resetPasswordRequest(' p@example.test ', 'proof');
  await picpony.resetPassword('r1', { code: '123456', new_password: 'next-pass1' });
  await claimBadge('session', 'claim-token&value');
  const contracts = [
    ['POST', '/api/v1/auth/registrations', { username: '小马', email: 'p@example.test', password: 'test-only1', captcha_proof: 'proof' }, null],
    ['PUT', '/api/v1/me/username', { username: 'pony & friends', expected_revision: 3 }, 'Bearer session'],
    ['POST', '/api/v1/auth/email-verifications/v%2F1/resends', { captcha_proof: 'proof' }, null],
    ['POST', '/api/v1/auth/email-verifications/v1/confirmation', { code: '123456' }, null],
    ['POST', '/api/v1/auth/password-resets', { email: 'p@example.test', captcha_proof: 'proof' }, null],
    ['PUT', '/api/v1/auth/password-resets/r1', { code: '123456', new_password: 'next-pass1' }, null],
    ['POST', '/api/v1/me/badges/claims/claim-token%26value', undefined, 'Bearer session'],
  ];
  assert.equal(calls.length, contracts.length);
  for (const [index, [method, path, body, authorization]] of contracts.entries()) {
    const { url, init } = calls[index];
    assert.equal(init.method, method);
    assert.equal(url.pathname + url.search === path || url.href.endsWith(path), true, `${path} ← ${url.href}`);
    assert.equal(url.searchParams.has('action'), false);
    assert.deepEqual(init.body === undefined ? undefined : JSON.parse(init.body), body);
    assert.equal(new Headers(init.headers).get('Authorization'), authorization);
  }
});

test('file uploads retain their field names and let the browser set multipart boundaries', async () => {
  const file = new File(['image bytes'], 'pony.png', { type: 'image/png' });
  const uploads = [
    [picpony.uploadAvatar, '/api/v1/me/avatar', 'avatar'],
    [picpony.uploadBanner, '/api/v1/me/banner', 'banner'],
    [admin.adminUploadMascotImage, '/api/v1/admin/mascots/images', 'image'],
  ];
  for (const [upload, action, field] of uploads) {
    respond = () => Response.json({ success: true, asset: 'a', url: '/api/v1/media/a' });
    await upload('session', file);
    const { url, init } = calls.at(-1);
    if (action.startsWith('/')) assert.equal(url.pathname, action);
    else assert.equal(url.searchParams.get('action'), action);
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);
    assert.deepEqual([...init.body.keys()], [field]);
    assert.equal(await init.body.get(field).text(), 'image bytes');
    assert.equal(new Headers(init.headers).get('Content-Type'), null);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer session');
  }
});

test('bodyless mutations and captcha requests retain their distinct wire contracts', async () => {
  await favorites.lockPrivacySpace('session');
  await admin.adminRefreshDeveloperPassword('session', 4);
  respond = ({ url }) => Response.json(url.pathname.endsWith('/verification')
    ? { proof: 'p', expires_in: 120 }
    : { challenge: { id: 'c1', kind: 'slider', background: 'data:', piece: 'data:', y: 20, width: 310, height: 155, piece_width: 50, piece_height: 50, expires_in: 300 } });
  assert.equal((await picpony.captchaGet()).id, 'c1');
  const trace = [{ x: 0, y: 0, t: 0 }, { x: 60, y: 1, t: 200 }, { x: 120, y: 0, t: 400 }];
  assert.deepEqual(await picpony.captchaVerify('c1', 120, trace), { proof: 'p', expires_in: 120 });
  /* `lock_privacy_space` is `DELETE /me/privacy-space/unlock` (`privacy::relock`): no body. */
  assert.deepEqual([calls[0].init.method, calls[0].url.pathname], ['DELETE', '/api/v1/me/privacy-space/unlock']);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(new Headers(calls[0].init.headers).get('Content-Type'), null);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer session');
  /* The rotation names the generation shown and a backend retry key (`request_id`, a UUID). */
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].url.pathname, '/api/v1/admin/developer-access/password/rotations');
  const rotation = JSON.parse(calls[1].init.body);
  assert.equal(rotation.expected_generation, 4);
  assert.match(rotation.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Headers(calls[1].init.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(calls.slice(2).map(({ url, init }) => [init.method, url.pathname]), [
    ['POST', '/api/v1/auth/challenges'],
    ['POST', '/api/v1/auth/challenges/c1/verification'],
  ], 'captcha cookies must go through the same-origin proxy');
  for (const { init } of calls.slice(2)) {
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('Authorization'), null);
  }
  assert.deepEqual(JSON.parse(calls[2].init.body), {});
  assert.deepEqual(JSON.parse(calls[3].init.body), { x: 120, trace });
});

test('dictionary and audit filters retain optional fields, timestamps and encoded values', async () => {
  respond = ({ url }) => Response.json(url.pathname === '/api/v1/dictionary/tags'
    ? { tags: [], total_matches: 0, stats: null, dictionary_revision: 1 }
    : { success: true, feedbacks: [] });
  const keyword = 'name + other&action=unexpected';
  await picpony.getDictionary('session', {
    page: 0, limit: 0, keyword, category: '', untranslated: 1, wiki_overlap: 0,
  });
  assert.equal(calls[0].url.pathname, '/api/v1/dictionary/tags');
  const dictionary = calls[0].url.searchParams;
  assert.equal(dictionary.get('keyword'), keyword);
  for (const name of ['page', 'limit', 'category', 'wiki_overlap', '_t']) assert.equal(dictionary.has(name), false, name);
  assert.equal(dictionary.get('untranslated'), 'true', 'the backend reads a boolean');

  respond = ({ url }) => Response.json(url.pathname === '/api/v1/admin/messages' ? { messages: [], next_cursor: null } : { feedback: [], next_cursor: null });
  await admin.getTagFeedback('session', { status: '', keyword });
  assert.equal(calls[1].url.pathname, '/api/v1/editor/dictionary/feedback');
  const feedback = calls[1].url.searchParams;
  assert.equal(feedback.has('action'), false);
  assert.equal(feedback.has('status'), false);
  assert.equal(feedback.get('keyword'), keyword);
  assert.equal(feedback.has('page'), false, 'a cursor list, not pages');
  assert.equal(feedback.get('limit'), '40');

  await admin.adminGetAllMessages('session', {});
  await admin.adminGetAllMessages('session', { userId: 12, before: 30 });
  assert.equal(calls[2].url.pathname, '/api/v1/admin/messages');
  assert.equal(calls[2].url.searchParams.has('user_id'), false);
  assert.equal(calls[3].url.searchParams.get('user_id'), '12');
  assert.equal(calls[3].url.searchParams.get('before'), '30');
  assert.equal(calls[3].url.searchParams.get('limit'), '50');
});

test('strict reads throw typed failures and normalise list fields at the boundary', async () => {
  respond = () => Response.json({ error: { code: 'USER_NOT_FOUND', message: '用户不存在' } }, { status: 404 });
  await assert.rejects(picpony.getUserProfile('999999'), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 404 && error.notFound && !error.retryable
      && !/HTTP|JSON/.test(error.message));

  respond = () => Response.json({ error: { code: 'BAD_REQUEST', message: '无效的帖子ID' } }, { status: 400 });
  await assert.rejects(forum.getForumPostDetail('abc'), (error) =>
    error instanceof ApiError && error.notFound && error.status === 400);

  respond = () => Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库暂时不可用' } }, { status: 503 });
  await assert.rejects(blockGroupApi.getBlockGroups('session'), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 503 && error.retryable,
    'a failed read is not an empty list');

  respond = () => Response.json({ error: { code: 'FOLDER_NOT_FOUND', message: '收藏夹未公开或不存在' } }, { status: 404 });
  await assert.rejects(favorites.getSharedFaves(12, 3), (error) =>
    error instanceof ApiError && error.code === 'FOLDER_NOT_FOUND' && error.notFound && !error.retryable);

  respond = () => Response.json({ posts: [], total: 0, total_pages: 0 });
  assert.deepEqual(await picpony.getUserPosts('1'), { posts: [], total_pages: 1 }, 'no `success` field: a 2xx is the answer');
  respond = () => Response.json({ error: { code: 'PROFILE_PRIVATE', message: '用户未公开此类活动' } }, { status: 403 });
  await assert.rejects(picpony.getUserPosts('1'), (error) =>
    error instanceof ApiError && error.code === 'PROFILE_PRIVATE' && !error.retryable, 'the owner’s choice, not a fault');

  respond = () => Response.json({ contacts: [{
    id: 9, user_id: 2, username: 'b', avatar: null, experience: 0, last_message_at: 't', unread_count: 1,
    last_message: { id: 9, sender_id: 2, preview: 'hi &amp; bye', truncated: false, created_at: 't' },
  }], next_cursor: null });
  assert.deepEqual(await messaging.readRecentContacts('session'),
    [{ id: 2, username: 'b', avatar: null, last_msg_time: 't', unread_count: 1, last_message: 'hi &amp; bye', last_message_truncated: false }],
    'a contact is the other person, by user id, with the start of the newest message');
  respond = () => Response.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, { status: 401 });
  await assert.rejects(messaging.readRecentContacts('session'), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 401);

  respond = () => Response.json({ messages: 1, notifications: 2, interactions: 0, forum: 9 });
  const counts = await picpony.getUnreadCounts('session');
  assert.equal(calls.at(-1).url.pathname, '/api/v1/me/unread-counts');
  assert.deepEqual(counts, { messages: 1, notifications: 2, interactions: 0, forum: 9 }, '`notices::unread` as it answers');
  assert.equal(counts.messages, 1);
  assert.equal(counts.forum, 9, 'the forum count is its own, never part of the inbox badge');

  /* A failure with no body is a typed HTTP failure, never a fabricated `{success:false}` envelope. */
  await assert.rejects(readApi(new Response('', { status: 503 })), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 503 && error.retryable
      && error.message === '服务暂时不可用，请稍后再试');
});

test('announcement HTML is sanitised inside the adapter for every consumer', async () => {
  const content = '正文<img src="x" onerror="window.__xss=1"><a href="javascript:window.__js=1">链接</a><b>保留</b>';
  respond = () => Response.json({ announcements: [{ id: 1, version: 'V1', title: '标题', content, created_at: '2026-09-18T00:00:00Z' }], next_cursor: 1 });
  const history = await messaging.readAnnouncementHistory(1);
  assert.equal(history.totalPages, 2, 'a next cursor is one more page known to exist');
  assert.equal(history.announcements.length, 1);
  const safe = history.announcements[0].content;
  assert.doesNotMatch(safe, /onerror|javascript:/i);
  assert.match(safe, /<b>保留<\/b>/);
  respond = () => Response.json({ announcement: { id: 2, version: 'V2', title: '标题', content, created_at: '2026-09-18T00:00:00Z' } });
  const latest = await picpony.getAnnouncement();
  assert.doesNotMatch(latest.announcement.content, /onerror|javascript:/i);
  assert.equal(latest.announcement.date, '2026-09-18T00:00:00Z');
  respond = () => Response.json({ announcement: null });
  assert.equal((await picpony.getAnnouncement()).announcement, undefined, 'nothing published is no announcement');
  respond = () => Response.json({ error: { code: 'UNAVAILABLE', message: '服务暂时不可用' } }, { status: 503 });
  await assert.rejects(messaging.readAnnouncementHistory(1), (error) => error instanceof ApiError && error.status === 503,
    'a failure is a failure, never 暂无公告');
});

test('resource-backed adapters pass cancellation through without returning an empty success', { timeout: 5000 }, async () => {
  const reads = [
    (signal) => admin.adminGetAllMessages('session', { userId: 12 }, signal),
    (signal) => picpony.getDictionary('session', { keyword: 'pony' }, signal),
    (signal) => picpony.getDeveloperStatus('session', signal),
    (signal) => picpony.getUserPosts('12', 1, signal),
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
      assert.ok(init.signal instanceof AbortSignal);
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
    /* The favourites adapters decode their answer and throw: an HTTP failure is read back as its
       status, the shape every other mutation in this list answers with. */
    () => favorites.setFaved('session', 12, true).then(
      () => ({ status: 200 }),
      (error) => { if (error instanceof ApiError && error.kind === 'http') return { status: error.status }; throw error; },
    ),
    /* One profile write (`PATCH /admin/users/12`), named by the account revision read. */
    () => admin.adminUpdateUser('session', { id: 12, account_revision: 3, upstream_credential: { revision: 0 } }, { bio: '新简介' }).then(
      () => ({ status: 200 }),
      (error) => { if (error instanceof ApiError && error.kind === 'http') return { status: error.status }; throw error; },
    ),
    () => picpony.postComment('session', 12, 'one comment', null, 'key-1').then(
      () => ({ status: 200 }),
      (error) => { if (error instanceof ApiError && error.kind === 'http') return { status: error.status }; throw error; },
    ),
  ];
  for (const mutate of mutations) {
    let count = calls.length;
    respond = () => Response.json({ success: false }, { status: 503 });
    assert.equal((await mutate()).status, 503);
    assert.equal(calls.length, count + 1);
    const failure = new TypeError('network unavailable');
    respond = () => { throw failure; };
    count = calls.length;
    /* A transport failure arrives typed, with the engine's error kept as its cause. */
    await assert.rejects(mutate(), (error) =>
      error instanceof ApiError && error.kind === 'network' && error.cause === failure);
    assert.equal(calls.length, count + 1);
  }
});

test('body-read failures remain rejections rather than fabricated API envelopes', async () => {
  const failure = new DOMException('body cancelled', 'AbortError');
  const response = new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
  await assert.rejects(readApi(response), (error) =>
    error === failure || error instanceof ApiError && (error.cause === failure || error.kind === 'aborted'));
});
