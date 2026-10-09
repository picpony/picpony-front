/**
 * The profiles' pure contracts, with no browser and no live service: what a profile shows
 * (`lib/profiles.ts` — hidden tabs, the bound account, the default tab and the IP location;
 * `lib/format.ts` owns the birthday shape), the badge readers (`lib/userBadges.ts` — both wire
 * spellings, expiry, the worn set)
 * and the adapters the profile reads through (`lib/api/picpony.ts` — public folders, the badge
 * dictionary, the owner's badges, the equip write, the shared-faves de-duplication, a profile id
 * that cannot exist).
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testProfiles');

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
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const profiles = await import('../lib/profiles.ts');
const format = await import('../lib/format.ts');
const badges = await import('../lib/userBadges.ts');
const picpony = await import('../lib/api/picpony.ts');
const favorites = await import('../lib/api/favorites.ts');
const { ApiError, isNotFound, isRetryable } = await import('../lib/api/errors.ts');
const catalogue = await import('../lib/resources.ts');
const { PROFILE_MISSING, readUserProfile } = await import('../lib/profile.server.ts');
await (await import('../lib/route.ts')).ensureRoutePolicy();

const tick = () => new Promise((resolve) => setImmediate(resolve));

const json = (data, init) => Response.json(data, init);
const NOW = Date.parse('2026-09-27T12:00:00+08:00');

beforeEach(() => {
  values.clear();
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
});

// --- lib/profiles.ts -------------------------------------------------------------------------

test('a tab the owner hides is hidden from visitors only', () => {
  const profile = { id: 1, username: 'a', settings: { showUploads: false, showFaves: true } };
  assert.equal(profiles.hiddenFromVisitors(profile, 'uploads'), true);
  assert.equal(profiles.hiddenFromVisitors(profile, 'faves'), false);
  assert.equal(profiles.hiddenFromVisitors(profile, 'posts'), false, 'an absent setting shows the tab');
  assert.equal(profiles.tabVisible(profile, 'uploads', false), false);
  assert.equal(profiles.tabVisible(profile, 'uploads', true), true, 'the owner always sees their own');
  assert.equal(profiles.hiddenFromVisitors({ id: 1, username: 'a', settings: null }, 'uploads'), false);
});

test('uploads are the bound account’s: by id, else by an escaped name, never without a key', () => {
  assert.equal(profiles.uploaderTerm({ id: 1, username: 'a', derpi_user_id: '583672', has_api_key: true }), 'uploader_id:583672');
  assert.equal(
    profiles.uploaderTerm({ id: 1, username: 'a', derpi_username: 'A (B):C', has_api_key: true }),
    'uploader:A\\ \\(B\\)\\:C',
  );
  assert.equal(profiles.uploaderTerm({ id: 1, username: 'a', derpi_user_id: '5', has_api_key: false }), null,
    'a name typed without a key to prove it lists nothing');
  assert.equal(profiles.uploaderTerm({ id: 1, username: 'a', derpi_username: '  ', has_api_key: true }), null);
  assert.equal(profiles.hasBoundAccount({ id: 3, username: 'c', derpi_username: '', has_api_key: true }), false);
});

test('the default tab is chosen from public data: uploads when a visitor can see some, else the first shown', () => {
  const bound = { id: 1, username: 'a', derpi_user_id: 7, has_api_key: true };
  assert.equal(profiles.defaultProfileTab(bound), 'uploads');
  assert.equal(profiles.defaultProfileTab({ id: 2, username: 'b', has_api_key: false }), 'faves', 'unbound');
  assert.equal(profiles.defaultProfileTab({ ...bound, settings: { showUploads: false } }), 'faves');
  assert.equal(profiles.defaultProfileTab({ ...bound, settings: { showUploads: false, showFaves: false } }), 'posts');
  assert.equal(
    profiles.defaultProfileTab({ ...bound, settings: { showUploads: false, showFaves: false, showPosts: false, showComments: false } }),
    'uploads',
    'hiding everything opens on uploads, whose hidden state says so',
  );
});

test('the IP location shows unless it is missing or 未知; hidden by its owner, it reads 已隐藏', () => {
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: ' 中国 江苏 ' }), '中国 江苏');
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: '未知' }), null);
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: '' }), null);
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a' }), null);
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: '中国 广东', settings: { hideIpLocation: true } }), '已隐藏',
    'the setting wins even over a location the backend still sent');
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: '该用户已隐藏' }), '已隐藏', "the backend's own answer");
  assert.equal(profiles.ipLocationOf({ id: 1, username: 'a', ip_location: '中国 广东', settings: '{"hideIpLocation":true}' }), '已隐藏',
    'settings stored as JSON text are read too');
  assert.equal(profiles.hiddenFromVisitors({ id: 1, username: 'a', settings: '{"showPosts":false}' }, 'posts'), true);
  assert.equal(profiles.hiddenFromVisitors({ id: 1, username: 'a', settings: 'not json' }, 'posts'), false);
});

test('a birthday prints its month and day, never its year', () => {
  assert.equal(format.birthdayLabel('2005-10-01'), '10月1日');
  assert.equal(format.birthdayLabel('1999-12-31 00:00:00'), '12月31日');
  assert.equal(format.birthdayLabel('2005-13-01'), null);
  assert.equal(format.birthdayLabel(''), null);
  assert.equal(format.birthdayLabel(null), null);
});

test('the Derpibooru card links in the app, by id or by name', () => {
  assert.equal(profiles.derpiProfileHref({ id: 1, username: 'a', derpi_user_id: '583672' }), '/derpi/user/583672');
  /* Review P5-O4: a name-only binding leads to the search for its uploads, not a page that cannot open. */
  assert.equal(profiles.derpiProfileHref({ id: 1, username: 'a', derpi_username: 'Nocturne Rain' }), `/search?q=${encodeURIComponent('uploader:Nocturne\\ Rain')}`);
  assert.equal(profiles.derpiProfileHref({ id: 1, username: 'a' }), null);
});

test('a bio is trimmed, and an id that cannot be one is not asked about', () => {
  assert.equal(profiles.bioOf({ id: 1, username: 'a', bio: '  你好\n世界 \n' }), '你好\n世界');
  assert.equal(profiles.bioOf({ id: 1, username: 'a', bio: null }), '');
  for (const id of ['1', '583672']) assert.equal(profiles.isProfileId(id), true, id);
  for (const id of ['0', '-1', 'abc', '1.5', '', '01', '12345678901234567']) assert.equal(profiles.isProfileId(id), false, id);
});

// --- lib/userBadges.ts -----------------------------------------------------------------------

test('held badges read both wire spellings, one per name, and drop junk rows', () => {
  assert.deepEqual(
    badges.parseHeldBadges([
      { name: '公测先锋', color: '#ff9600', expires_at: null },
      { badge_name: '站务', badge_color: '#f1c40f', expires_at: '2026-10-01 00:00:00' },
      { name: '公测先锋', color: '#000000' },
      null, 'x', { color: '#fff' },
    ]),
    [
      { name: '公测先锋', color: '#ff9600', expiresAt: null },
      { name: '站务', color: '#f1c40f', expiresAt: '2026-10-01 00:00:00' },
    ],
  );
  assert.deepEqual(badges.parseHeldBadges(undefined), []);
});

test('the equipped set reads an array or its JSON string', () => {
  const raw = '[{"badge_name":"2026CSBC","badge_color":"#99ccff"},{"badge_name":"\\u4f2a\\u5929\\u89d2","badge_color":"#22c55e"}]';
  assert.deepEqual(badges.parseEquippedBadges(raw), [
    { badge_name: '2026CSBC', badge_color: '#99ccff' },
    { badge_name: '伪天角', badge_color: '#22c55e' },
  ]);
  assert.deepEqual(badges.parseEquippedBadges('not json'), []);
  assert.deepEqual(badges.parseEquippedBadges(null), []);
});

test('validity: 永久有效, 有效期至 the Beijing date, or 已过期', () => {
  assert.deepEqual(badges.badgeValidity(null, NOW), { expired: false, text: '永久有效' });
  assert.deepEqual(badges.badgeValidity('2026-10-01 00:00:00', NOW), { expired: false, text: '有效期至 2026/10/01' });
  assert.deepEqual(badges.badgeValidity('2026-09-27 11:59:00', NOW), { expired: true, text: '已过期' });
});

test('a lapsed badge is never worn, and at most three are', () => {
  const held = [
    { name: 'a', color: '#111111', expiresAt: null },
    { name: 'b', color: '#222222', expiresAt: '2025-01-01 00:00:00' },
  ];
  const worn = badges.wornBadges(
    ['a', 'b', 'c', 'd', 'e'].map((name) => ({ badge_name: name, badge_color: '#000000' })),
    held,
    NOW,
  );
  assert.deepEqual(worn.map((badge) => badge.badge_name), ['a', 'c', 'd']);
  assert.equal(badges.sameEquipped(worn, worn.slice()), true);
  assert.equal(badges.sameEquipped(worn, worn.slice(0, 2)), false);
  assert.equal(badges.MAX_EQUIPPED_BADGES, 3);
});

// --- lib/api/picpony.ts ------------------------------------------------------------------------

test('public folders: normalised, one per id, a refusal is not retryable', async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = new URL(String(url), 'https://app.invalid');
    return json({
      success: true,
      folders: [
        { id: 1, name: '主收藏夹', is_main: 1, item_count: 1139, latest_image_id: 3898880 },
        { id: '8', name: ' 测试合并 ', is_main: 0, item_count: '10', latest_image_id: null },
        { id: 8, name: 'dup' }, { id: 'x' }, null,
      ],
    });
  };
  assert.deepEqual(await favorites.getProfileFaveFolders('黄昏夜雨'), [
    { id: 1, name: '主收藏夹', isMain: true, itemCount: 1139, latestImageId: 3898880 },
    { id: 8, name: '测试合并', isMain: false, itemCount: 10, latestImageId: null },
  ]);
  assert.equal(asked.searchParams.get('action'), 'get_profile_fave_folders');
  assert.equal(asked.searchParams.get('username'), '黄昏夜雨');

  globalThis.fetch = async () => json({ success: false, message: '该用户未公开收藏夹' });
  const refusal = await favorites.getProfileFaveFolders('x').catch((error) => error);
  assert.ok(refusal instanceof ApiError);
  assert.equal(refusal.message, '该用户未公开收藏夹');
  assert.equal(isRetryable(refusal), false, 'the owner’s answer, not a fault');

  globalThis.fetch = async () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } });
  assert.equal(isNotFound(await favorites.getProfileFaveFolders('nobody').catch((error) => error)), true);
});

test('the badge dictionary is a name → description map; a success without its list is a failure', async () => {
  globalThis.fetch = async () =>
    json({ success: true, dicts: [{ badge_name: '公测先锋', description: ' 参与公测 ' }, { badge_name: '空', description: '' }, { x: 1 }] });
  assert.deepEqual(await picpony.getBadgeDictionary(), { 公测先锋: '参与公测' });
  globalThis.fetch = async () => json({ success: true });
  await assert.rejects(picpony.getBadgeDictionary(), ApiError);
});

test('the owner’s badges take their expiry from the row or from badge_expires', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer t');
    return json({
      success: true,
      badges: [{ badge_name: 'a', badge_color: '#111111' }, { badge_name: 'b', badge_color: '#222222', expires_at: '2027-01-01 00:00:00' }],
      equipped_badges: [{ badge_name: 'a', badge_color: '#111111' }],
      badge_expires: { a: '2026-12-01 00:00:00' },
    });
  };
  assert.deepEqual(await picpony.getMyBadges('t'), {
    badges: [
      { name: 'a', color: '#111111', expiresAt: '2026-12-01 00:00:00' },
      { name: 'b', color: '#222222', expiresAt: '2027-01-01 00:00:00' },
    ],
    equipped: [{ badge_name: 'a', badge_color: '#111111' }],
  });
});

test('equipping sends the whole worn set, and a refusal throws its sentence', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { action: new URL(String(url), 'https://app.invalid').searchParams.get('action'), body: JSON.parse(init.body) };
    return json({ success: true });
  };
  await picpony.equipBadges('t', [{ badge_name: 'a', badge_color: '#111111', extra: 1 }]);
  assert.deepEqual(sent, { action: 'equip_badge', body: { equipped_badges: [{ badge_name: 'a', badge_color: '#111111' }] } });
  await picpony.equipBadges('t', []);
  assert.deepEqual(sent.body, { equipped_badges: [] }, 'an empty list takes every badge off');

  globalThis.fetch = async () => json({ success: false, error: '最多只能佩戴3个徽章' });
  const refusal = await picpony.equipBadges('t', []).catch((error) => error);
  assert.ok(refusal instanceof ApiError);
  assert.equal(refusal.message, '最多只能佩戴3个徽章');
});

test('shared faves are one entry per picture, first position kept (R7-002 / R7-036)', async () => {
  globalThis.fetch = async () => json({ success: true, username: 'a', faves: [3, 1, 3, '2', 1, -1, 'x'] });
  assert.deepEqual((await favorites.getSharedFaves('a')).faves, [3, 1, 2]);
});

test('a profile id that cannot exist is not found without a request (R7-009)', async () => {
  const error = await picpony.getUserProfile('abc').catch((caught) => caught);
  assert.equal(isNotFound(error), true);
  assert.equal(isRetryable(error), false);
});

// --- lib/profile.server.ts ---------------------------------------------------------------------

test('the profile seed: the record, not-found for the backend’s 404 or an impossible id, null for a fault', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const id = new URL(String(url)).searchParams.get('user_id');
    asked.push(id);
    if (id === '404') return new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    if (id === '500') return new Response('', { status: 500 });
    return json({ success: true, user: { id: Number(id), username: `u${id}` } });
  };
  const seed = await readUserProfile('7');
  assert.equal(seed.key, '7');
  assert.equal(seed.data.username, 'u7');
  assert.equal(await readUserProfile('404'), PROFILE_MISSING);
  assert.equal(await readUserProfile('500'), null, 'a fault is left to the client read, and not retained');
  assert.equal(await readUserProfile('7&x=1'), PROFILE_MISSING);
  assert.deepEqual(asked, ['7', '404', '500'], 'an impossible id is never sent');
});

// --- lib/resources.ts ----------------------------------------------------------------------------

test('the profile reads forward their AbortSignal through their real adapters', async () => {
  const cases = [
    [catalogue.profileFaveFolders, { username: 'pony' }],
    [catalogue.folderCovers, { ids: [1, 2], fp: 'safe|-|d|-|' }],
    [catalogue.badgeDictionary, {}],
    [catalogue.myBadges, { token: 'fake' }],
  ];
  for (const [resource, args] of cases) {
    let signal;
    globalThis.fetch = async (_, init) => {
      signal = init?.signal;
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const pending = resource.read(args, { priority: 'background' });
    await tick();
    assert.ok(signal instanceof AbortSignal, `${resource.name} did not pass its signal`);
    assert.equal(resource.cancelBackground(args), true, resource.name);
    assert.equal(signal.aborted, true, resource.name);
    await assert.rejects(pending, { name: 'AbortError' });
    await tick();
  }
});

test('folder covers are one search inside the viewer’s exclusions, mapped by id', async () => {
  let query;
  globalThis.fetch = async (url) => {
    const target = new URL(String(url), 'https://app.invalid');
    query = target.searchParams.get('q');
    return json({ total: 1, images: [{ id: 2, representations: { medium: 'https://derpicdn.net/img/2/medium.png' } }] });
  };
  const covers = await catalogue.folderCovers.read({ ids: [1, 2], fp: 'cover-test' });
  assert.deepEqual(Object.keys(covers), ['2']);
  assert.match(query, /^\(id:1 OR id:2\), /, 'the ids are grouped before the device filters apply');
  assert.match(query, /-explicit/, 'the safe filter’s exclusions ride in the query');
});
