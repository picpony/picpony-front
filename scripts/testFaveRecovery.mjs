import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testFaveRecovery');

// Every request is answered here. No test can fall through to an upstream.
const values = new Map();
const events = new EventTarget();
const documentEvents = new EventTarget();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
globalThis.window = {
  addEventListener: (...a) => events.addEventListener(...a), removeEventListener: (...a) => events.removeEventListener(...a),
  dispatchEvent: e => events.dispatchEvent(e), requestAnimationFrame: cb => setTimeout(cb, 0), setTimeout, clearTimeout,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { origin: 'https://fixture.invalid' }, isSecureContext: true,
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.HTMLElement = class {};
globalThis.document = {
  visibilityState: 'visible', hidden: false, cookie: '', activeElement: null,
  addEventListener: (...a) => documentEvents.addEventListener(...a), removeEventListener: (...a) => documentEvents.removeEventListener(...a),
  createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
  body: { appendChild() {} }, execCommand: () => false,
};
let clipboard = [];
let clipboardFails = false;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
  writeText: async value => { if (clipboardFails) throw new Error('denied'); clipboard.push(value); },
} } });
const { opOf, rustError, rustResponse } = await import('./rustRoutes.mjs');
let sent = [];
/* `OK`: the operation's ordinary success, in the Rust backend's shape (`rustOk`). */
const OK = Symbol('ok');
let answer = () => OK;
/** The picture id a `/…/{image_id}[/…]` route names. */
const imageOf = target => Number(/\/(?:favorites|browsing-history)\/(\d+)/.exec(target.pathname)?.[1]);
const space = (over = {}) => ({ owner_id: 1, has_password: true, unlock_seconds: 15, active: false, unlocked: true, expires_at: null, ...over });
const favesOf = (ids, folders = {}) => ({ image_ids: ids, items: ids.map(image_id => ({ image_id, created_at: '2026-01-01T00:00:00Z', folder_ids: folders[image_id] ?? [1] })), total: ids.length, page: 1, per_page: 100 });
const privacyPage = images => ({ owner_id: 1, items: images.map(image => ({ image_id: image.id, image, revision: 0, created_at: '2026-01-01T00:00:00Z' })), total: images.length, page: 1, limit: 100, metadata_source: 'user_snapshot' });
function rustOk(action, body, target) {
  switch (action) {
    case 'toggle_fave': return { image_id: imageOf(target), folder_ids: body.saved ? [body.folder_id ?? 1] : [], favorited: body.saved };
    case 'set_image_fave_folders': return { image_id: imageOf(target), folder_ids: body.folder_ids, favorited: body.folder_ids.length > 0 };
    case 'add_privacy_fave': return { image_id: imageOf(target), added: true, revision: 0 };
    case 'check_has_privacy_password': case 'verify_privacy_password': case 'set_privacy_password':
    case 'change_privacy_password': case 'set_privacy_faves_presence': return space();
    case 'verify_password': return { verified: true };
    case 'batch_add_faves': return { folder_id: body.folder_id ?? 1, requested_count: body.image_ids.length, inserted_count: body.image_ids.length, new_favorite_count: body.image_ids.length };
    case 'get_faves': return favesOf([]);
    case 'get_fave_folders': return { folders: [], privacy_space: { ...space(), visible: true, image_count: 0 } };
    case 'merge_fave_folders': return { target_folder_id: body.target_folder_id };
    case 'get_user': return { user: { id: 1, username: token } };
    default: return null;
  }
}
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url, 'https://fixture.invalid');
  const action = target.pathname.startsWith('/api/v1/') ? opOf(init.method, target.href) : null;
  const body = init.body ? JSON.parse(init.body) : null;
  sent.push({ action, body, target, init });
  const result = await answer(action, body, target, init);
  return rustResponse(result === OK ? rustOk(action, body, target) : result);
};

const { LS_KEYS } = await import('../lib/constants.ts');
const { clearAllResources } = await import('../lib/resource.ts');
const { faveIds, faveFolders, favePictures, tasks } = await import('../lib/resources.ts');
const api = await import('../lib/api/favorites.ts');
const actions = await import('../lib/favoritesActions.ts');
const privacy = await import('../lib/favoritesPrivacy.ts');
const download = await import('../lib/favoritesDownload.ts');
const { copyFolderLink } = await import('../lib/favoritesShare.ts');
const { transferSummary } = await import('../lib/favorites.ts');
const { openFromSequence, activeImageSequence } = await import('../lib/imageSequence.ts');
await (await import('../lib/route.ts')).ensureRoutePolicy();

const token = 'recovery-fixture';
const picture = id => ({ id, tags: ['safe'], width: 80, height: 60, format: 'png',
  view_url: `https://derpicdn.net/${id}/full.png`, representations: { full: `https://derpicdn.net/${id}/full.png` } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const paint = () => new Promise(resolve => setTimeout(resolve, 10));
function setSession(next) {
  if (next) values.set(LS_KEYS.userInfo, JSON.stringify({ token: next, username: next, id: next === token ? 1 : 2 }));
  else values.delete(LS_KEYS.userInfo);
  events.dispatchEvent(new Event('user_info_updated'));
}
function visibility(visible) {
  document.visibilityState = visible ? 'visible' : 'hidden'; document.hidden = !visible;
  documentEvents.dispatchEvent(new Event('visibilitychange'));
}
function privacyAnswers(action) {
  if (action === 'get_privacy_faves') return privacyPage([picture(1), picture(2)]);
  return OK;
}
beforeEach(() => {
  values.clear(); clearAllResources(); setSession(null); setSession(token); visibility(true);
  sent = []; answer = () => OK; clipboard = []; clipboardFails = false;
});
afterEach(() => { setSession(null); clearAllResources(); });

test('presence joins leases, beats every five seconds only while visible, and leaves with keepalive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  answer = privacyAnswers;
  const leave1 = privacy.enterPrivacyScreen(token), leave2 = privacy.enterPrivacyScreen(token);
  await privacy.checkPrivacy(token);
  const beats = () => sent.filter(r => r.action === 'set_privacy_faves_presence');
  assert.deepEqual(beats().map(r => r.body.active), [true]);
  t.mock.timers.tick(5000); await flush();
  leave1(); assert.equal(privacy.privacySnapshot().beating, true);
  visibility(false); await flush();
  assert.deepEqual(beats().map(r => r.body.active), [true, true, false]);
  assert.equal(beats().at(-1).init.keepalive, true);
  t.mock.timers.tick(14000); await flush();
  assert.equal(beats().length, 3);
  visibility(true); await flush();
  assert.equal(privacy.privacySnapshot().status, 'open');
  assert.equal(privacy.privacySnapshot().expiring, false);
  leave2(); await flush();
  assert.equal(beats().at(-1).body.active, false);
});

test('a suspended timer cannot revive an expired space; locking also drops the active private sequence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  answer = privacyAnswers;
  const leave = privacy.enterPrivacyScreen(token); await privacy.checkPrivacy(token);
  openFromSequence({ key: `fave-privacy:${token}`, ids: () => [1, 2], preview: picture });
  visibility(false);
  t.mock.timers.setTime(17000); // Move the clock without delivering the suspended expiry callback.
  visibility(true); await flush();
  assert.equal(privacy.privacySnapshot().status, 'locked');
  assert.equal(privacy.privacySnapshot().images, null);
  assert.equal(activeImageSequence(), null);
  assert.equal(sent.filter(r => r.action === 'lock_privacy_space').length, 1);
  leave();
});

test('pending and failed private-list reads expire too, and late responses cannot repopulate them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const held = deferred();
  answer = a => a === 'get_privacy_faves' ? held.promise : privacyAnswers(a);
  const leave = privacy.enterPrivacyScreen(token), checking = privacy.checkPrivacy(token);
  await flush(); assert.equal(privacy.privacySnapshot().status, 'loading');
  leave(); t.mock.timers.tick(15001); await flush();
  held.resolve(privacyPage([picture(9)])); await checking;
  assert.equal(privacy.privacySnapshot().images, null);
  answer = a => a === 'get_privacy_faves' ? rustError(503, 'DATABASE_UNAVAILABLE', '数据库暂时不可用') : privacyAnswers(a);
  const leave2 = privacy.enterPrivacyScreen(token); await privacy.checkPrivacy(token);
  assert.equal(privacy.privacySnapshot().status, 'list-failed');
  leave2(); t.mock.timers.tick(15001); await flush();
  assert.equal(privacy.privacySnapshot().status, 'locked');
});

test('account replacement drops private data, stops the old lease and ignores its late list', async () => {
  const held = deferred();
  answer = a => a === 'get_privacy_faves' ? held.promise : privacyAnswers(a);
  const oldLeave = privacy.enterPrivacyScreen(token), first = privacy.checkPrivacy(token);
  await flush(); setSession('next-account');
  answer = privacyAnswers;
  const newLeave = privacy.enterPrivacyScreen('next-account'); await privacy.checkPrivacy('next-account');
  oldLeave(); held.resolve(privacyPage([picture(99)])); await first;
  assert.equal(privacy.privacySnapshot().present, 1);
  assert.deepEqual(privacy.privacySnapshot().images.map(i => i.id), [1, 2]);
  assert.equal(privacy.privacySnapshot().token, 'next-account');
  newLeave(); setSession(null); assert.equal(privacy.privacySnapshot().images, null);
});

test('unlock completion after a local lock does not reopen, and passwords never enter storage', async () => {
  const held = deferred(); answer = a => a === 'verify_privacy_password' ? held.promise : privacyAnswers(a);
  const unlocking = privacy.unlockPrivacy(token, 'private123'); await flush(); privacy.lockPrivacy(token);
  held.resolve(space()); await unlocking;
  assert.equal(privacy.privacySnapshot().images, null);
  assert.equal(sent.some(r => r.action === 'get_privacy_faves'), false);
  assert.equal([...values.values()].some(v => v.includes('private123')), false);
});

test('a server relock refusal removes a previously visible list during refresh', async () => {
  answer = privacyAnswers;
  const leave = privacy.enterPrivacyScreen(token); await privacy.checkPrivacy(token);
  assert.equal(privacy.privacySnapshot().images.length, 2);
  answer = a => a === 'get_privacy_faves' ? rustError(403, 'PRIVACY_LOCKED', '隐私空间未解锁或解锁已过期，请重新输入密码') : OK;
  await privacy.reloadPrivacy(token);
  assert.equal(privacy.privacySnapshot().status, 'locked'); assert.equal(privacy.privacySnapshot().images, null);
  leave();
});

test('session changes between account-password verification and reset prevent the destructive second request', async () => {
  const held = deferred(); answer = a => a === 'verify_password' ? held.promise : OK;
  const reset = privacy.resetPrivacy(token, 'account123'); await flush(); setSession('next-account');
  held.resolve({ verified: true }); await assert.rejects(reset, { name: 'AbortError' });
  assert.equal(sent.some(r => r.action === 'reset_privacy_space'), false);
});

test('privacy moves distinguish failed adds from failed removals and preserve both copies after a partial failure', async () => {
  faveIds.seed({ token }, { ids: [1, 2, 3], dates: {}, folders: { 1: [1], 2: [1], 3: [1] } }, Date.now());
  answer = (a, b, target) => {
    if (a === 'check_has_privacy_password') return space({ unlocked: false });
    if (a === 'add_privacy_fave' && imageOf(target) === 2) return rustError(409, 'PRIVACY_FAVORITES_LIMIT', '隐私收藏数量已达10000张');
    if (a === 'toggle_fave' && imageOf(target) === 3) return rustError(503, 'DATABASE_UNAVAILABLE', '数据库暂时不可用');
    return OK;
  };
  const result = await actions.moveToPrivacy(token, [picture(1), picture(2), picture(3)]);
  assert.deepEqual(result.added, [1, 3]); assert.deepEqual(result.succeeded, [1]);
  assert.deepEqual(result.failed.map(f => f.id), [2, 3]);
  assert.match(result.failed[1].error.message, /已存入隐私空间，原收藏未能移除/);
  assert.deepEqual(sent.filter(r => r.action === 'toggle_fave').map(r => [imageOf(r.target), r.body]), [[1, { saved: false }], [3, { saved: false }]]);
  assert.deepEqual(faveIds.peek({ token }).data.ids, [2, 3]);
});

test('cancel during a two-step privacy move finishes the accepted picture and sends nothing for the next', async () => {
  const controller = new AbortController();
  answer = a => { if (a === 'get_faves') return favesOf([1, 2]);
    if (a === 'add_privacy_fave') controller.abort(); return OK; };
  const result = await actions.moveToPrivacy(token, [picture(1), picture(2)], { signal: controller.signal });
  assert.deepEqual(result.succeeded, [1]);
  assert.deepEqual(sent.filter(r => r.init.method && r.init.method !== 'GET').map(r => r.action), ['add_privacy_fave', 'toggle_fave']);
});

test('partial folder removal preserves failures and memberships in the other folders', async () => {
  const index = { ids: [1, 2], dates: {}, folders: { 1: [1, 2], 2: [1] } };
  faveFolders.seed({ token }, { folders: [{ id: 1, isMain: true }, { id: 2 }], privacy: null }, Date.now());
  faveIds.seed({ token, folderId: 1 }, index, Date.now());
  answer = (a, b, target) => a === 'get_faves' ? favesOf(index.ids, index.folders)
    : imageOf(target) === 2 ? rustError(404, 'FOLDER_NOT_FOUND', '收藏夹不存在或不属于此账号') : { folder_ids: [2] };
  const result = await actions.removeFromFolder(token, [1, 2], 1);
  await paint();
  assert.deepEqual(result.succeeded, [1]); assert.deepEqual(result.failed.map(r => r.id), [2]);
  assert.deepEqual(faveIds.peek({ token, folderId: 1 }).data.ids, [2]);
  assert.deepEqual(faveIds.peek({ token }).data.folders[1], [2]);
});

test('two removals before one paint compose correctly in every cached folder, even on a cold global index', async () => {
  const index = { ids: [1, 2, 3], dates: {}, folders: { 1: [1, 2], 2: [1, 2], 3: [1] } };
  faveFolders.seed({ token }, { folders: [{ id: 1, isMain: true }, { id: 2 }], privacy: null }, Date.now());
  faveIds.seed({ token, folderId: 1 }, index, Date.now());
  faveIds.seed({ token, folderId: 2 }, { ...index, ids: [1, 2] }, Date.now());
  answer = a => a === 'get_faves' ? favesOf(index.ids, index.folders) : { folder_ids: [2] };
  const result = await actions.removeFromFolder(token, [1, 2], 1);
  await paint();
  assert.deepEqual(result.succeeded, [1, 2]);
  assert.deepEqual(faveIds.peek({ token, folderId: 1 }).data.ids, [3]);
  assert.deepEqual(faveIds.peek({ token, folderId: 2 }).data.ids, [1, 2]);
  assert.deepEqual(faveIds.peek({ token }).data.ids, [1, 2, 3]);
  assert.deepEqual(faveIds.peek({ token }).data.folders, { 1: [2], 2: [2], 3: [1] });
});

test('import dedupes ids, skips existing favourites and sends the rest as one replayable batch; a refusal fails the batch', async () => {
  answer = a => a === 'get_faves' ? favesOf([1]) : OK;
  const result = await actions.importFavourites(token, [1, 2, 2, 3, 4], 2);
  assert.deepEqual(result.imported, [2, 3, 4]); assert.deepEqual(result.skipped, [1]); assert.equal(result.failed.length, 0);
  const writes = sent.filter(r => r.action === 'batch_add_faves');
  assert.deepEqual(writes.map(r => r.body), [{ image_ids: [2, 3, 4], folder_id: 2 }]);
  assert.ok(new Headers(writes[0].init.headers).get('Idempotency-Key'));
  assert.deepEqual(faveIds.peek({ token }).data.folders[3], [2]);
  answer = a => a === 'get_faves' ? favesOf([1]) : a === 'batch_add_faves' ? rustError(404, 'FOLDER_NOT_FOUND', '收藏夹不存在或不属于此账号') : OK;
  const refused = await actions.importFavourites(token, [2, 3], 9);
  assert.deepEqual(refused.imported, []); assert.deepEqual(refused.failed.map(f => f.id), [2, 3]);
});

test('batch summaries use actual affected counts and per-target shortfalls', () => {
  assert.deepEqual(transferSummary({ affected: 1, targets: [] }, 'move', 3), { text: '已移动 1 张，2 张未完成', partial: true });
  const summary = transferSummary({ affected: null, targets: [{ folderId: 2, folderName: '风景', requested: 3, succeeded: 1, failed: 2, reasons: { 已存在: 2 } }] }, 'copy', 3);
  assert.equal(summary.partial, true); assert.match(summary.text, /风景.*成功 1 张，失败 2 张.*已存在 2 张/);
});

test('acknowledged favourite changes expire this account’s task progress without inventing counters', async t => {
  const expired = t.mock.method(tasks, 'expire', () => {});
  answer = a => a === 'get_faves' ? favesOf([1]) : { folder_ids: [2] };
  await actions.setImageFolders(token, 1, [2]);
  assert.deepEqual(expired.mock.calls.map(call => call.arguments), [[{ token }]]);
});

test('a rejected favourite and a batch with no acknowledged changes do not expire task progress', async t => {
  const expired = t.mock.method(tasks, 'expire', () => {});
  answer = a => a === 'get_faves' ? favesOf([1]) : rustError(404, 'FOLDER_NOT_FOUND', '收藏夹不存在或不属于此账号');
  await assert.rejects(actions.setImageFolders(token, 1, [2]));
  const outcome = await actions.removeFromFolder(token, [1], 1);
  assert.equal(outcome.failed.length, 1);
  const imported = await actions.importFavourites(token, [2], 1);
  assert.equal(imported.failed.length, 1);
  assert.equal(expired.mock.callCount(), 0);
});

test('an acknowledged response for an old session cannot expire another account’s tasks', async t => {
  const expired = t.mock.method(tasks, 'expire', () => {});
  const held = deferred();
  faveIds.seed({ token }, { ids: [1], dates: {}, folders: { 1: [1] } }, Date.now());
  answer = a => a === 'set_image_fave_folders' ? held.promise : OK;
  const saving = actions.setImageFolders(token, 1, [2]); await flush();
  setSession('next-account'); held.resolve({ image_id: 1, folder_ids: [2], favorited: true }); await saving;
  assert.equal(expired.mock.callCount(), 0);
});

test('download skips unreachable lines, rejects error pages and empty bodies, and makes a readable partial ZIP', async () => {
  const media = new Uint8Array([137, 80, 78, 71, 9]);
  answer = (_a, _b, u) => {
    if (u.searchParams.has('_t')) return new Response(media, { headers: { 'content-type': 'image/png' } });
    if (u.pathname.includes('/2/')) return new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } });
    if (u.pathname.includes('/3/')) return new Response('', { headers: { 'content-type': 'image/png' } });
    return new Response(media, { headers: { 'content-type': 'application/octet-stream; charset=binary' } });
  };
  const progress = [];
  const result = await download.packFavourites([picture(1), picture(2), picture(3), picture(4)], { onProgress: (...p) => progress.push(p) });
  assert.equal(result.packed, 2); assert.equal(result.failed, 2); assert.equal(result.cancelled, false);
  assert.equal(sent.filter(r => r.target.searchParams.has('_t')).length, 1);
  assert.deepEqual(progress.at(-1), [4, 2, 4]);
  const check = spawnSync('python', ['-c', "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==['full.png','full_2.png']; assert z.testzip() is None; assert z.read('full.png')==bytes([137,80,78,71,9])"], { input: Buffer.from(await result.archive.arrayBuffer()) });
  assert.equal(check.status, 0, check.stderr.toString());
});

test('zero successes never produce a ZIP, empty selection does not fetch, and cancellation stops after the last accepted file', async () => {
  assert.equal((await download.packFavourites([])).archive, null); assert.equal(sent.length, 0);
  answer = () => new Response('forbidden', { status: 403 });
  const failed = await download.packFavourites([picture(1)]);
  assert.equal(failed.archive, null); assert.equal(failed.failed, 1);
  answer = () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
  const controller = new AbortController(); sent = [];
  const cancelled = await download.packFavourites([picture(1), picture(2)], { signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.packed, 1);
  assert.equal(sent.some(r => r.target.pathname.includes('/2/')), false);
});

test('unreachable worker probes do not discard a readable direct line', async () => {
  answer = (_a, _b, u) => { if (u.hostname !== 'derpicdn.net') throw new TypeError('CORS'); return new Response('ok'); };
  assert.deepEqual(await download.probeLines(['worker', 'direct']), ['direct']);
  assert.deepEqual(download.linesFor('picpony'), ['worker', 'direct']);
  assert.deepEqual(download.linesFor('cdn'), ['direct', 'worker']);
});

test('a folder link is the backend’s short link to the owner’s id, made signed in (the share counts there)', async () => {
  answer = a => a === 'create_share_link' ? ({ share_id: 'FolderLinkShareId0000001', preview_status: 'generic' }) : OK;
  assert.equal(await copyFolderLink(token, '小马', 2, '风景'), true); await flush();
  assert.equal(clipboard[0], 'https://fixture.invalid/share.php?id=FolderLinkShareId0000001');
  const made = sent.filter(r => r.action === 'create_share_link');
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].body, { target_url: 'https://fixture.invalid/favorites/shared/~1/2', title: '风景', description: '小马 的收藏夹' });
  assert.equal(new Headers(made[0].init.headers).get('authorization'), `Bearer ${token}`);
  assert.equal(sent.some(r => r.action === 'track_share'), false, 'no client-reported share counter');
});

test('a folder link the backend refuses is the long one', async () => {
  answer = a => a === 'create_share_link' ? rustError(400, 'SHARE_TARGET_NOT_ALLOWED', '分享目标只能是本站页面') : OK;
  assert.equal(await copyFolderLink(token, '小马', 2, '风景'), true); await flush();
  assert.equal(clipboard[0], 'https://fixture.invalid/favorites/shared/~1/2');
});

test('a failed clipboard copy or a session that changed copies nothing', async () => {
  clipboardFails = true;
  assert.equal(await copyFolderLink(token, 'test', 2, 'folder'), false);
  clipboardFails = false;
  setSession('next-account');
  assert.equal(await copyFolderLink(token, 'test', 2, 'folder'), false);
  assert.equal(clipboard.length, 0);
  assert.equal(sent.filter(r => r.action === 'create_share_link').length, 1, 'an obsolete session makes no link');
});

test('shared privacy transport failures stay failures instead of masquerading as a password gate', async () => {
  for (const status of [429, 500]) {
    answer = () => rustError(status, status === 429 ? 'RATE_LIMITED' : 'INTERNAL', '不可用');
    await assert.rejects(api.getSharedPrivacyFaves(token, 2), e => e.status === status && e.retryable);
  }
});

test('a dead probe orders the lines and never empties them: the batch still fetches every picture (G3-008)', async () => {
  const media = new Uint8Array([137, 80, 78, 71, 7]);
  answer = (_a, _b, u) => u.searchParams.has('_t')
    ? new Response('gone', { status: 404 })
    : new Response(media, { headers: { 'content-type': 'image/png' } });
  assert.deepEqual(await download.batchLines(), ['direct']);
  sent = [];
  const result = await download.packFavourites([picture(1), picture(2)]);
  assert.equal(result.packed, 2); assert.equal(result.failed, 0);
  assert.equal(sent.filter(r => !r.target.searchParams.has('_t')).length, 2);
});

test('下载全部 packs a page an archive, hands each over as it is finished and names them 1of3 (G3-013)', async () => {
  const media = new Uint8Array([137, 80, 78, 71, 8]);
  answer = () => new Response(media, { headers: { 'content-type': 'image/png' } });
  const total = 2 * download.ARCHIVE_LIMIT + 1;
  const images = Array.from({ length: total }, (_, i) => picture(i + 1));
  const handed = [];
  const progress = [];
  const result = await download.packArchives(images, {
    onProgress: (...p) => progress.push(p),
    onArchive: (archive, part, parts) => handed.push({ archive, part, parts }),
  });
  assert.deepEqual(result, { packed: total, failed: 0, cancelled: false, archives: 3 });
  assert.deepEqual(handed.map(({ part, parts }) => [part, parts]), [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(progress.at(-1), [total, 0, total]);
  assert.ok(progress.every(([done], at) => at === 0 || done > progress[at - 1][0]), 'progress counts across the batch');
  assert.equal(sent.filter(r => r.target.searchParams.has('_t')).length, 1, 'one probe for the whole batch');
  const count = spawnSync('python', ['-c', 'import io,sys,zipfile; print(len(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).namelist()))'], { input: Buffer.from(await handed[0].archive.arrayBuffer()) });
  assert.equal(count.stdout.toString().trim(), String(download.ARCHIVE_LIMIT));
  assert.equal(download.archiveName(1700000000000, 1, 3), 'picpony_batch_1700000000000_1of3.zip');
  assert.equal(download.archiveName(1700000000000), 'picpony_batch_1700000000000.zip');
  assert.equal(download.packedSentence(total, 0, 3), `已打包 ${total} 张，分为 3 个压缩包`);
  assert.equal(download.packedSentence(3, 1), '已打包 3 张，1 张失败');
});

test('a cancel keeps the archives already handed over and drops the one in progress (G3-013)', async () => {
  answer = () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
  const images = Array.from({ length: download.ARCHIVE_LIMIT + 5 }, (_, i) => picture(i + 1));
  const controller = new AbortController();
  const handed = [];
  const result = await download.packArchives(images, {
    signal: controller.signal,
    onProgress: (done) => { if (done === download.ARCHIVE_LIMIT + 2) controller.abort(); },
    onArchive: (_archive, part) => handed.push(part),
  });
  assert.equal(result.cancelled, true);
  assert.deepEqual(handed, [1]);
  assert.equal(result.archives, 1);
  assert.equal(result.packed, download.ARCHIVE_LIMIT);
});

test('a folder deletion rewrites the public list and the default as they are when it lands (G3-007)', async () => {
  values.set(LS_KEYS.publicFaveFolderIds, JSON.stringify([2, 3]));
  values.set(LS_KEYS.defaultFaveFolderId, '5');
  faveFolders.seed({ token }, { folders: [1, 2, 3, 4, 5].map(id => ({ id, isMain: id === 1 })), privacy: null }, Date.now());
  const held = deferred();
  answer = a => a === 'delete_fave_folders' ? held.promise : OK;
  const deleting = actions.deleteFolders(token, [3]);
  await flush();
  /* Meanwhile, another tab makes 4 public and 3 the default. */
  values.set(LS_KEYS.publicFaveFolderIds, JSON.stringify([2, 3, 4]));
  values.set(LS_KEYS.defaultFaveFolderId, '3');
  held.resolve(null);
  await deleting;
  assert.deepEqual(JSON.parse(values.get(LS_KEYS.publicFaveFolderIds)), [2, 4]);
  assert.equal(values.get(LS_KEYS.defaultFaveFolderId) ?? null, null);
  assert.deepEqual(faveFolders.peek({ token }).data.folders.map(folder => folder.id), [1, 2, 4, 5], 'the card leaves as the request lands');
});

test('a merge hands the default to its target as the default stands when it lands (G3-007)', async () => {
  values.set(LS_KEYS.defaultFaveFolderId, '4');
  faveFolders.seed({ token }, { folders: [1, 2, 3, 4].map(id => ({ id, isMain: id === 1 })), privacy: null }, Date.now());
  const held = deferred();
  answer = a => a === 'merge_fave_folders' ? held.promise : OK;
  const merging = actions.mergeFolders(token, [2, 3], { id: 4, name: '壁纸' });
  await flush();
  values.set(LS_KEYS.defaultFaveFolderId, '2');
  held.resolve({ target_folder_id: 4 });
  await merging;
  assert.equal(values.get(LS_KEYS.defaultFaveFolderId), '4');
  assert.equal(values.get(LS_KEYS.defaultFaveFolderName), '壁纸');
});

test('a removal writes the folder’s shifted pages from the pictures already held, stale underneath (M1-001)', async () => {
  const size = 50;
  const ids = Array.from({ length: size + 10 }, (_, i) => i + 1);
  const index = { ids, dates: {}, folders: Object.fromEntries(ids.map(id => [id, [2]])) };
  faveFolders.seed({ token }, { folders: [{ id: 1, isMain: true }, { id: 2 }], privacy: null }, Date.now());
  faveIds.seed({ token, folderId: 2 }, index, Date.now());
  const pages = [ids.slice(0, size), ids.slice(size)];
  for (const page of pages) favePictures.seed({ ids: page }, { ids: page, images: page.map(picture) }, Date.now());
  answer = a => a === 'get_faves' ? favesOf(ids, index.folders) : { folder_ids: [] };
  const result = await actions.removeFromFolder(token, [3], 2);
  assert.deepEqual(result.succeeded, [3]);
  const after = ids.filter(id => id !== 3);
  const first = favePictures.peek({ ids: after.slice(0, size) });
  assert.deepEqual(first.data.images.map(image => image.id), after.slice(0, size), 'picture 51 shifts in from the page behind');
  assert.equal(first.isStale, true, 'and is re-read underneath');
  assert.deepEqual(favePictures.peek({ ids: after.slice(size) }).data.images.map(image => image.id), after.slice(size));
});

test('a shifted page never counts a picture no cached page answered as missing (M1-001)', async () => {
  const size = 50;
  const ids = Array.from({ length: size + 10 }, (_, i) => i + 1);
  const index = { ids, dates: {}, folders: Object.fromEntries(ids.map(id => [id, [2]])) };
  faveFolders.seed({ token }, { folders: [{ id: 1, isMain: true }, { id: 2 }], privacy: null }, Date.now());
  faveIds.seed({ token, folderId: 2 }, index, Date.now());
  const first = ids.slice(0, size);
  favePictures.seed({ ids: first }, { ids: first, images: first.map(picture) }, Date.now());
  answer = a => a === 'get_faves' ? favesOf(ids, index.folders) : { folder_ids: [] };
  await actions.removeFromFolder(token, [3], 2);
  /* A write publishes on a paint boundary; the whole page's `expire` used to publish it at once. */
  await new Promise(resolve => setTimeout(resolve, 0));
  const after = ids.filter(id => id !== 3).slice(0, size);
  const shown = favePictures.peek({ ids: after });
  const written = shown.data;
  assert.deepEqual(written.ids, after.filter(id => id !== size + 1));
  assert.deepEqual(written.images.map(image => image.id), written.ids);
  assert.equal(shown.isStale, false,
    'a page left a picture short is not re-read quietly: the screen showing it reads it for real, and says so if that read fails');
});

test('a finished run says what it did, from its own counts, in place of the running line', async () => {
  const { completeProgress, runSummary } = await import('../components/favorites/progressState.ts');
  /* The meter fills for every step the run went through, failed ones included, so the words carry
     the counts (FX-F8): 已<verb>, and the failures beside them. */
  assert.equal(runSummary('已导入', 50, 0), '已导入 50 张');
  assert.equal(runSummary('已移出', 1, 1), '已移出 1 张，1 张失败');
  const running = { title: '正在导入到云端收藏', detail: '正在导入', done: 49, total: 50 };
  assert.deepEqual(completeProgress('已导入 50 张')(running), { ...running, done: 50, summary: '已导入 50 张' });
  assert.equal(completeProgress('已导入 50 张')(null), null);
});
