/**
 * Review part 7: the decisions on every item parts 1–6 left open ("需决策", "只给建议",
 * "转后端"), each test naming the item it settles (`P<n>-F<n>` / `P<n>-O<n>` in the part reports,
 * `P7-N<n>` for what part 7 found on the way). No live service: the backend behaviour these rest
 * on was measured against picpony.top and is recorded in `part7-review.md`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testReviewPart7');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, activeElement: null, cookie: '',
  addEventListener() {}, removeEventListener() {},
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------------------------------------- */
/* Part 1                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P1-F3 / P7-N1: one lockfile, reproduced by CI, and a package.json npm can install', () => {
  const pkg = JSON.parse(source('package.json'));
  /* `sharp` is both a direct dependency (P1-F8) and an override on dev; npm refuses an override
     that differs from the direct spec (EOVERRIDE), so the two must be the same pin. */
  if (pkg.overrides?.sharp) assert.equal(pkg.dependencies.sharp, pkg.overrides.sharp);
  assert.match(source('bun.lock'), /"sharp": "0\.35\.5"/);
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/browser.yml']) {
    const text = source(workflow);
    assert.match(text, /bun install --frozen-lockfile/, workflow);
    assert.doesNotMatch(text, /npm install/, workflow);
  }
});

test('P1-F5: the status cache is invalidated by every action that writes a status field', () => {
  /* Measured on picpony.top: the backend dispatches on the query's `action` only (a body
     `action`, JSON or form, is ignored; a repeated `action` is a 404), so the proxy's own
     `searchParams.get('action')` sees exactly what PHP runs. Each field `get_maintenance_status`
     answers is written by one of these actions. */
  const route = source('app/api.php/[[...path]]/route.ts');
  for (const action of [
    'admin_toggle_maintenance', 'admin_toggle_translate', 'admin_toggle_semantic_search',
    'admin_save_semantic_cloud', 'admin_save_global_api_route_policy', 'admin_save_global_image_route_policy',
  ]) assert.match(route, new RegExp(`'${action}'`), action);
  assert.match(route, /request\.nextUrl\.searchParams\.get\('action'\)/);
});

test('P1-F11: a limiter per client address, with a Retry-After', async () => {
  const { createRateLimiter, clientAddress, rateLimited } = await import('../lib/rateLimit.server.ts');
  let now = 1_000;
  const take = createRateLimiter({ limit: 3, windowMs: 10_000 }, () => now);
  assert.deepEqual([take('a'), take('a'), take('a')], [0, 0, 0]);
  assert.equal(take('a'), 10);
  assert.equal(take('b'), 0, 'another address has its own window');
  now += 9_500;
  assert.equal(take('a'), 1);
  now += 500;
  assert.equal(take('a'), 0, 'a new window');
  assert.equal(clientAddress(new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' })), '203.0.113.9');
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '198.51.100.7');
  assert.equal(clientAddress(new Headers()), 'local');
  const answer = rateLimited(7);
  assert.equal(answer.status, 429);
  assert.equal(answer.headers.get('retry-after'), '7');
});

test('P1-F11: /relay and /upload/submit answer 429 past their ceiling, before any upstream call', async () => {
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls += 1; return Response.json({ images: [] }); };
  try {
    const { GET } = await import('../app/relay/route.ts');
    const relayCall = () => {
      const url = 'https://app.invalid/relay?url=' + encodeURIComponent('https://derpibooru.org/api/v1/json/search/images?q=safe');
      const request = new Request(url, { headers: { 'x-real-ip': '192.0.2.50' } });
      Object.defineProperty(request, 'nextUrl', { value: new URL(url) });
      return GET(request);
    };
    for (let i = 0; i < 600; i += 1) assert.equal((await relayCall()).status, 200);
    const limited = await relayCall();
    assert.equal(limited.status, 429);
    assert.equal(upstreamCalls, 600);

    const { POST } = await import('../app/upload/submit/route.ts');
    const submitCall = () => POST(new Request('https://app.invalid/upload/submit', {
      method: 'POST', headers: { 'x-real-ip': '192.0.2.51', 'content-type': 'text/plain' }, body: 'x',
    }));
    for (let i = 0; i < 30; i += 1) assert.equal((await submitCall()).status, 415);
    assert.equal((await submitCall()).status, 429);
  } finally {
    globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
  }
});

test('P1-F11 / P2-O1: a user key never rides the third-party accel worker; a keyless read still does', async () => {
  const route = await import('../lib/route.ts');
  const keyed = 'https://derpibooru.org/api/v1/json/search/images?q=my%3Afaves&key=abcdefghij0123456789';
  const viaAccel = route.buildApiLineUrl(keyed, 'api_accel');
  assert.ok(viaAccel.startsWith('/relay?url='), viaAccel);
  assert.equal(new URL(decodeURIComponent(viaAccel.slice('/relay?url='.length).split('&')[0])).searchParams.get('key'), 'abcdefghij0123456789');
  const anonymous = route.buildApiLineUrl('https://derpibooru.org/api/v1/json/search/images?q=safe', 'api_accel');
  assert.doesNotMatch(anonymous, /^\/relay/);
  assert.ok(route.carriesApiKey(keyed));
  assert.ok(!route.carriesApiKey('https://derpibooru.org/api/v1/json/images/1?keyword=x'));
});

test('P2-O1: a write keeps its key — to Derpibooru itself when the third party is not trusted with keys', async () => {
  const route = await import('../lib/route.ts');
  const write = 'https://derpibooru.org/api/v1/json/images?key=abcdefghij0123456789';
  route.applySavedRoutePolicy({ global_api_route_policy: 'third_party', global_api_third_party_url: 'https://tx.pone.quest', global_api_third_party_pass_api_key: false });
  assert.equal(route.applyApiLineToWrite(write), write);
  route.applySavedRoutePolicy({ global_api_third_party_pass_api_key: true });
  assert.equal(route.applyApiLineToWrite(write), 'https://tx.pone.quest/api/v1/json/images?key=abcdefghij0123456789');
  route.applySavedRoutePolicy({ global_api_route_policy: 'auto' });
  assert.equal(route.applyApiLineToWrite(write), write);
});

test('P1-F12: the three hops share one set of header rules', async () => {
  const { forwardableResponseHeaders } = await import('../lib/proxyHeaders.ts');
  const upstream = new Headers({
    connection: 'x-secret, keep-alive', 'x-secret': '1', 'content-type': 'application/json',
    server: 'nginx', 'content-encoding': 'gzip', 'set-cookie': 'a=b', vary: 'Origin',
  });
  const out = forwardableResponseHeaders(upstream, new Set(['vary']));
  assert.deepEqual([...out.keys()], ['content-type']);
  for (const file of ['app/api.php/[[...path]]/route.ts', 'app/relay/route.ts', 'app/upload/submit/route.ts']) {
    const text = source(file);
    assert.match(text, /forwardableResponseHeaders/, file);
    assert.doesNotMatch(text, /const SKIP_RESPONSE_HEADERS/, file);
  }
});

test('P1-F14 / P6-O12: the Windows suites skip documentation-only changes and drafts, and run the profile gallery', () => {
  const browser = source('.github/workflows/browser.yml');
  assert.match(browser, /paths-ignore:/);
  assert.match(browser, /pull_request\.draft/);
  assert.match(browser, /npm run test:profile-gallery/);
  assert.equal(JSON.parse(source('package.json')).scripts['test:profile-gallery'], 'node scripts/reviewBrowser.mjs --profile-gallery');
});

/* ------------------------------------------------------------------------------------------- */
/* Part 2                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P2-O3: a new password is measured in bytes, as the backend measures it', async () => {
  const { validateNewPassword, passwordLength } = await import('../lib/validation.ts');
  assert.equal(passwordLength('中中a1234'), 11);
  assert.equal(validateNewPassword('中中a1234'), null, 'seven characters, eleven bytes: the server accepts it');
  assert.match(validateNewPassword('中文中文中文中a'), /按 3 位计/, 'eight characters, 22 bytes: the server refuses it');
  assert.equal(validateNewPassword('abcdefg1'), null);
  assert.match(validateNewPassword('abc1'), /^密码需为 8 到 20 位$/);
});

test('P2-F5 follow-up: a backslash-led address is emitted as the protocol-relative one it is', async () => {
  const { safeUrl } = await import('../lib/bbcode.ts');
  assert.equal(safeUrl('/\\evil.example/login'), '//evil.example/login');
  assert.equal(safeUrl('\\\\evil.example'), '//evil.example');
  assert.equal(safeUrl('///evil.example'), '//evil.example');
  assert.equal(safeUrl('/forum/1'), '/forum/1');
  assert.equal(safeUrl('javascript:alert(1)'), null);
});

test('P2-F9 follow-up: both session merges use the one credential rule', () => {
  for (const file of ['components/AppLayout.tsx', 'components/AuthModal.tsx']) {
    assert.match(source(file), /resolveDerpiCredentials\(/, file);
  }
});

/* ------------------------------------------------------------------------------------------- */
/* Part 3                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P3-O3: blacklisted ids beyond the query are filtered from the results', async () => {
  const { blacklistBeyondQuery, withoutOverflowBlacklisted, MAX_BLACKLIST_TERMS } = await import('../lib/searchQuery.ts');
  const list = Array.from({ length: MAX_BLACKLIST_TERMS + 3 }, (_, i) => i + 1);
  assert.deepEqual([...blacklistBeyondQuery(list)], [1, 2, 3], 'the oldest three the query could not carry');
  assert.equal(blacklistBeyondQuery(list.slice(0, 15)).size, 0);
  const images = [{ id: 1 }, { id: 4 }, { id: 500 }];
  assert.deepEqual(withoutOverflowBlacklisted(images, list).map((image) => image.id), [4, 500]);
  assert.match(source('lib/api/derpi.ts'), /withoutOverflowBlacklisted/);
  assert.match(source('lib/feed.server.ts'), /withoutOverflowBlacklisted/);
});

test('P3-O6: x-faces are emoticons, short x-words are not', async () => {
  const { describeImage } = await import('../lib/imageDescription.ts');
  const alt = describeImage({ id: 1, tags: ['xbox', 'x3', 'xd', 'safe'] });
  assert.match(alt, /xbox/);
  assert.doesNotMatch(alt, /\bx3\b|\bxd\b/);
});

test('P3-O1 / P3-O2 / P3-O4 / P3-O5: on-screen refreshes are kept, open records refresh, comment state is per picture', () => {
  const resource = source('lib/resource.ts');
  assert.match(resource, /keep: stale\.listeners\.size > 0/);
  assert.match(resource, /findIndex\(\(queued\) => !queued\.keep\)/);
  assert.match(source('lib/detail.ts'), /refreshWatchedEntry\(imageId, cached\)/);
  assert.match(source('components/PicDetail.tsx'), /downloadCandidates\(source\.url\)\[0\]/);
  const composer = source('components/CommentComposer.tsx');
  assert.match(composer, /submittingFor === imageId/);
  assert.match(composer, /shownImage\.current !== sentFor/);
});

/* ------------------------------------------------------------------------------------------- */
/* Part 4                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P4-O1: a message picture is drawn only from the known image hosts; others become links', async () => {
  const { legacyTokens } = await import('../app/messages/messageText.ts');
  const drawn = legacyTokens('[p]看[/p][img]https://derpicdn.net/img/1.png[/img]');
  assert.ok(drawn.some((token) => token.type === 'image' && token.src === 'https://derpicdn.net/img/1.png'));
  const tracked = legacyTokens('[br][img]https://tracker.example/pixel.gif[/img]');
  assert.ok(!tracked.some((token) => token.type === 'image'), 'no fetch on open');
  assert.ok(tracked.some((token) => token.type === 'link' && token.href.startsWith('https://tracker.example/')));
});

test('P4-O5: archives are planned under a byte budget as well as a count', async () => {
  const { planArchives, ARCHIVE_BYTES, ARCHIVE_LIMIT } = await import('../lib/favoritesDownload.ts');
  const video = (id) => ({ id, size: 50 * 1024 * 1024 });
  const plan = planArchives(Array.from({ length: 14 }, (_, i) => video(i + 1)));
  assert.deepEqual(plan.map((part) => part.length), [6, 6, 2]);
  assert.ok(plan.every((part) => part.reduce((sum, image) => sum + image.size, 0) <= ARCHIVE_BYTES));
  const small = planArchives(Array.from({ length: ARCHIVE_LIMIT + 1 }, (_, i) => ({ id: i + 1, size: 1000 })));
  assert.deepEqual(small.map((part) => part.length), [ARCHIVE_LIMIT, 1]);
  assert.deepEqual(planArchives([{ id: 1, size: ARCHIVE_BYTES * 2 }, { id: 2, size: 1 }]).map((part) => part.length), [1, 1], 'an oversized picture is its own archive');
});

test('P4-O6: the block-group mirror writes both lists or neither', async () => {
  const { LS_KEYS } = await import('../lib/constants.ts');
  const { mirrorBlockGroups } = await import('../lib/blockGroupMirror.ts');
  values.set(LS_KEYS.activeHiddenTags, '["old"]');
  values.delete(LS_KEYS.activeSpoileredTags);
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    if (key === LS_KEYS.activeSpoileredTags) throw new Error('quota');
    values.set(key, String(value));
  };
  try {
    const changed = mirrorBlockGroups([{ id: 1, name: 'g', is_active: true, hidden_tags: ['new'], spoilered_tags: ['other'] }]);
    assert.equal(changed, false);
    assert.equal(values.get(LS_KEYS.activeHiddenTags), '["old"]', 'the first write was rolled back');
  } finally {
    globalThis.localStorage.setItem = original;
  }
});

test('P4-O8 / P4-O9 / P4-O10: shares queue behind the conversation, image results refilter, short links follow edits', () => {
  assert.match(source('components/ShareToContactDialog.tsx'), /sendInLine\(/);
  assert.match(source('app/messages/outbox.ts'), /export function sendInLine/);
  assert.doesNotMatch(source('app/search/SearchScreen.tsx'), /images: outcome\.images\.filter/);
  assert.match(source('app/search/imageSearchStore.ts'), /entry\.token !== readToken\(\)/);
  assert.match(source('components/forum/threadActions.ts'), /JSON\.stringify\(\[post\.id, post\.title/);
});

test('P4-O11: a full pending-tag library says so instead of dropping the oldest', async () => {
  const { LS_KEYS } = await import('../lib/constants.ts');
  const { addPendingTag, MAX_PENDING } = await import('../lib/pendingTags.ts');
  values.set(LS_KEYS.pendingTags, JSON.stringify(Array.from({ length: MAX_PENDING }, (_, i) => `t${i}`)));
  assert.equal(addPendingTag('one-more'), 'full');
  assert.equal(JSON.parse(values.get(LS_KEYS.pendingTags))[0], 't0');
  values.delete(LS_KEYS.pendingTags);
  assert.equal(addPendingTag('first'), 'added');
});

/* ------------------------------------------------------------------------------------------- */
/* Part 5                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P5-O2: a confirmation card names the folders it acts on', async () => {
  const { actionLabel } = await import('../lib/assistant/actions.ts');
  const action = { name: 'call_site_api', call_id: 'c', arguments: { endpoint: 'delete_fave_folders', parameters: { folder_ids: [12, 15] } } };
  const names = new Map([[12, '日常'], [15, '壁纸']]);
  assert.equal(actionLabel(action, (id) => names.get(id)), '删除收藏夹及其中记录：「日常」(12)、「壁纸」(15)');
  assert.equal(actionLabel(action), '删除收藏夹及其中记录：12、15');
});

test('P5-O3 / P5-O9 / P5-O11 / P5-O12: approvals merge, a cleared history arms no undo, no doubled full stop, receipts on the shown document', () => {
  assert.match(source('lib/assistant/session.ts'), /approvals = parseApprovals\(readJournalText\(accountId, 'approved-tasks'\)\)\.filter/);
  const deletes = source('app/history/useHistoryDeletes.ts');
  assert.match(deletes, /generation\.current \+= 1/);
  assert.match(deletes, /if \(generation\.current === startedIn\) sent\.current/);
  assert.match(source('app/claim-badge/ClaimBadgeContent.tsx'), /replace\(\/\[。\.！!\]\+\$\/, ''\)/);
  assert.match(source('app/tasks/page.tsx'), /const shownDoc = tasks\.peek\(\{ token \}\)\.data/);
});

test('P5-O4: a name-only binding links to its uploads, never to a profile page that cannot open', async () => {
  const profiles = await import('../lib/profiles.ts');
  const href = profiles.derpiProfileHref({ id: 1, username: 'a', derpi_username: 'a, b' });
  assert.ok(href.startsWith('/search?q='));
  assert.equal(decodeURIComponent(href.slice('/search?q='.length)), 'uploader:a\\,\\ b');
  assert.equal(profiles.derpiProfileHref({ id: 1, username: 'a', derpi_username: 'x', has_api_key: false }), null);
});

test('P5-O5 / P5-O6 / P6-O13: the policies match the app, and nothing points outside the repository', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.ok(!('react-google-recaptcha' in pkg.dependencies));
  assert.ok(!('@types/react-google-recaptcha' in (pkg.devDependencies ?? {})));
  assert.doesNotMatch(source('app/layout.tsx'), /recaptcha/i);
  const policy = source('app/policy/PolicyScreen.tsx');
  assert.match(policy, /彩彩 AI 对话/);
  assert.doesNotMatch(policy, /by-nc-sa/);
  for (const file of ['public/companions/ORIGIN.md', 'lib/format.ts', 'AGENTS.md']) {
    assert.doesNotMatch(source(file), /picpony-review\/|fix\/K1\//, file);
  }
});

test('P5-O7 / P5-O8 / P6-O11: the avatar note drops GIF; bio and maintenance text count characters', () => {
  assert.doesNotMatch(source('app/settings/AccountPane.tsx'), /JPG、PNG 或 GIF/);
  assert.match(source('app/settings/ProfileDialog.tsx'), /Array\.from\(text\)\.length/);
  assert.match(source('components/admin/OtherTab.tsx'), /Array\.from\(text\)\.length/);
});

/* ------------------------------------------------------------------------------------------- */
/* Part 6                                                                                       */
/* ------------------------------------------------------------------------------------------- */

test('P6-O1: a busy import slot is retried after Retry-After; other failures are not', async () => {
  const { sendWithRetry, ImportNotSent } = await import('../lib/adminCatalogTools/importClient.ts');
  const waits = [];
  const busy = () => Object.assign(new ImportNotSent(503, '导入服务正忙'), { retryAfter: 5 });
  let calls = 0;
  const value = await sendWithRetry(async () => { calls += 1; if (calls < 3) throw busy(); return 'ok'; }, { stop: () => false, wait: async (ms) => { waits.push(ms); } });
  assert.equal(value, 'ok');
  assert.deepEqual(waits, [5000, 10000]);
  calls = 0;
  await assert.rejects(sendWithRetry(async () => { calls += 1; throw new ImportNotSent(403); }, { stop: () => false, wait: async () => {} }));
  assert.equal(calls, 1, 'a refusal that needs the operator is not retried');
  let stopped = false;
  await assert.rejects(sendWithRetry(async () => { stopped = true; throw busy(); }, { stop: () => stopped, wait: async () => {} }));
});

test('P6-O2: a shop picture must be an HTTPS address without credentials', async () => {
  const { shopPayload } = await import('../components/admin/shop.ts');
  const form = (imageUrl) => ({ name: 'x', description: '', imageUrl, price: '1', stock: '1', active: true });
  assert.ok(shopPayload(form('http://evil.example/a.png')).errors?.imageUrl);
  assert.ok(shopPayload(form('https://u:p@picpony.top/a.png')).errors?.imageUrl);
  assert.equal(shopPayload(form('https://picpony.top/uploads/a.png')).payload?.image_url, 'https://picpony.top/uploads/a.png');
  assert.equal(shopPayload(form('')).payload?.image_url, '');
});

test('P6-O4: a saved assistant config stays on screen until the re-read', () => {
  assert.match(source('components/admin/siteTools/AssistantTab.tsx'), /savedFrom: read\.data\?\.values/);
});

test('P6-O5: badge dates are checked against today and each other', async () => {
  const { badgeDateProblems, beijingToday } = await import('../components/admin/badges.ts');
  assert.equal(beijingToday(Date.UTC(2026, 9, 8, 17, 0)), '2026-10-09', 'Beijing is already tomorrow');
  assert.ok(badgeDateProblems({ badgeExpiresAt: '2026-10-01' }, '2026-10-09').badgeExpiresAt);
  assert.ok(badgeDateProblems({ badgeExpiresAt: '2026-11-01', linkExpiresAt: '2026-12-01' }, '2026-10-09').badgeExpiresAt);
  assert.deepEqual(badgeDateProblems({ badgeExpiresAt: '2026-12-01', linkExpiresAt: '2026-11-01' }, '2026-10-09'), {});
  assert.deepEqual(badgeDateProblems({}, '2026-10-09'), {});
});

test('P6-O6: the glossary editor sets the three marks; a form without them carries the row\'s', async () => {
  const model = await import('../components/admin/glossary/model.ts');
  const tag = { id: 3, en: 'oc', cn: '原创角色', aliases: [], cat: 'general', count: 0, description: '', is_restricted: 1, is_original_translation: 0, is_sensitive: 0 };
  const form = model.tagFormOf(tag);
  assert.deepEqual(form.flags, { restricted: true, originalTranslation: false, sensitive: false });
  const payload = model.tagSavePayload({ ...form, flags: { ...form.flags, sensitive: true } }, tag);
  assert.equal(payload.is_sensitive, 1);
  assert.equal(payload.is_restricted, 1);
  const { flags, ...legacy } = form;
  void flags;
  assert.equal(model.tagSavePayload(legacy, tag).is_restricted, 1);
});

test('P6-O7 / P6-O14: bulk delete names what it deletes; removing a user reads the editor as it is', () => {
  assert.match(source('components/admin/glossary/GlossaryTab.tsx'), /selectedNames\.current\.get\(id\)/);
  assert.match(source('components/admin/UsersTab.tsx'), /setEditing\(\(current\) => \(current\?\.id === user\.id \? null : current\)\)/);
});

test('P6-O8: one reading of a backend yes/no', async () => {
  const { flag } = await import('../lib/flag.ts');
  assert.deepEqual([true, 1, '1', 'true'].map(flag), [true, true, true, true]);
  assert.deepEqual([false, 0, '0', '', null, undefined, 'false', 2].map(flag), [false, false, false, false, false, false, false, false]);
  for (const file of ['components/admin/BadgesTab.tsx', 'components/admin/UsersTab.tsx', 'components/admin/MessagesAuditTab.tsx']) {
    assert.doesNotMatch(source(file), /(?<!flag\()(?:link|user|message)\.is_(?:active|banned|read) \?/, file);
  }
});

test('P6-O9 / P6-O10: the import stamp reads its unit; team order must be a safe integer', async () => {
  assert.match(source('components/admin/catalogTools/ImportToolsTab.tsx'), /epochStamp\(value\)/);
  const { teamPayload } = await import('../components/admin/team.ts');
  const values = { name: 'n', title: '', category: 'dev', userId: '', avatarUrl: '', order: '9007199254740993' };
  assert.ok(teamPayload(values).errors?.order);
  assert.equal(teamPayload({ ...values, order: '-3' }).payload?.order_num, -3);
});

void realFetch;
