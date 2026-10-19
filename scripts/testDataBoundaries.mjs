/** Data/proxy regressions with isolated upstream responses; never contacts a live service. */
import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { registerHooks } from 'node:module';
import { blockFiltersEnvelope, publicBlacklistPage } from './netAuditFixtures.mjs';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testDataBoundaries');
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/cache') return {
    url: 'data:text/javascript,export function revalidateTag(){throw new Error("Next cache mutation requires an explicit test stub")}',
    shortCircuit: true,
  };
  return next(specifier, context);
} });

const originalFetch = globalThis.fetch;
const frames = [];
let frameId = 0;
const values = new Map();
const cookies = new Map();
const events = [];
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => { frames.push(callback); return ++frameId; },
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  dispatchEvent(event) { events.push(event.type); return true; },
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.document = {
  visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
  get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
  set cookie(value) {
    const pair = value.split(';', 1)[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  },
};
globalThis.localStorage = storage;

const query = await import('../lib/searchQuery.ts');
const client = await import('../lib/api/client.ts');
const route = await import('../lib/route.ts');
const picpony = await import('../lib/api/picpony.ts');
const derpi = await import('../lib/api/derpi.ts');
const admin = await import('../lib/api/admin.ts');
const catalogue = await import('../lib/resources.ts');
const { defineResource, clearAllResources, expireAllResources } = await import('../lib/resource.ts');
const { COOKIE_KEYS, LS_KEYS, IMAGE_WORKER_BASE } = await import('../lib/constants.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const relay = await import('../app/relay/route.ts');
const v1 = await import('../app/api/v1/[...path]/route.ts');
const { readApi } = await import('../lib/api/http.ts');
const { createServerMemo } = await import('../lib/serverMemo.ts');
const { upstreamOrigin } = await import('../lib/upstream.server.ts');
const { readHomeFeed } = await import('../lib/feed.server.ts');
const { readUserProfile } = await import('../lib/profile.server.ts');
const { readTeamMembers } = await import('../lib/team.server.ts');
const { inlineRoutePolicyScript } = await import('../lib/route.server.ts');
const { readBlockFilters, clearBlockFiltersMemo, clearPublicBlacklistMemo, BLOCK_FILTERS_CACHE_TAG } = await import('../lib/blockFilters.server.ts');
const blockFilters = await import('../lib/blockFilters.ts');
await route.ensureRoutePolicy();

const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  while (frames.length) frames.shift()();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
};
const json = (data, init) => Response.json(data, init);
function request(url, init) {
  const value = new Request(url, init);
  Object.defineProperty(value, 'nextUrl', { value: new URL(url) });
  return value;
}
const context = (path) => ({ params: Promise.resolve({ path }) });

/** The upstream Everything filter exposes one extra image in these profile fixtures. */
function derpiUploadsResponse(url) {
  const ids = url.searchParams.get('filter_id') === '56027' ? [1, 2] : [1];
  return json({
    total: ids.length,
    images: ids.map((id) => ({ id, representations: {}, view_url: '' })),
  });
}

beforeEach(() => {
  clearAllResources();
  values.clear();
  cookies.clear();
  events.length = 0;
  blockFilters.installBlockFilters(blockFilters.DEFAULT_BLOCK_FILTERS);
  blockFilters.installPublicBlacklist([]);
  globalThis.localStorage = storage;
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
  route.syncLinePrefs();
});
after(() => { globalThis.fetch = originalFetch; });

test('invalid filters retain safe exclusions even when another filter is present', () => {
  for (const contentFilter of ['', 'unknown', undefined, null]) {
    const settings = { contentFilter, banAnthro: true, onlyPony: true, hiddenTags: ['spoiler'] };
    const built = decodeURIComponent(query.buildSearchQueryFrom(settings));
    for (const tag of ['-suggestive', '-explicit', '-questionable', '-grotesque', '-grimdark']) {
      assert.ok(built.includes(tag), `${String(contentFilter)} lost ${tag}`);
    }
  }
  assert.equal(query.parseBrowsingFingerprint('invalid|a|d|p|spoiler').contentFilter, 'safe');
  assert.equal(query.parseContentFilter('developer'), 'developer');
});

test('browsing and line settings tolerate blocked storage and reject damaged sort values', async () => {
  values.set(LS_KEYS.contentFilter, 'broken');
  values.set(LS_KEYS.homeSort, 'score&q=explicit');
  values.set(LS_KEYS.searchSort, 'width');
  assert.equal(client.getBrowsingSettings().contentFilter, 'safe');
  assert.equal(client.getBrowsingSettings().homeSort, 'created_at');
  assert.equal(client.getBrowsingSettings().searchSort, 'width');
  globalThis.localStorage = { getItem() { throw new DOMException('blocked', 'SecurityError'); } };
  assert.equal(client.getBrowsingSettings().contentFilter, 'safe');
  assert.doesNotThrow(() => route.syncLinePrefs());
  await assert.doesNotReject(route.ensureRoutePolicy());
});

test('a shorter browsing fingerprint replaces the cookie whose value has that prefix', () => {
  const expected = catalogue.browsingFingerprint().split('|').slice(0, 5).join('|');
  cookies.set(COOKIE_KEYS.browsing, `${encodeURIComponent(expected)}old-hidden-tag`);
  catalogue.syncBrowsingCookie();
  assert.equal(cookies.get(COOKIE_KEYS.browsing), encodeURIComponent(expected));
});

test('forced direct image routing unwraps an already proxied response', () => {
  const raw = 'https://derpicdn.net/img/2026/1/1/123/small.png';
  const wrapped = IMAGE_WORKER_BASE + encodeURIComponent(raw);
  const mapped = client.applyImageLine({ representations: { small: wrapped }, view_url: wrapped });
  assert.equal(mapped.representations.small, raw);
  assert.equal(mapped.view_url, raw);
});

test('an unreadable /api/v1 answer is an ApiError, never a value a caller could publish', async () => {
  /* A 2xx is the bare DTO, an empty body (204) is `undefined`, an HTML page served as 200 is
     `invalid`; a non-2xx is an `http` error carrying the backend's code and sentence. */
  assert.deepEqual(await readApi(json({ value: 1 })), { value: 1 });
  assert.equal(await readApi(new Response(null, { status: 204 })), undefined);
  await assert.rejects(readApi(new Response('<html>error</html>')), (error) => error instanceof ApiError && error.kind === 'invalid');
  await assert.rejects(readApi(new Response('<html>bad gateway</html>', { status: 502 })), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 502 && error.code === undefined);
  await assert.rejects(readApi(json({ error: { code: 'FORBIDDEN', message: '没有权限' } }, { status: 403 })), (error) =>
    error instanceof ApiError && error.code === 'FORBIDDEN' && error.message === '没有权限' && !error.retryable);
});

test('each comment source fails on its own terms, as an error rather than an empty thread', async () => {
  /* PicPony's thread and Derpibooru's are two reads now (the detail joins them); a bad answer from
     either is that source's ApiError, never an empty list, and neither read touches the other. */
  const isLocal = (url) => new URL(String(url), 'https://app.invalid').pathname === '/api/v1/images/123/comments';
  for (const failed of ['picpony', 'derpi']) {
    globalThis.fetch = async (url) => {
      const local = isLocal(url);
      if (local ? failed === 'picpony' : failed === 'derpi') {
        return new Response('<html>bad gateway</html>', { status: 200 });
      }
      return local
        ? json({ comments: [{ id: 1, image_id: 123, user_id: 1, content: 'kept &amp; &lt;b&gt;', created_at: '2026-01-01T00:00:00Z',
          author: { id: 1, username: 'local', avatar: null, role: 'user', experience: 150, equipped_badges: [] } }], total: 1, total_pages: 1 })
        : json({ total: 1, comments: [{ id: 2, body: 'kept', created_at: 'Thu 2026-01-01 8:00 AM CST (UTC+08:00)',
          user_id: 9, author: 'external', avatar: 'data:image/svg+xml;base64,AAAA' }] });
    };
    if (failed === 'picpony') {
      await assert.rejects(picpony.getSiteComments(123), (error) => error instanceof ApiError);
      const other = await derpi.getImageComments(123, 1);
      assert.equal(other.total, 1);
      assert.deepEqual(other.comments.map((row) => [row.id, row.username, row.source, row.avatar]),
        [[2, 'external', 'trixiebooru', null]]);
    } else {
      await assert.rejects(derpi.getImageComments(123, 1), (error) => error instanceof ApiError);
      const own = await picpony.getSiteComments(123);
      assert.deepEqual(own.map((row) => [row.id, row.username, row.source, row.experience]), [[1, 'local', 'picpony', 150]]);
      assert.equal(own[0].body, 'kept & <b>', 'the sanitizer\'s entities are decoded once at the boundary');
    }
  }
  globalThis.fetch = async (url) => (isLocal(url)
    ? json({ comments: [], total: 0, total_pages: 0 })
    : json({ total: 0, comments: [] }));
  assert.deepEqual(await picpony.getSiteComments(123), []);
  assert.deepEqual(await derpi.getImageComments(123, 1), { comments: [], total: 0 });
});

test('user ids, featured keys and explicit search sorts cannot append URL parameters', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url), 'https://app.invalid');
    urls.push(target);
    if (target.pathname.startsWith('/api/v1/users/')) {
      return json({ user: { id: 583672, username: 'public', avatar: null, banner: null, role: 'user', bio: '', gender: '',
        race: '', experience: 0, level: 1, created_on: '2026-01-01T00:00:00Z', last_online: null, ip_location: '',
        visibility: { showUploads: true, showFaves: true, showPosts: true, showComments: true },
        badges: [], equipped_badges: [], upstream_identity: null } });
    }
    if (target.pathname.endsWith('/images/featured')) return json({ image: null });
    return json({ images: [], total: 0 });
  };
  /* A profile id is a positive integer: anything else is not found without a request, so a
     crafted one cannot reach the query at all. */
  const crafted = '1&action=unintended';
  await assert.rejects(picpony.getUserProfile(crafted), (error) => error.notFound === true);
  assert.equal(urls.length, 0, 'a crafted profile id sends nothing');
  await picpony.getUserProfile('583672');
  assert.equal(urls.at(-1).pathname, '/api/v1/users/583672');
  assert.equal(urls.at(-1).search, '');
  const key = 'secret&filter_id=0#fragment';
  await derpi.getFeatured(key);
  assert.equal(urls.at(-1).searchParams.get('key'), key);
  assert.equal(urls.at(-1).searchParams.has('filter_id'), false);
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'score&q=explicit' });
  assert.equal(urls.at(-1).searchParams.get('sf'), 'created_at');
  assert.equal(urls.at(-1).searchParams.getAll('q').length, 1);
  /* `hotness` was never a Philomena field; a legacy value falls back rather than reaching the
     URL, and the legacy `relevance` means `_score`. */
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'hotness' });
  assert.equal(urls.at(-1).searchParams.get('sf'), 'created_at');
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony OR zebra', sortField: 'relevance' });
  assert.equal(urls.at(-1).searchParams.get('sf'), '_score');
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'random' });
  assert.match(urls.at(-1).searchParams.get('sf'), /^random:\d+$/, 'the random sort is seeded');
  assert.equal(urls.at(-1).searchParams.has('sd'), false);
  const seeded = urls.at(-1).searchParams.get('sf');
  await client.fetchDerpiImages('https://derpibooru.org/api/v1/json', { query: 'pony', sortField: 'random', page: 2 });
  assert.equal(urls.at(-1).searchParams.get('sf'), seeded, 'page two keeps the seed of page one');
});

test('request cancellation interrupts a retry delay without another fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  let released = false;
  globalThis.fetch = async () => {
    calls += 1;
    setImmediate(() => controller.abort());
    return new Response(new ReadableStream({ cancel() { released = true; } }), { status: 503 });
  };
  await assert.rejects(client.proxyFetch('https://derpibooru.org/api/v1/json/images/1', { signal: controller.signal }),
    { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(released, true);
});

test('featured resources partition two account API keys and forum errors never become empty lists', async () => {
  assert.notEqual(catalogue.featuredImage.keyOf({ apiKey: 'key-a' }), catalogue.featuredImage.keyOf({ apiKey: 'key-b' }));
  /* The Rust backend's failure: a non-2xx `{"error":{code,message}}` — a typed ApiError, never rows. */
  globalThis.fetch = async () => json({ error: { code: 'UPSTREAM_FAILURE', message: 'upstream failure' } }, { status: 502 });
  await assert.rejects(catalogue.forumPosts.read({ page: 1 }), (error) =>
    error instanceof ApiError && error.kind === 'http' && error.status === 502 && error.serverMessage === 'upstream failure');
  await assert.rejects(admin.checkTagExists('fake-token', 'pony'), (error) =>
    error instanceof ApiError && error.code === 'UPSTREAM_FAILURE');
  /* Derpibooru answering 200 without its list is a malformed answer, not an empty one. */
  globalThis.fetch = async () => json({ error: 'upstream failure' });
  await assert.rejects(derpi.getImages(), (error) => error instanceof ApiError && error.kind === 'invalid');
});

test('Derpi profile uploads never reuse developer results after returning to safe mode', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    urls.push(target);
    assert.ok(target.pathname.endsWith('/search/images'));
    /* The uploader query sits inside the viewer's exclusions, like the feed's. */
    const q = target.searchParams.get('q');
    assert.ok(q.startsWith('(uploader_id:42)'), q);
    if (target.searchParams.get('filter_id') !== '56027') assert.match(q, /-explicit/);
    return derpiUploadsResponse(target);
  };
  const developer = { id: 42, page: 1, perPage: 24, contentFilter: 'developer' };
  const safe = { ...developer, contentFilter: 'safe' };

  values.set(LS_KEYS.contentFilter, 'developer');
  const developerKey = catalogue.derpiUserUploads.keyOf(developer);
  assert.deepEqual((await catalogue.derpiUserUploads.read(developer)).images.map((image) => image.id), [1, 2]);

  values.set(LS_KEYS.contentFilter, 'safe');
  assert.deepEqual((await catalogue.derpiUserUploads.read(safe)).images.map((image) => image.id), [1]);
  assert.equal(urls.length, 2, 'safe mode must make its own read while the developer answer is still cached');
  assert.equal(urls[0].searchParams.get('filter_id'), '56027');
  assert.equal(urls[1].searchParams.has('filter_id'), false);
  assert.equal(catalogue.derpiUserUploads.keyOf(developer), developerKey,
    'a resource key describes its arguments, independent of later localStorage changes');
  assert.deepEqual((await catalogue.derpiUserUploads.read(developer)).images.map((image) => image.id), [1, 2]);
  assert.equal(urls.length, 2, 'each content mode retains only its own cached answer');
});

test('Derpi upload requests retain their filter snapshot while the shared route policy is pending', async () => {
  const policyResponse = deferred();
  const imageUrls = [];
  globalThis.fetch = (url) => {
    const target = new URL(String(url), 'https://app.invalid');
    if (target.pathname === '/api/v1/routing-policy') return policyResponse.promise;
    if (target.pathname === '/api/v1/filters/block-tags') return Promise.resolve(json(blockFiltersEnvelope()));
    if (target.pathname === '/api/v1/image-blocklist') return Promise.resolve(json({ revision: 1, blocks: [], has_more: false }));
    assert.ok(target.pathname.endsWith('/search/images'));
    imageUrls.push(target);
    return Promise.resolve(derpiUploadsResponse(target));
  };
  const policy = route.refreshRoutePolicy();
  const safe = { id: 42, page: 1, perPage: 24, contentFilter: 'safe' };
  const developer = { ...safe, contentFilter: 'developer' };

  values.set(LS_KEYS.contentFilter, 'safe');
  const safeRead = catalogue.derpiUserUploads.read(safe);
  await tick();
  const requestsBeforePolicy = imageUrls.length;
  values.set(LS_KEYS.contentFilter, 'developer');
  const developerRead = catalogue.derpiUserUploads.read(developer);
  policyResponse.resolve(json({ policy: { api_policy: 'direct', media_policy: 'direct', third_party_url: null }, revision: 1 }));
  await policy;
  const [safeResult, developerResult] = await Promise.all([safeRead, developerRead]);

  assert.equal(requestsBeforePolicy, 0, 'both image requests must await the shared route policy');
  assert.deepEqual(safeResult.images.map((image) => image.id), [1],
    'changing localStorage during the policy wait cannot put developer content into a safe key');
  assert.deepEqual(developerResult.images.map((image) => image.id), [1, 2]);
  assert.equal(imageUrls.length, 2);
  await tick();
  assert.deepEqual(catalogue.derpiUserUploads.peek(safe).data.images.map((image) => image.id), [1]);
  assert.deepEqual(catalogue.derpiUserUploads.peek(developer).data.images.map((image) => image.id), [1, 2]);
});

test('every catalogue read forwards its AbortSignal through its real API adapter', async () => {
  const cases = [
    [catalogue.homeFeed, { page: 2, sort: 'score', fp: 'safe|-|d|-|' }],
    [catalogue.searchFeed, { query: 'pony', page: 1, sortDir: 'desc' }],
    [catalogue.featuredImage, { apiKey: 'fake-key' }],
    [catalogue.favePictures, { ids: [1] }], [catalogue.derpiFaves, { apiKey: 'fake-key', page: 1 }],
    [catalogue.forumPosts, { page: 1 }], [catalogue.forumThread, { id: '1', page: 1 }],
    [catalogue.userProfile, { id: '1' }], [catalogue.sharedFaveIds, { ownerId: 7 }],
    [catalogue.derpiUserProfile, { id: '1' }],
    [catalogue.derpiUserUploads, { id: 1, page: 1, perPage: 24, contentFilter: 'safe' }],
    [catalogue.siteComments, { imageId: 1 }], [catalogue.derpiComments, { imageId: 1, page: 1 }],
    [catalogue.translateSwitch, {}],
    [catalogue.userPosts, { id: '1', page: 1, token: null }], [catalogue.userComments, { id: '1', page: 1, token: null }],
    [catalogue.userUploads, { id: '1', page: 1, perPage: 1, token: 'fake' }],
    [catalogue.sessionUser, { token: 'fake' }], [catalogue.unreadCounts, { token: 'fake' }],
    [catalogue.faveIds, { token: 'fake' }], [catalogue.faveFolders, { token: 'fake' }],
    [catalogue.sharedPrivacyFaves, { token: 'fake', ownerId: 1 }], [catalogue.browsingHistory, { token: 'fake', page: 1 }],
    [catalogue.tasks, { token: 'fake' }], [catalogue.blockGroups, { token: 'fake' }],
    [catalogue.teamMembers, {}],
  ];
  for (const [resource, args] of cases) {
    /* The uploads grid reads the profile first; in the app that is the header's (seeded) read. */
    if (resource === catalogue.userUploads) {
      catalogue.userProfile.seed({ id: '1' }, { id: 1, username: 'pony', derpi_user_id: 7, settings: {} }, Date.now());
    }
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

test('reconnection retries a mounted cold failure and keeps its subscription', async () => {
  let online = false;
  let calls = 0;
  const resource = defineResource({ name: 'offline-regression', key: () => 'same', fetch: async () => {
    calls += 1;
    if (!online) throw new Error('offline');
    return 'online result';
  } });
  let notices = 0;
  const unsubscribe = resource.subscribe({}, () => { notices += 1; });
  await assert.rejects(resource.read({}), /offline/);
  await tick();
  online = true;
  expireAllResources();
  await tick();
  assert.equal(calls, 2);
  assert.equal(resource.peek({}).data, 'online result');
  assert.ok(notices >= 2);
  unsubscribe();
});

test('a repeated SSR seed cannot cancel a refresh or remove its displayed answer', async () => {
  const incoming = deferred();
  let signal;
  const resource = defineResource({ name: 'seed-refresh-regression', key: () => 'same', fetch: (_, current) => {
    signal = current;
    return incoming.promise;
  } });
  const at = Date.now() - 100;
  resource.seed({}, ['SSR'], at);
  const pending = resource.read({}, { force: true });
  resource.seed({}, ['SSR'], at);
  assert.equal(signal.aborted, false);
  assert.deepEqual(resource.peek({}).data, ['SSR']);
  incoming.resolve(['fresh']);
  assert.deepEqual(await pending, ['fresh']);
  await tick();
  assert.deepEqual(resource.peek({}).data, ['fresh']);
});

test('an old first SSR seed cannot replace a newer unseeded client refresh', async () => {
  const incoming = deferred();
  let signal;
  const resource = defineResource({ name: 'unseeded-refresh', key: () => 'same', fetch: (_, current) => {
    signal = current;
    return incoming.promise;
  } });
  resource.write({}, ['client']);
  await tick();
  const pending = resource.read({}, { force: true });
  resource.seed({}, ['stale SSR'], Date.now() - 60_000);
  assert.equal(signal.aborted, false);
  assert.deepEqual(resource.peek({}).data, ['client']);
  incoming.resolve(['refreshed']);
  assert.deepEqual(await pending, ['refreshed']);
});

test('failed resource entries respect their LRU limit', async () => {
  const resource = defineResource({ name: 'failed-lru', maxEntries: 2, key: ({ id }) => id,
    fetch: async () => { throw new Error('unavailable'); } });
  for (const id of ['a', 'b', 'c']) {
    await assert.rejects(resource.read({ id }));
    await tick();
  }
  assert.equal(resource.peek({ id: 'a' }).error, undefined);
  assert.equal(resource.peek({ id: 'c' }).error.message, 'unavailable');
});

test('relay rejects off-namespace targets and executable upstream documents', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('<script>bad()</script>', {
    headers: { 'Content-Type': 'text/html' },
  }); };
  for (const target of ['http://derpibooru.org/api/v1/json/images', 'https://evil.invalid/api/',
    'https://user:pass@derpibooru.org/api/', 'https://derpibooru.org:444/api/', 'https://derpibooru.org/']) {
    const response = await relay.GET(request(`https://app.invalid/relay?url=${encodeURIComponent(target)}`));
    assert.equal(response.status, 400, target);
  }
  assert.equal(calls, 0);
  const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages'));
  assert.equal(response.status, 502);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.text()).includes('<script>'), false);
});

test('relay passes an upstream client error through as its status, never its body', async () => {
  /* Derpibooru answers a deleted picture with a plain-text 404: an answer, not a dead line. */
  for (const [status, type, body] of [[404, 'text/plain', 'Not Found'], [404, 'text/html', '<script>bad()</script>'], [400, 'text/html', 'Bad']]) {
    globalThis.fetch = async () => new Response(body, { status, headers: { 'Content-Type': type } });
    const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages%2F1'));
    assert.equal(response.status, status, `${status} ${type}`);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const text = await response.text();
    assert.equal(text.includes(body), false, 'the upstream body is not served');
  }
  /* A server error in a non-JSON body is still a bad line, which `proxyFetch` fails over from. */
  globalThis.fetch = async () => new Response('<html>down</html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
  const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages'));
  assert.equal(response.status, 502);
});

test('relay strips session/framing headers, prohibits caches and follows request cancellation', async () => {
  let init;
  globalThis.fetch = async (_, options) => {
    init = options;
    return json({ images: [] }, { headers: { 'Set-Cookie': 'secret=1', 'Cache-Control': 'public, max-age=600',
      'CDN-Cache-Control': 'public', 'Content-Encoding': 'gzip', 'Connection': 'x-private-hop', 'x-private-hop': 'remove' } });
  };
  const controller = new AbortController();
  const response = await relay.GET(request('https://app.invalid/relay?url=https%3A%2F%2Fderpibooru.org%2Fapi%2Fv1%2Fjson%2Fimages', {
    signal: controller.signal, headers: { Accept: 'text/html' },
  }));
  assert.equal(init.headers.Accept, 'application/json');
  for (const header of ['set-cookie', 'content-encoding', 'cdn-cache-control', 'x-private-hop']) {
    assert.equal(response.headers.has(header), false, header);
  }
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Security-Policy'), /sandbox/);
  controller.abort();
  assert.equal(init.signal.aborted, true);
});

test('the /api/v1 proxy streams request bodies, keeps the session cookie over HTTP and rejects path escapes', async () => {
  let fetched;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    fetched = { url: String(url), init };
    return json({ token: 't', csrf_token: 'c', expires_in: 60 }, { headers: {
      'Set-Cookie': 'auth_bind=fake; Path=/; HttpOnly; SameSite=None; Secure',
      'Cache-Control': 'public, max-age=600' } });
  };
  for (const path of [['..'], ['../admin'], ['%2e%2e'], ['test\\admin']]) {
    const result = await v1.GET(request('https://app.invalid/api/v1/anything'), context(path));
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error.code, 'INVALID_PATH');
  }
  assert.equal(calls, 0);
  const controller = new AbortController();
  const incoming = request('http://app.invalid/api/v1/auth/login?x=1', { method: 'POST', body: 'payload',
    signal: controller.signal, headers: { Connection: 'x-request-hop', 'x-request-hop': 'remove' } });
  incoming.arrayBuffer = () => { throw new Error('request must not be buffered'); };
  const response = await v1.POST(incoming, context(['auth', 'login']));
  /* Re-streamed (not buffered) so the body's pace can be watched — review P1-F1. */
  assert.ok(fetched.init.body instanceof ReadableStream, 'the body is still a stream');
  assert.equal(fetched.init.duplex, 'half');
  assert.equal(await new Request(fetched.url, fetched.init).text(), 'payload');
  assert.equal(fetched.init.headers.has('x-request-hop'), false);
  /* The backend origin the server reads use (`lib/upstream.server.ts`, api.picpony.top by default). */
  assert.equal(fetched.url, `${upstreamOrigin()}/api/v1/auth/login?x=1`);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  /* Over plain HTTP the `Secure` flag would make the browser drop the session binding. */
  assert.equal(response.headers.get('Set-Cookie'), 'auth_bind=fake; Path=/; HttpOnly; SameSite=Lax');
  controller.abort();
  assert.equal(fetched.init.signal.aborted, true);
  const secure = await v1.GET(request('https://app.invalid/api/v1/me'), context(['me']));
  assert.match(secure.headers.get('Set-Cookie'), /Secure/);
});

test('blocked CacheStorage cannot break a successful static chunk request', async () => {
  const handlers = new Map();
  let fetches = 0;
  const runtime = {
    URL, Response,
    self: { location: new URL('https://app.invalid/sw.js?v=test'), addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { match: async () => { throw new DOMException('blocked', 'SecurityError'); },
      open: async () => { throw new DOMException('blocked', 'SecurityError'); } },
    fetch: async () => { fetches += 1; return new Response('chunk'); },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), runtime);
  let answer;
  const background = [];
  handlers.get('fetch')({ request: new Request('https://app.invalid/_next/static/chunks/test.js'),
    respondWith: (promise) => { answer = promise; }, waitUntil: (promise) => background.push(promise) });
  assert.equal(await (await answer).text(), 'chunk');
  await Promise.all(background);
  assert.equal(fetches, 1);
});

test('server memo coalesces in-flight calls at TTL zero and retries failed results', async () => {
  let calls = 0;
  let answer = deferred();
  const memo = createServerMemo({ ttlMs: 0, max: 2, keyOf: (id) => id,
    load: () => { calls += 1; return answer.promise; } });
  const a = memo('same');
  assert.equal(memo('same'), a);
  assert.equal(calls, 1);
  answer.resolve(null);
  assert.equal(await a, null);
  answer = deferred();
  const b = memo('same');
  assert.equal(calls, 2);
  answer.resolve({ user: 'only this key' });
  await b;
  answer = deferred();
  const c = memo('same');
  assert.equal(calls, 3, 'TTL zero disables resolved caching');
  answer.resolve(null);
  await c;
});

test('SSR reads have bounded anonymous requests and keys partition public profile results', async () => {
  const observed = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    observed.push({ parsed, init });
    if (parsed.pathname === '/api/v1/team-members') return json({ members: [], total: 0, total_pages: 0 });
    const profile = /^\/api\/v1\/users\/([^/]+)$/.exec(parsed.pathname);
    if (profile) {
      return json({ user: { id: Number(profile[1]), username: 'public', avatar: null, banner: null, role: 'user', bio: '',
        gender: '', race: '', experience: 0, level: 1, created_on: '2026-01-01T00:00:00Z', last_online: null,
        ip_location: '', visibility: { showUploads: true, showFaves: true, showPosts: true, showComments: true },
        badges: [], equipped_badges: [], upstream_identity: null } });
    }
    return json({ total: 0, images: [] });
  };
  const [crafted, a, b, team, feed] = await Promise.all([
    readUserProfile('12&action=other'), readUserProfile('12'), readUserProfile('13'), readTeamMembers(),
    readHomeFeed('invalid|a|d|p|blocked', 'score&q=explicit'),
  ]);
  /* An id that cannot be a profile's is the route's not-found state, and is never sent. */
  assert.equal(crafted, 'missing');
  assert.equal(observed.some(({ parsed }) => parsed.pathname.includes('&') || parsed.pathname.includes('%26')), false);
  assert.notEqual(a.key, b.key);
  assert.equal(a.data.id, 12);
  assert.equal(b.data.id, 13);
  assert.deepEqual(team.data, []);
  assert.deepEqual(feed.data.images, []);
  for (const { init } of observed) {
    assert.ok(init.signal instanceof AbortSignal);
    const headers = new Headers(init.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
  }
  const upstreamFeed = observed.find(({ parsed }) => parsed.pathname.endsWith('/search/images')).parsed;
  assert.equal(upstreamFeed.searchParams.get('sf'), 'created_at');
  assert.match(upstreamFeed.searchParams.get('q'), /-explicit/);
  assert.equal(upstreamFeed.searchParams.getAll('q').length, 1);
});

test('home SSR seeds bypass stale persistent responses while retaining bounded request coalescing', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const reads = [];
  let pending = deferred();
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/api/v1/filters/block-tags') return json(blockFiltersEnvelope());
    if (parsed.pathname === '/api/v1/image-blocklist') return json(publicBlacklistPage([]));
    reads.push({ parsed, init });
    // Next's stale-while-revalidate path returns an old payload immediately.
    // Only an uncached network read can truthfully receive a fresh seed timestamp.
    if (init.cache !== 'no-store') return json({ total: 1, images: [{ id: 1 }] });
    return pending.promise;
  };

  for (const [index, contentFilter] of ['safe', 'developer'].entries()) {
    const fp = `${contentFilter}|-|-|-|feed-freshness-regression`;
    const expectedId = 100 + index * 10;
    pending = deferred();
    const a = readHomeFeed(fp, 'created_at');
    const b = readHomeFeed(fp, 'created_at');
    await tick();
    pending.resolve(json({ total: 1, images: [{ id: expectedId }] }));
    const first = await a;
    assert.deepEqual(first.data.images.map((image) => image.id), [expectedId],
      'an expired persistent answer must never become a newly dated SSR seed');
    assert.equal(await b, first, 'concurrent renders share one network read');
    assert.equal(reads.length, index * 2 + 1);
    assert.equal(reads.at(-1).init.next?.revalidate, undefined);
    assert.equal(reads.at(-1).parsed.searchParams.get('filter_id'), contentFilter === 'developer' ? '56027' : null);

    now += 60_000;
    assert.equal(await readHomeFeed(fp, 'created_at'), first, 'prefetches reuse the bounded memo');
    assert.equal(reads.length, index * 2 + 1);
    now += 60_001;
    pending = deferred();
    const refresh = readHomeFeed(fp, 'created_at');
    await tick();
    pending.resolve(json({ total: 1, images: [{ id: expectedId + 1 }] }));
    const next = await refresh;
    assert.deepEqual(next.data.images.map((image) => image.id), [expectedId + 1]);
    assert.ok(next.generatedAt > first.generatedAt);
    assert.equal(reads.length, index * 2 + 2);
  }
});

test('resource SSR seeding is isolated and inline route policy escapes script terminators', () => {
  const resource = defineResource({ name: 'SSR-isolated', key: () => 'one', fetch: async () => 'client' });
  const browser = globalThis.window;
  delete globalThis.window;
  try {
    resource.seed({}, 'private SSR value', Date.now());
    assert.equal(resource.peek({}).data, undefined);
  } finally {
    globalThis.window = browser;
  }
  const policy = { api: 'third_party', image: 'direct', thirdPartyPassApiKey: false,
    thirdPartyUrl: '</script><script>window.stolen=true</script>' };
  const script = inlineRoutePolicyScript(policy);
  assert.equal(script.includes('</script>'), false);
  const result = { window: {} };
  vm.runInNewContext(script, result);
  assert.equal(result.window.stolen, undefined);
  assert.equal(result.window.__picponyRoutePolicy.thirdPartyUrl, policy.thirdPartyUrl);
});

test('third-party key forwarding honors policy and an older policy refresh cannot win', async () => {
  /* `GET /api/v1/routing-policy` carries no pass-the-key flag: from the public read the user's key
     is always stripped. An administrator's acknowledged save can still turn it on locally. */
  globalThis.fetch = async (url) => String(url).includes('/routing-policy')
    ? json({ policy: { api_policy: 'third_party', media_policy: 'direct', third_party_url: 'https://third-party.invalid' }, revision: 1 })
    : new Response('', { status: 503 });
  await route.refreshRoutePolicy();
  let target = new URL(route.buildApiLineUrl('https://derpibooru.org/api/v1/json/images?key=fake&key=duplicate', 'third_party'));
  assert.equal(target.origin, 'https://third-party.invalid');
  assert.equal(target.searchParams.has('key'), false);
  route.applySavedRoutePolicy({ global_api_third_party_pass_api_key: true });
  target = new URL(route.buildApiLineUrl('https://derpibooru.org/api/v1/json/images?key=fake&key=duplicate', 'third_party'));
  assert.equal(target.searchParams.has('key'), true);
  const first = deferred();
  const second = deferred();
  let calls = 0;
  globalThis.fetch = (url) => !String(url).includes('/routing-policy') ? Promise.resolve(new Response('', { status: 503 })) :
    ++calls === 1 ? first.promise : second.promise;
  const old = route.refreshRoutePolicy();
  const latest = route.refreshRoutePolicy();
  second.resolve(json({ policy: { api_policy: 'direct', media_policy: 'direct', third_party_url: null }, revision: 3 }));
  await latest;
  first.resolve(json({ policy: { api_policy: 'api_accel', media_policy: 'direct', third_party_url: null }, revision: 2 }));
  await old;
  assert.equal(route.apiPolicy(), 'direct');
});

test('a cancelled caller stops waiting for the shared policy without cancelling that policy', async () => {
  const incoming = deferred();
  let fetches = 0;
  globalThis.fetch = (url) => {
    fetches += 1;
    if (String(url).includes('/image-blocklist')) return Promise.resolve(json(publicBlacklistPage([])));
    return String(url).includes('/filters/block-tags') ? Promise.resolve(json(blockFiltersEnvelope())) : incoming.promise;
  };
  const policy = route.refreshRoutePolicy();
  const controller = new AbortController();
  const read = client.proxyFetch('https://derpibooru.org/api/v1/json/images/1', { signal: controller.signal });
  controller.abort();
  await assert.rejects(read, { name: 'AbortError' });
  assert.equal(fetches, 3, 'only the shared policy, public-filter and public-blacklist requests were sent');
  incoming.resolve(json({ success: true, global_api_route_policy: 'direct', global_image_route_policy: 'direct' }));
  await policy;
});

test('public block definitions read the backend’s five groups and affect every enabled filter', () => {
  const fixture = blockFiltersEnvelope();
  const flat = blockFilters.parseBlockFilters(fixture);
  assert.deepEqual(flat, blockFilters.DEFAULT_BLOCK_FILTERS);
  assert.deepEqual(blockFilters.parseBlockFilters({ ...fixture, filters: { ...fixture.filters, onlyPony: [] } }).onlyPony, [],
    'an empty group is an empty group');
  const settings = { contentFilter: 'safe', banAnthro: true, banDiscomfort: true, onlyPony: true, hiddenTags: [] };
  const built = decodeURIComponent(query.buildSearchQueryFrom(settings, 'pony OR zebra', flat));
  assert.ok(built.startsWith('(pony OR zebra), '));
  assert.match(built, /-nightmare\\ fuel/);
  assert.match(built, /-morbidly\\ obese/);
  assert.match(built, /\(pony OR kirin OR griffon OR hippogriff OR changeling OR zebra\)/);
  const disabled = decodeURIComponent(query.buildSearchQueryFrom({ ...settings, contentFilter: 'developer',
    banAnthro: false, banDiscomfort: false, onlyPony: false }, undefined, flat));
  assert.equal(disabled, '*');
  assert.equal(blockFilters.parseBlockFilters({ error: { code: 'DATABASE_UNAVAILABLE', message: 'x' } }), null);
  assert.equal(blockFilters.parseBlockFilters({ filters: { safe: [] } }), null, 'a group missing is not an answer');
});

test('rule installation changes resource keys and publishes settings once per semantic change', () => {
  const original = catalogue.browsingFingerprint();
  assert.equal(original, query.DEFAULT_BROWSING_FINGERPRINT);
  const changed = { ...blockFilters.DEFAULT_BLOCK_FILTERS, safe: [...blockFilters.DEFAULT_BLOCK_FILTERS.safe, 'new blocked tag'] };
  events.length = 0;
  blockFilters.installBlockFilters(changed);
  assert.notEqual(catalogue.browsingFingerprint(), original);
  assert.deepEqual(events, ['settings_updated']);
  blockFilters.installBlockFilters({ ...changed, safe: [...changed.safe].reverse() });
  assert.deepEqual(events, ['settings_updated']);
  const browser = globalThis.window;
  delete globalThis.window;
  try {
    blockFilters.installBlockFilters(changed);
    assert.equal(blockFilters.currentBlockFilters(), blockFilters.DEFAULT_BLOCK_FILTERS);
  } finally { globalThis.window = browser; }
});

test('SSR waits for public rules before querying pictures and produces the same key as the browser', async () => {
  clearBlockFiltersMemo();
  clearPublicBlacklistMemo();
  const rules = deferred();
  const fixture = blockFiltersEnvelope();
  fixture.tags.push({ id: 999, filter: 'safe', tag: 'freshly blocked' });
  fixture.filters.safe.push('freshly blocked');
  let ruleCalls = 0;
  let imageCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/filters/block-tags')) {
      ruleCalls += 1;
      assert.deepEqual(init.next.tags, [BLOCK_FILTERS_CACHE_TAG]);
      return rules.promise;
    }
    if (String(url).includes('/image-blocklist')) return json(publicBlacklistPage([3898802, 193324]));
    imageCalls += 1;
    const target = new URL(String(url));
    assert.match(decodeURIComponent(target.searchParams.get('q') ?? ''), /-freshly\\ blocked/);
    /* The public blacklist is excluded in the query itself, on the server as in the browser. */
    assert.match(decodeURIComponent(target.searchParams.get('q') ?? ''), /-id:193324, -id:3898802/);
    return json({ total: 0, images: [] });
  };
  const feed = readHomeFeed('safe|-|d|-|', 'created_at');
  const sameRules = readBlockFilters();
  await tick();
  assert.equal(ruleCalls, 1, 'layout and feed share their public definition request');
  assert.equal(imageCalls, 0);
  rules.resolve(json(fixture));
  const [seed, current] = await Promise.all([feed, sameRules]);
  assert.ok(seed, `feed seed missing; ruleCalls=${ruleCalls}, imageCalls=${imageCalls}`);
  blockFilters.installBlockFilters(current);
  blockFilters.installPublicBlacklist([193324, 3898802]);
  const fp = catalogue.browsingFingerprint();
  assert.equal(seed.fp, fp);
  assert.equal(seed.key, catalogue.homeFeed.keyOf({ page: 1, sort: 'created_at', fp }));
  assert.equal(imageCalls, 1);
});

test('failed public rules preserve the known safe fallback and a failed maintenance read cannot discard valid rules', async () => {
  clearBlockFiltersMemo();
  globalThis.fetch = async () => new Response('<html>offline</html>', { status: 503 });
  assert.equal(await readBlockFilters(), blockFilters.DEFAULT_BLOCK_FILTERS);
  /* The browser's read of the same definitions. */
  const { filters } = blockFiltersEnvelope();
  filters.safe.push('still loaded');
  globalThis.fetch = async (url) => String(url).includes('/filters/block-tags') ? json({ tags: [], filters }) : new Response('<html>broken policy</html>');
  await route.refreshRoutePolicy();
  assert.ok(blockFilters.currentBlockFilters().safe.includes('still loaded'));
});

test('only accepted block-tag mutations expire both Next tags and the process memo', async () => {
  let invalidations = 0;
  let memoClears = 0;
  const source = readFileSync(new URL('../app/api/v1/[...path]/route.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let body = { tag: 'pony' };
  let status = 200;
  const exports = {};
  let blacklistInvalidations = 0;
  const dependencies = {
    'next/cache': { revalidateTag: (tag, profile) => {
      assert.equal(profile.expire, 0);
      if (tag === 'picpony-public-blacklist') { blacklistInvalidations += 1; return; }
      assert.equal(tag, BLOCK_FILTERS_CACHE_TAG);
      invalidations += 1;
    } },
    '@/lib/blockFilters.server': {
      BLOCK_FILTERS_CACHE_TAG, PUBLIC_BLACKLIST_CACHE_TAG: 'picpony-public-blacklist',
      clearBlockFiltersMemo: () => { memoClears += 1; }, clearPublicBlacklistMemo: () => {},
    },
    '@/lib/constants': { COOKIE_KEYS, SITE_STATUS_CACHE_TAG: 'site-status' },
    '@/lib/upstream.server': { upstreamOrigin: () => 'https://picpony.top' },
    '@/lib/proxyHeaders': await import('../lib/proxyHeaders.ts'),
  };
  vm.runInNewContext(transpiled, { exports, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, process: { env: {} }, Response, Headers, URL, AbortSignal, fetch: async () => json(body, { status }) });
  const refused = { error: { code: 'FORBIDDEN', message: 'no' } };
  for (const [method, path, answer, httpStatus, expected] of [
    ['POST', ['admin', 'filters', 'block-tags'], refused, 403, 0],
    ['POST', ['admin', 'filters', 'block-tags'], refused, 400, 0],
    ['GET', ['admin', 'filters', 'block-tags'], { tags: [] }, 200, 0],
    ['PATCH', ['admin', 'users', '5'], { user: {} }, 200, 0],
    ['POST', ['admin', 'filters', 'block-tags'], { tag: 'pony' }, 200, 1],
    ['DELETE', ['admin', 'filters', 'block-tags', '12'], null, 200, 2],
  ]) {
    body = answer;
    status = httpStatus;
    const response = await exports[method](request(`https://app.invalid/api/v1/${path.join('/')}`, { method }), context(path));
    assert.deepEqual(await response.json(), answer, 'the original response body remains available');
    assert.equal(invalidations, expected);
    assert.equal(memoClears, expected);
  }
  body = null;
  status = 200;
  await exports.PUT(request('https://app.invalid/api/v1/admin/image-blocklist/9', { method: 'PUT' }), context(['admin', 'image-blocklist', '9']));
  await exports.DELETE(request('https://app.invalid/api/v1/admin/image-blocklist/9', { method: 'DELETE' }), context(['admin', 'image-blocklist', '9']));
  assert.equal(blacklistInvalidations, 2, 'an accepted blacklist edit expires the public blacklist');
  assert.equal(invalidations, 2, 'and leaves the filter definitions alone');
});

test('the /api/v1 proxy forwards only the cookies the backend reads', async () => {
  let forwarded;
  globalThis.fetch = async (_, init) => { forwarded = init.headers.get('cookie'); return json({ user: {} }); };
  const cookie = `${COOKIE_KEYS.browsing}=safe%7C-%7Cd%7C-%7Csolo; auth_bind=abc; ${COOKIE_KEYS.darkMode}=true; other=1`;
  await v1.GET(request('https://app.invalid/api/v1/me', { headers: { Cookie: cookie } }), context(['me']));
  assert.equal(forwarded, 'auth_bind=abc; other=1');
  await v1.GET(request('https://app.invalid/api/v1/me', { headers: { Cookie: `${COOKIE_KEYS.palette}=luna` } }), context(['me']));
  assert.equal(forwarded, null, 'nothing is sent when only app cookies were present');
});

test('clearing server filters during an in-flight read cannot restore the old rule generation', async () => {
  clearBlockFiltersMemo();
  const old = deferred();
  const fresh = blockFiltersEnvelope();
  fresh.filters.safe.push('after write');
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? old.promise : json(fresh);
  const pending = readBlockFilters();
  clearBlockFiltersMemo();
  old.resolve(json(blockFiltersEnvelope()));
  assert.ok((await pending).safe.includes('after write'));
  assert.equal(calls, 2);
});

test('OtherTab refreshes real statistics and saves text without changing maintenance mode', async () => {
  let state;
  let statusValue = { maintenanceMode: true, maintenanceMessage: 'old text' };
  let translationValue = { translate_enabled: true, image_translation_provider: 'extension', queue: { pending: 1, translating: 0, completed: 5, failed: 2 } };
  let statusError;
  let statsError = 'statistics unavailable';
  const maintenanceWrites = [];
  let statsRefreshes = 0;
  let statusRefreshes = 0;
  const translateWrites = [];
  const publishedStatus = [];
  let acceptTranslation = false;
  let patched;
  const toasts = [];
  const element = (type, props) => ({ type, props: props ?? {} });
  const componentStub = (name) => ({ default: name });
  const dependencies = {
    'react': { useState: () => [state ?? null, (value) => { state = value; }] },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    '@/components/Toast': { showToast: (...args) => toasts.push(args) },
    '@/components/ToggleSwitch': componentStub('ToggleSwitch'),
    '@/components/Button': componentStub('Button'), '@/components/Card': componentStub('Card'),
    '@/components/SectionHeading': componentStub('SectionHeading'),
    '@/components/ErrorRetry': componentStub('ErrorRetry'), '@/components/Skeleton': componentStub('Skeleton'),
    '@/components/Input': { Textarea: 'Textarea' }, '@/lib/icons': { ICON: {} },
    '@/lib/format': { formatCount: String, formatDateTime: String },
    '@/lib/resources': { translateSwitch: { write: (_args, value) => { translateWrites.push(value); } } },
    '@/lib/siteStatus': { publishSavedSiteStatus: (value) => { publishedStatus.push(value); } },
    '@/lib/api/adminSiteTools': { collectSiteStats: async () => ({ images: 1, tags: 2, comments: 3 }) },
    'react-icons/md': {},
    '@/components/ConfirmDialog': { useConfirm: () => ({ confirmThen: (_a, _b, run) => run(), confirmDialog: null }) },
    '@/lib/api/admin': {
      /* The `/api/v1` adapters answer the backend's DTO and throw on a refusal. */
      adminToggleMaintenance: async (_token, values) => { maintenanceWrites.push(values); return {}; },
      adminToggleTranslate: async () => { if (!acceptTranslation) throw new Error('拒绝'); return { already_applied: false }; },
    },
    './SectionHeader': componentStub('SectionHeader'),
    './RefreshButton': componentStub('RefreshButton'),
    './sharedQueries': {
      siteStatusQuery: { name: 'site-status', write: (_token, value) => { patched = typeof value === 'function' ? value(statusValue) : value; statusValue = patched; } },
      translationQuery: { name: 'translation', peek: () => ({ data: translationValue }), write: (_token, value) => { translationValue = typeof value === 'function' ? value(translationValue) : value; } },
    },
    './queries': {
      defineAdminQuery: (name) => ({ name, write: () => {} }),
      adminData: (_, value) => value,
      retryError: (title, message) => ({ title, message: message && message !== title ? message : undefined }),
      useAdminQuery: (resource) => resource.name === 'translation' ? {
        data: translationValue, error: translationValue ? undefined : 'not loaded', loading: false, refreshing: false, retryable: true, refresh: () => {},
      } : resource.name === 'site-status' ? {
        data: statusValue, error: statusError, loading: false, refreshing: false, retryable: true, refresh: () => {
          assert.ok(patched, 'the accepted write must be patched before refresh');
          statusRefreshes += 1;
        },
      } : { data: undefined, error: statsError, loading: false, refreshing: false, retryable: true, refresh: () => { statsRefreshes += 1; } },
    },
    './useAdminMutation': { useAdminMutation: () => ({ busy: false, run: async (request, success, _failure, options) => {
      let data;
      try { data = (await request(() => true)) ?? {}; } catch { return; }
      options?.onCommitted?.(data);
      success(data);
    } }) },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../components/admin/OtherTab.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  /* Every prop that can hold an element — `children`, a heading's `actions`. */
  function find(node, check) {
    if (Array.isArray(node)) return node.flatMap((child) => find(child, check));
    if (!node || typeof node !== 'object') return [];
    return [...(check(node) ? [node] : []), ...Object.values(node.props ?? {}).flatMap((value) => find(value, check))];
  }
  let tree = exports.default({ token: 'fake' });
  const switches = find(tree, (node) => node.type === 'ToggleSwitch');
  assert.equal(switches.length, 2);
  assert.ok(switches.every((node) => node.props.disabled === false), 'statistics failure cannot disable loaded status controls');
  assert.ok(JSON.stringify(tree).includes('翻译队列：排队 1 · 翻译中 0 · 已完成 5 · 失败 2'), 'the queue is shown from GET /admin/translation');
  const textarea = find(tree, (node) => node.type === 'Textarea')[0];
  textarea.props.onChange({ target: { value: 'saved independently' } });
  tree = exports.default({ token: 'fake' });
  const save = find(tree, (node) => node.type === 'Button' && node.props.children === '保存提示文字')[0];
  save.props.onClick();
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maintenanceWrites.length, 1);
  assert.equal(maintenanceWrites[0].maintenance_mode, true);
  assert.equal(maintenanceWrites[0].maintenance_message, 'saved independently');
  assert.equal(patched.maintenanceMessage, 'saved independently');
  assert.equal(publishedStatus.length, 1);
  assert.equal(publishedStatus[0].maintenance, true);
  assert.equal(statusRefreshes, 1);
  assert.equal(toasts.at(-1)[0], '已保存维护提示');
  statsError = undefined;
  tree = exports.default({ token: 'fake' });
  const refresh = find(tree, (node) => node.type === 'RefreshButton' && node.props.label === '刷新统计')[0];
  refresh.props.onClick();
  assert.equal(statsRefreshes, 1);
  find(tree, (node) => node.type === 'ToggleSwitch')[1].props.onChange(false);
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(translateWrites.length, 0, 'a translate write the backend has not accepted publishes nothing');
  acceptTranslation = true;
  find(tree, (node) => node.type === 'ToggleSwitch')[1].props.onChange(false);
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(translateWrites, [false], 'an acknowledged change reaches mounted image details at once');
  assert.equal(translationValue.translate_enabled, false, 'and the console\'s own read is corrected in place');
  assert.equal(translationValue.queue.failed, 2);
  statusValue = undefined;
  translationValue = undefined;
  statusError = 'not loaded';
  tree = exports.default({ token: 'fake' });
  assert.equal(find(tree, (node) => node.type === 'ToggleSwitch').length, 0,
    'an unknown site state shows no switch at all — never a default value that later flips');
  assert.equal(find(tree, (node) => node.type === 'Button' && node.props.children === '保存提示文字').length, 0);
});

/* Review P1-F17: a typed tag search is literal, a long count list is batched, and an existing
   glossary entry past the fuzzy search's first page is still found. */
test('tag search escapes query syntax, tag counts batch past 50, and an exact entry on page 2 exists', async () => {
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    if (url.includes('/api/v1/dictionary/tags')) {
      const params = new URL(url, 'https://app.invalid').searchParams;
      const page = Number(params.get('page'));
      const tags = page === 1
        ? Array.from({ length: Number(params.get('limit')) }, (_, i) => ({ en: `pony ${i}` }))
        : [{ en: 'Pony' }];
      return json({ tags, total: tags.length });
    }
    if (url.includes('search/tags')) {
      const inner = url.includes('url=') ? new URL(url, 'https://app.invalid').searchParams.get('url') : url;
      const q = new URL(inner).searchParams.get('q') ?? '';
      const names = [...q.matchAll(/name:(\S+)/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
      return json({ tags: names.map((name) => ({ name, images: 1 })), total: names.length });
    }
    return json({});
  };
  await derpi.searchDerpiTags('oc (pony) artist:foo');
  const search = seen.find((url) => url.includes('search/tags'));
  const inner = search.includes('url=') ? new URL(search, 'https://app.invalid').searchParams.get('url') : search;
  assert.equal(new URL(inner).searchParams.get('q'), 'name:*oc* *\\(pony\\)* *artist\\:foo*');

  seen.length = 0;
  const many = Array.from({ length: 120 }, (_, i) => `tag${i}`);
  const counts = await derpi.getDerpiTagCounts(many);
  assert.equal(seen.filter((url) => url.includes('search/tags')).length, 3, '120 names are three requests of ≤ 50');
  assert.equal(Object.keys(counts).length, 120, 'no name past the 50th is lost');

  seen.length = 0;
  assert.equal(await admin.checkTagExists('fixture', 'pony'), true, 'the exact entry on page 2 is found');
  assert.equal(seen.filter((url) => url.includes('/api/v1/dictionary/tags')).length, 2);
  seen.length = 0;
  assert.equal(await admin.checkTagExists('fixture', 'absent'), false);
  assert.equal(seen.filter((url) => url.includes('/api/v1/dictionary/tags')).length, 2, 'a short page ends the search');
});
