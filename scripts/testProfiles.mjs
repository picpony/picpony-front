/**
 * The profiles' pure contracts, with no browser and no live service: what a profile shows
 * (`lib/profiles.ts` — hidden tabs, the bound account, the default tab and the IP location;
 * `lib/format.ts` owns the birthday shape), the badge readers (`lib/userBadges.ts` — the backend's
 * spelling, expiry, the worn set)
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

/** A public profile as `GET /users/{id}` sends it (`profiles::public`), through the one mapping. */
const wire = (over = {}) => ({
  id: 1, username: 'a', avatar: null, banner: null, role: 'user', bio: '', gender: '保密', race: '',
  experience: 0, level: 1, created_on: '2026-01-01', last_online: null, ip_location: '',
  visibility: { showUploads: true, showFaves: true, showPosts: true, showComments: true },
  badges: [], equipped_badges: [], upstream_identity: null, ...over,
});
const P = (over) => profiles.profileFromWire(wire(over));

test('the wire profile maps once: identity, day joined, visibility as the owner’s tab settings', () => {
  const profile = P({ upstream_identity: { id: 583672, name: 'Nocturne' }, created_on: '2025-05-01' });
  assert.equal(profile.derpi_user_id, 583672);
  assert.equal(profile.derpi_username, 'Nocturne');
  assert.equal(profile.has_api_key, true);
  assert.equal(profile.created_at, '2025-05-01');
  assert.deepEqual(profile.settings, { showUploads: true, showFaves: true, showPosts: true, showComments: true });
  const unbound = P();
  assert.equal(unbound.derpi_user_id, null);
  assert.equal(unbound.has_api_key, false);
});

test('a tab the owner hides is hidden from visitors only', () => {
  const profile = P({ visibility: { showUploads: false, showFaves: true, showPosts: true, showComments: true } });
  assert.equal(profiles.hiddenFromVisitors(profile, 'uploads'), true);
  assert.equal(profiles.hiddenFromVisitors(profile, 'faves'), false);
  assert.equal(profiles.tabVisible(profile, 'uploads', false), false);
  assert.equal(profiles.tabVisible(profile, 'uploads', true), true, 'the owner always sees their own');
  assert.equal(profiles.hiddenFromVisitors(profiles.withSettings(profile, { showUploads: true }), 'uploads'), false,
    'the owner’s device choices lay over the record');
});

test('uploads are the verified account’s, by id, and nobody’s without one', () => {
  assert.equal(profiles.uploaderTerm(P({ upstream_identity: { id: 583672, name: 'x' } })), 'uploader_id:583672');
  assert.equal(profiles.uploaderTerm(P()), null);
  assert.equal(profiles.hasBoundAccount(P()), false);
});

test('the default tab is chosen from public data: uploads when a visitor can see some, else the first shown', () => {
  const shown = { showUploads: true, showFaves: true, showPosts: true, showComments: true };
  const bound = (visibility = {}) => P({ upstream_identity: { id: 7, name: 'x' }, visibility: { ...shown, ...visibility } });
  assert.equal(profiles.defaultProfileTab(bound()), 'uploads');
  assert.equal(profiles.defaultProfileTab(P()), 'faves', 'unbound');
  assert.equal(profiles.defaultProfileTab(bound({ showUploads: false })), 'faves');
  assert.equal(profiles.defaultProfileTab(bound({ showUploads: false, showFaves: false })), 'posts');
  assert.equal(
    profiles.defaultProfileTab(bound({ showUploads: false, showFaves: false, showPosts: false, showComments: false })),
    'uploads',
    'hiding everything opens on uploads, whose hidden state says so',
  );
});

test('the IP location shows unless it is missing or 未知; hidden by its owner, it reads 已隐藏', () => {
  assert.equal(profiles.ipLocationOf(P({ ip_location: ' 中国 江苏 ' })), '中国 江苏');
  assert.equal(profiles.ipLocationOf(P({ ip_location: '未知' })), null);
  assert.equal(profiles.ipLocationOf(P({ ip_location: '' })), null);
  assert.equal(profiles.ipLocationOf(P({ ip_location: '该用户已隐藏' })), '已隐藏', "the backend's own answer");
  assert.equal(profiles.ipLocationOf(profiles.withSettings(P({ ip_location: '中国 广东' }), { hideIpLocation: true })), '已隐藏',
    'the owner’s own setting wins even over a location the backend still sent');
});

test('a birthday prints its month and day, never its year', () => {
  assert.equal(format.birthdayLabel('2005-10-01'), '10月1日');
  assert.equal(format.birthdayLabel('1999-12-31 00:00:00'), '12月31日');
  assert.equal(format.birthdayLabel('2005-13-01'), null);
  assert.equal(format.birthdayLabel(''), null);
  assert.equal(format.birthdayLabel(null), null);
});

test('the Derpibooru card links in the app, by id', () => {
  assert.equal(profiles.derpiProfileHref(P({ upstream_identity: { id: 583672, name: 'x' } })), '/derpi/user/583672');
  assert.equal(profiles.derpiProfileHref(P()), null);
});

test('a bio is trimmed, and an id that cannot be one is not asked about', () => {
  assert.equal(profiles.bioOf(P({ bio: '  你好\n世界 \n' })), '你好\n世界');
  assert.equal(profiles.bioOf(P()), '');
  for (const id of ['1', '583672']) assert.equal(profiles.isProfileId(id), true, id);
  for (const id of ['0', '-1', 'abc', '1.5', '', '01', '12345678901234567']) assert.equal(profiles.isProfileId(id), false, id);
});

// --- lib/userBadges.ts -----------------------------------------------------------------------

test('held badges read the backend’s one spelling, ids kept', () => {
  assert.deepEqual(
    badges.parseHeldBadges([
      { id: 3, name: '公测先锋', color: '#ff9600', expires_at: null, expired: false },
      { id: 2, name: '站务', color: '#f1c40f', expires_at: '2026-10-01T00:00:00+08:00' },
    ]),
    [
      { id: 3, name: '公测先锋', color: '#ff9600', expiresAt: null },
      { id: 2, name: '站务', color: '#f1c40f', expiresAt: '2026-10-01T00:00:00+08:00' },
    ],
  );
  assert.deepEqual(badges.parseHeldBadges(undefined), [], 'a source without badges has none');
});

test('the equipped set keeps its order and each badge’s id', () => {
  assert.deepEqual(badges.parseEquippedBadges([
    { id: 9, name: '2026CSBC', color: '#99ccff', position: 0 },
    { id: 4, name: '伪天角', color: '#22c55e', position: 1 },
  ]), [
    { id: 9, badge_name: '2026CSBC', badge_color: '#99ccff' },
    { id: 4, badge_name: '伪天角', badge_color: '#22c55e' },
  ]);
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

test('public folders: the owner’s by id, mapped from the backend’s rows; an unknown owner is not found', async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = new URL(String(url), 'https://app.invalid');
    return json({
      owner_id: 12,
      folders: [
        { id: 1, name: '主收藏夹', is_main: true, created_at: '2026-01-01T00:00:00Z', image_count: 1139, latest_image_id: 3898880 },
        { id: 8, name: '测试合并', is_main: false, created_at: '2026-01-02T00:00:00Z', image_count: 10, latest_image_id: null },
      ],
    });
  };
  assert.deepEqual(await favorites.getProfileFaveFolders(12), [
    { id: 1, name: '主收藏夹', isMain: true, itemCount: 1139, latestImageId: 3898880 },
    { id: 8, name: '测试合并', isMain: false, itemCount: 10, latestImageId: null },
  ]);
  assert.equal(asked.pathname, '/api/v1/users/12/favorite-folders');

  globalThis.fetch = async () => json({ error: { code: 'USER_NOT_FOUND', message: '用户不存在' } }, { status: 404 });
  const missing = await favorites.getProfileFaveFolders(99).catch((error) => error);
  assert.ok(missing instanceof ApiError);
  assert.equal(isNotFound(missing), true);
  assert.equal(isRetryable(missing), false);
});

test('the badge dictionary is a name → description map; a failure throws', async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = String(url);
    return json({ dictionary: [{ name: '公测先锋', description: ' 参与公测 ' }, { name: '空', description: '' }] });
  };
  assert.deepEqual(await picpony.getBadgeDictionary(), { 公测先锋: '参与公测' });
  assert.equal(asked, '/api/v1/badges/dictionary');
  globalThis.fetch = async () => json({ error: { code: 'INTERNAL', message: '服务暂不可用' } }, { status: 503 });
  await assert.rejects(picpony.getBadgeDictionary(), ApiError);
});

test('the owner’s badges: held rows with their expiry, the worn set with ids', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/v1/me/badges');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer t');
    return json({
      badges: [
        { id: 1, user_id: 5, name: 'a', color: '#111111', expires_at: null, expired: false },
        { id: 2, user_id: 5, name: 'b', color: '#222222', expires_at: '2027-01-01T00:00:00Z', expired: false },
      ],
      equipped: [{ id: 1, name: 'a', color: '#111111', expires_at: null, position: 0 }],
    });
  };
  assert.deepEqual(await picpony.getMyBadges('t'), {
    badges: [
      { id: 1, name: 'a', color: '#111111', expiresAt: null },
      { id: 2, name: 'b', color: '#222222', expiresAt: '2027-01-01T00:00:00Z' },
    ],
    equipped: [{ id: 1, badge_name: 'a', badge_color: '#111111' }],
  });
});

test('equipping sends the worn set as ids, in order, and a refusal throws its sentence', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), method: init.method, body: JSON.parse(init.body) };
    return json({ badge_ids: sent.body.badge_ids });
  };
  await picpony.equipBadges('t', [{ id: 4, badge_name: 'a', badge_color: '#111111' }, { id: 2, badge_name: 'b', badge_color: '#222222' }]);
  assert.deepEqual(sent, { url: '/api/v1/me/badges/equipment', method: 'PUT', body: { badge_ids: [4, 2] } });
  await picpony.equipBadges('t', []);
  assert.deepEqual(sent.body, { badge_ids: [] }, 'an empty list takes every badge off');
  await assert.rejects(picpony.equipBadges('t', [{ badge_name: 'x', badge_color: '#000000' }]), ApiError,
    'a badge without its id cannot be named');

  globalThis.fetch = async () => json({ error: { code: 'BADGE_NOT_OWNED', message: '只能佩戴本人拥有且未过期的徽章' } }, { status: 403 });
  const refusal = await picpony.equipBadges('t', []).catch((error) => error);
  assert.ok(refusal instanceof ApiError);
  assert.equal(refusal.code, 'BADGE_NOT_OWNED');
  assert.equal(refusal.message, '只能佩戴本人拥有且未过期的徽章');
});

test('shared faves are one entry per picture, first position kept, every page read (R7-002 / R7-036)', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url), 'https://app.invalid');
    asked.push([target.pathname, target.searchParams.get('page'), target.searchParams.get('folder_id')]);
    const page = Number(target.searchParams.get('page'));
    /* A favourite saved between the two reads shifts picture 100 onto the second page. */
    const ids = page === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [100, 101];
    return json({ owner_id: 12, image_ids: ids, items: [], total: 101, page, limit: 100 });
  };
  const ids = await favorites.getSharedFaves(12, 3);
  assert.equal(ids.length, 101);
  assert.deepEqual(ids.slice(-2), [100, 101]);
  assert.deepEqual(asked, [['/api/v1/users/12/favorites', '1', '3'], ['/api/v1/users/12/favorites', '2', '3']]);
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
    const id = new URL(String(url)).pathname.split('/').pop();
    asked.push(id);
    if (id === '404') return json({ error: { code: 'USER_NOT_FOUND', message: '用户不存在' } }, { status: 404 });
    if (id === '500') return new Response('', { status: 500 });
    return json({ user: wire({ id: Number(id), username: `u${id}` }) });
  };
  const seed = await readUserProfile('7');
  assert.equal(seed.key, '7');
  assert.equal(seed.data.username, 'u7');
  assert.equal(seed.data.has_api_key, false, 'the seed is the mapped domain profile');
  assert.equal(await readUserProfile('404'), PROFILE_MISSING);
  assert.equal(await readUserProfile('500'), null, 'a fault is left to the client read, and not retained');
  assert.equal(await readUserProfile('7&x=1'), PROFILE_MISSING);
  assert.deepEqual(asked, ['7', '404', '500'], 'an impossible id is never sent');
});

// --- lib/resources.ts ----------------------------------------------------------------------------

test('the profile reads forward their AbortSignal through their real adapters', async () => {
  const cases = [
    [catalogue.profileFaveFolders, { ownerId: 7 }],
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
