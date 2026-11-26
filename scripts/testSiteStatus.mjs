/** Accepted site-status mutations: real proxy code, public snapshots and stale-read fences. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerHooks } from 'node:module';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testSiteStatus');
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalStorage = globalThis.localStorage;
const invalidations = [];
globalThis.__siteStatusTestInvalidate = (tag, profile) => invalidations.push({ tag, profile });
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/cache') return { url: 'data:text/javascript,export function revalidateTag(tag,profile){globalThis.__siteStatusTestInvalidate(tag,profile)}', shortCircuit: true };
  if (specifier === 'next/headers') return { url: 'data:text/javascript,export async function cookies(){return {get(){return undefined}}}', shortCircuit: true };
  return next(specifier, context);
} });
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,String(value)), removeItem: key => values.delete(key) };
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, requestAnimationFrame: (cb) => setTimeout(cb, 0) };
let cookie = '';
globalThis.document = {
  get cookie(){return cookie},
  set cookie(value){cookie=value},
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
};
after(() => {
  globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  globalThis.document = originalDocument; globalThis.localStorage = originalStorage;
  delete globalThis.__siteStatusTestInvalidate;
});

const { PUT, POST, GET, HEAD } = await import('../app/api/v1/[...path]/route.ts');
const { SITE_STATUS_CACHE_TAG } = await import('../lib/constants.ts');
const { BLOCK_FILTERS_CACHE_TAG, PUBLIC_BLACKLIST_CACHE_TAG, readBlockFilters, readPublicBlacklist } = await import('../lib/blockFilters.server.ts');
const { readSiteBootstrap } = await import('../lib/bootstrap.server.ts');
const { readRoutePolicyOnce } = await import('../lib/imageLine.server.ts');
const { isPublicCacheControl, mergeVary, canForwardPublicCache, resolveProxyCacheControl } = await import('../lib/proxyHeaders.ts');
const state = await import('../lib/siteStatus.ts');
const route = await import('../lib/route.ts');
const { readRoutePolicy } = await import('../lib/route.server.ts');
const { readMaintenance } = await import('../lib/maintenance.server.ts');

/** A request to the same-origin `/api/v1` proxy, as Next hands it to the route handler. */
function request(resource, method='PUT', headers={}) {
  const req = new Request(`https://app.invalid/api/v1${resource}`, {
    method, headers: { Authorization:'Bearer fixture-status', 'content-type':'application/json', ...headers },
    ...(method !== 'GET' ? { body: JSON.stringify({ enabled: true }), duplex: 'half' } : {}),
  });
  Object.defineProperty(req,'nextUrl',{value:new URL(req.url)});
  return req;
}
const params = (resource) => ({ params: Promise.resolve({ path: resource.slice(1).split('/') }) });

test('all accepted status writes expire the shared server tag without consuming the forwarded answer', async () => {
  const resources = ['/admin/routing-policy','/admin/api-route-policy','/admin/image-route-policy','/admin/maintenance',
    '/admin/translation','/admin/semantic-search','/admin/semantic-cloud'];
  for (const resource of resources) {
    invalidations.length = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).pathname, `/api/v1${resource}`);
      assert.equal(init.method,'PUT');
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-status');
      return Response.json({revision:2});
    };
    const res = await PUT(request(resource), params(resource));
    assert.deepEqual(await res.json(),{revision:2});
    assert.deepEqual(invalidations,[{tag:SITE_STATUS_CACHE_TAG,profile:{expire:0}}], resource);
  }
});

test('refusals, failed HTTP, GET and unrelated writes do not invalidate status', async () => {
  const cases = [
    ['/admin/maintenance','PUT',409,JSON.stringify({error:{code:'REVISION_CONFLICT',message:'x'}})],
    ['/admin/maintenance','PUT',503,'<html>failure</html>'],
    ['/admin/maintenance','GET',200,JSON.stringify({maintenance_mode:false,maintenance_message:''})],
    ['/me/email','PUT',200,JSON.stringify({})],
  ];
  for (const [resource,method,status,body] of cases) {
    invalidations.length=0;
    globalThis.fetch=async()=>new Response(body,{status,headers:{'content-type':'application/json'}});
    await (method==='GET'?GET:PUT)(request(resource,method),params(resource));
    assert.deepEqual(invalidations,[],`${method} ${resource} ${status}`);
  }
});

test('the proxy forwards the visitor address it was handed, validated, never as the client wrote it', async () => {
  const seen=[];
  globalThis.fetch=async(url,init)=>{seen.push(new Headers(init.headers));return new Response(null,{status:204});};
  const resource='/site-visits';
  await POST(request(resource,'POST',{'x-forwarded-for':'evil, 203.0.113.9','x-real-ip':'198.51.100.7'}),params(resource));
  await POST(request(resource,'POST',{'x-forwarded-for':'2001:db8::1'}),params(resource));
  await POST(request(resource,'POST',{'x-forwarded-for':'not-an-ip','x-real-ip':'also bad'}),params(resource));
  assert.equal(seen[0].get('x-real-ip'),'198.51.100.7');
  assert.equal(seen[0].get('x-forwarded-for'),'203.0.113.9, 198.51.100.7','a non-address entry is dropped, the client appended');
  assert.equal(seen[1].get('x-real-ip'),'2001:db8::1','the nearest hop when no proxy named the client');
  assert.equal(seen[1].get('x-forwarded-for'),'2001:db8::1');
  assert.equal(seen[2].get('x-real-ip'),null);
  assert.equal(seen[2].get('x-forwarded-for'),null,'nothing known: nothing forwarded');
});

test('the server reads the Rust status resources: route policy and maintenance, both tagged', async () => {
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    const {pathname}=new URL(url);
    if(pathname==='/api/v1/routing-policy'){calls.push(init);return Response.json({policy:{api_policy:'third_party',media_policy:'cdn',third_party_url:'https://relay.example.test',third_party_pass_api_key:true},revision:3});}
    if(pathname==='/api/v1/maintenance-status'){calls.push(init);return Response.json({maintenance_mode:true,maintenance_message:' 暂停更新 '});}
    /* The block-filter and blacklist reads belong to lib/blockFilters.server.ts. */
    return new Response('not in this fixture',{status:503});
  };
  const policy=await readRoutePolicy();
  assert.equal(policy.api,'third_party');assert.equal(policy.image,'cdn');assert.equal(policy.thirdPartyUrl,'https://relay.example.test');
  assert.equal(policy.thirdPartyPassApiKey,true,'the pass-key flag is the routing policy\'s own field');
  assert.deepEqual(await readMaintenance(),{active:true,message:'暂停更新'});
  assert.equal(calls.length,2);
  for(const init of calls)assert.deepEqual(init.next.tags,[SITE_STATUS_CACHE_TAG]);
});

test('`auto` is a policy of its own, not `direct`', async () => {
  globalThis.fetch=async(url)=>new URL(url).pathname==='/api/v1/routing-policy'
    ? Response.json({policy:{api_policy:'auto',media_policy:'auto',third_party_url:null,third_party_pass_api_key:false},revision:1})
    : new Response('not in this fixture',{status:503});
  const policy=await readRoutePolicy();
  assert.equal(policy.api,'auto');assert.equal(policy.image,'auto');assert.equal(policy.thirdPartyPassApiKey,false);
  assert.deepEqual(route.routePolicyFromWire({policy:{api_policy:'auto',media_policy:'picpony',third_party_url:null,third_party_pass_api_key:false},revision:1}),
    {global_api_route_policy:'auto',global_image_route_policy:'picpony',global_api_third_party_url:'',global_api_third_party_pass_api_key:false});
});

test('maintenance fails open when the status cannot be read', async () => {
  globalThis.fetch=async()=>Response.json({error:{code:'DATABASE_UNAVAILABLE',message:'数据库暂时不可用'}},{status:503});
  assert.deepEqual(await readMaintenance(),{active:false,message:''});
});

test('a confirmed public patch whitelists data, skips unchanged acknowledgements and never affects the server snapshot', () => {
  let notified=0;const stop=state.subscribeSavedSiteStatus(()=>notified++);
  state.publishSavedSiteStatus({maintenance:true,semantic:{availability:'on',timeoutMs:18000,api_key:'private'},provider:'private'});
  assert.deepEqual(state.getSavedSiteStatus(),{maintenance:true,semantic:{availability:'on',timeoutMs:18000}});
  assert.deepEqual(state.getServerSiteStatus(),{});
  state.publishSavedSiteStatus({maintenance:true});
  assert.equal(notified,1,'an unchanged acknowledgement does not rerender');
  state.publishSavedSiteStatus({maintenance:false,semantic:{availability:'off'}});
  assert.equal(state.getSavedSiteStatus().maintenance,false);
  assert.equal(state.getSavedSiteStatus().semantic.availability,'off');
  assert.equal(notified,2);
  stop();
});

test('a route save preserves the other inline axis and defeats an old in-flight policy read', async () => {
  window.__picponyRoutePolicy={api:'third_party',image:'cdn',thirdPartyUrl:'https://example.test',thirdPartyPassApiKey:false};
  let reads=0;
  globalThis.fetch=async()=>{reads++;throw new Error('no request expected')};
  route.applySavedRoutePolicy({global_api_route_policy:'direct'});
  await route.ensureRoutePolicy();
  assert.equal(route.apiPolicy(),'direct');assert.equal(route.imagePolicy(),'cdn');assert.equal(reads,0);
  let release;
  globalThis.fetch=async(url)=>{
    if(String(url).includes('/api/v1/routing-policy'))return new Promise(resolve=>{release=resolve});
    return Response.json({filters:{},tags:[],blocks:[],has_more:false,revision:1});
  };
  const older=route.refreshRoutePolicy();
  for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(release);
  route.applySavedRoutePolicy({global_image_route_policy:'picpony'});
  release(Response.json({policy:{api_policy:'api_accel',media_policy:'direct',third_party_url:null},revision:2}));
  await older;
  assert.equal(route.apiPolicy(),'direct');assert.equal(route.imagePolicy(),'picpony');
  assert.match(cookie,/picpony/);
});

test('proxy cache-control pass-through enforces all five security boundaries and 304 empty body', async () => {
  assert.equal(isPublicCacheControl('public, max-age=31536000, immutable'), true);
  assert.equal(isPublicCacheControl('PUBLIC, s-maxage=60'), true);
  assert.equal(isPublicCacheControl('public, private, max-age=60'), false);
  assert.equal(isPublicCacheControl('public, no-store'), false);
  assert.equal(isPublicCacheControl('max-age=300'), false);
  assert.equal(isPublicCacheControl('publicly=1'), false);
  assert.equal(mergeVary('Accept-Encoding', 'Authorization', 'Cookie'), 'Accept-Encoding, Authorization, Cookie');
  assert.equal(mergeVary('cookie, Accept-Encoding', 'Authorization', 'Cookie'), 'cookie, Accept-Encoding, Authorization');
  assert.equal(mergeVary('*', 'Authorization', 'Cookie'), '*');
  assert.equal(canForwardPublicCache({ method: 'GET', hasAuthorization: false, hasBackendCookie: false, hasSetCookie: false, upstreamStatus: 200, upstreamCacheControl: 'public, max-age=60' }), true);
  assert.equal(canForwardPublicCache({ method: 'POST', hasAuthorization: false, hasBackendCookie: false, hasSetCookie: false, upstreamStatus: 200, upstreamCacheControl: 'public, max-age=60' }), false);

  const anonReq = (resource, method = 'GET', headers = {}) => {
    const req = new Request(`https://app.invalid/api/v1${resource}`, {
      method,
      headers,
      ...(method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify({}), duplex: 'half' } : {}),
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    return req;
  };

  // 1. Anonymous GET 200 with public Cache-Control + ETag + Last-Modified passes through with Vary.
  let forwardedHeaders = null;
  globalThis.fetch = async (_url, init) => {
    forwardedHeaders = new Headers(init.headers);
    return new Response('img-bytes', {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: '"abc123"',
        'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
      },
    });
  };
  const pubRes = await GET(
    anonReq('/mascots/images/' + 'a'.repeat(64), 'GET', {
      cookie: 'palette=luna; darkMode=true',
      'if-none-match': '"old"',
      'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
    }),
    params('/mascots/images/' + 'a'.repeat(64)),
  );
  assert.equal(forwardedHeaders.get('if-none-match'), '"old"');
  assert.equal(forwardedHeaders.get('if-modified-since'), 'Wed, 21 Oct 2015 07:28:00 GMT');
  assert.equal(forwardedHeaders.get('cookie'), null, 'app-only cookies stripped before upstream');
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(pubRes.headers.get('etag'), '"abc123"');
  assert.equal(pubRes.headers.get('last-modified'), 'Wed, 21 Oct 2015 07:28:00 GMT');
  assert.equal(pubRes.headers.get('vary'), 'Authorization, Cookie');

  // 2. Anonymous GET 304 returns a null body and keeps ETag + public Cache-Control.
  globalThis.fetch = async () => new Response(null, {
    status: 304,
    headers: {
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      etag: 'W/"10-20-30"',
    },
  });
  const notMod = await GET(
    anonReq('/ponies/assets/yunbao/stand.gif', 'GET', { 'if-none-match': 'W/"10-20-30"' }),
    params('/ponies/assets/yunbao/stand.gif'),
  );
  assert.equal(notMod.status, 304);
  assert.equal(notMod.body, null);
  assert.equal(notMod.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800');
  assert.equal(notMod.headers.get('etag'), 'W/"10-20-30"');

  // 3. HEAD 200 public passes through.
  globalThis.fetch = async () => new Response(null, {
    status: 200,
    headers: { 'cache-control': 'public, max-age=60', etag: '"head"' },
  });
  const headRes = await HEAD(anonReq('/bootstrap', 'HEAD'), params('/bootstrap'));
  assert.equal(headRes.headers.get('cache-control'), 'public, max-age=60');

  // 4. Signed-in cookie-only GET (e.g. same-origin `<img>` carrying `auth_bind`, no Authorization)
  //    downgrades `public` to `private` and strips `s-maxage` so the browser caches public assets
  //    while shared proxies/CDNs never store a cookie-bearing response.
  assert.equal(
    resolveProxyCacheControl({
      method: 'GET',
      hasAuthorization: false,
      hasBackendCookie: true,
      hasSetCookie: false,
      upstreamStatus: 200,
      upstreamCacheControl: 'public, s-maxage=300, max-age=31536000, immutable',
    }),
    'private, max-age=31536000, immutable',
  );
  globalThis.fetch = async () => new Response('avatar-bytes', {
    status: 200,
    headers: { 'cache-control': 'public, s-maxage=300, max-age=31536000, immutable', etag: '"av1"' },
  });
  const cookieImgRes = await GET(
    anonReq('/media/' + 'b'.repeat(64), 'GET', { cookie: 'auth_bind=secret; darkMode=true' }),
    params('/media/' + 'b'.repeat(64)),
  );
  assert.equal(cookieImgRes.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(cookieImgRes.headers.get('vary'), 'Authorization, Cookie');

  // 5. Negative security boundaries MUST force `private, no-store`:
  const denyCases = [
    ['Authorization header', 'GET', { authorization: 'Bearer tok' }, 200, { 'cache-control': 'public, max-age=60' }],
    ['Authorization + auth_bind', 'GET', { authorization: 'Bearer tok', cookie: 'auth_bind=secret' }, 200, { 'cache-control': 'public, max-age=60' }],
    ['upstream Set-Cookie', 'GET', {}, 200, { 'cache-control': 'public, max-age=60', 'set-cookie': 'auth_bind=x; Path=/; HttpOnly' }],
    ['POST method', 'POST', {}, 200, { 'cache-control': 'public, max-age=60' }],
    ['upstream private', 'GET', {}, 200, { 'cache-control': 'private, max-age=60' }],
    ['upstream public+no-store', 'GET', {}, 200, { 'cache-control': 'public, no-store' }],
    ['upstream missing Cache-Control', 'GET', {}, 200, {}],
    ['non-200/304 status 404', 'GET', {}, 404, { 'cache-control': 'public, max-age=60' }],
  ];
  for (const [label, method, reqHeaders, status, resHeaders] of denyCases) {
    globalThis.fetch = async () => new Response(status === 304 ? null : 'ok', { status, headers: resHeaders });
    const handler = method === 'POST' ? POST : GET;
    const res = await handler(anonReq('/media/' + 'b'.repeat(64), method, reqHeaders), params('/media/' + 'b'.repeat(64)));
    assert.equal(res.headers.get('cache-control'), 'private, no-store', label);
  }
});

test('readSiteBootstrap consolidates SSR startup into one tagged request and falls back on older backends', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    seen.push({ pathname: u.pathname, search: u.search, tags: init?.next?.tags });
    if (u.pathname === '/api/v1/bootstrap') {
      return Response.json({
        routing_policy: {
          policy: { api_policy: 'direct', media_policy: 'cdn', third_party_url: null, third_party_pass_api_key: false },
          revision: 5,
        },
        maintenance: { maintenance_mode: true, maintenance_message: ' 维护中 ' },
        block_tags: {
          tags: [{ id: 1, filter: 'safe', tag: 'explicit' }],
          filters: { safe: ['explicit'], spoilers: [], banAnthro: [], banDiscomfort: [], onlyPony: ['pony'] },
        },
        image_blocklist: { revision: 2, blocks: [11, 22], page: 1, limit: 1000, total_count: 3, total_pages: 2, has_more: true },
      });
    }
    if (u.pathname === '/api/v1/image-blocklist' && u.searchParams.get('page') === '2') {
      return Response.json({ revision: 2, blocks: [33], page: 2, limit: 1000, total_count: 3, total_pages: 2, has_more: false });
    }
    return new Response('unexpected', { status: 500 });
  };
  const boot = await readSiteBootstrap();
  assert.equal(boot.routePolicy.api, 'direct');
  assert.equal(boot.routePolicy.image, 'cdn');
  assert.deepEqual(boot.maintenance, { active: true, message: '维护中' });
  assert.deepEqual(boot.routePolicy.blockFilters.safe, ['explicit']);
  assert.deepEqual(boot.routePolicy.blacklist, [11, 22, 33]);
  assert.deepEqual(seen[0].tags, [SITE_STATUS_CACHE_TAG, BLOCK_FILTERS_CACHE_TAG, PUBLIC_BLACKLIST_CACHE_TAG]);
  assert.equal(seen.length, 2, 'one bootstrap call plus overflow blacklist page 2');

  // Calling per-request readers outside React render still uses standalone endpoints cleanly;
  // fallback path when /bootstrap returns 404 uses legacy endpoints.
  seen.length = 0;
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(url);
    seen.push(pathname);
    if (pathname === '/api/v1/bootstrap') return new Response('not found', { status: 404 });
    if (pathname === '/api/v1/routing-policy') {
      return Response.json({ policy: { api_policy: 'auto', media_policy: 'auto', third_party_url: null, third_party_pass_api_key: false }, revision: 1 });
    }
    if (pathname === '/api/v1/maintenance-status') {
      return Response.json({ maintenance_mode: false, maintenance_message: '' });
    }
    if (pathname === '/api/v1/filters/block-tags') {
      return Response.json({ tags: [], filters: { safe: [], spoilers: [], banAnthro: [], banDiscomfort: [], onlyPony: [] } });
    }
    if (pathname === '/api/v1/image-blocklist') {
      return Response.json({ revision: 1, blocks: [], page: 1, limit: 1000, total_count: 0, total_pages: 0, has_more: false });
    }
    return new Response('err', { status: 503 });
  };
  const fallbackBoot = await readSiteBootstrap();
  assert.equal(fallbackBoot.routePolicy.api, 'auto');
  assert.deepEqual(fallbackBoot.maintenance, { active: false, message: '' });
  assert.ok(seen.includes('/api/v1/bootstrap'));
  assert.ok(seen.includes('/api/v1/routing-policy'));
  assert.ok(seen.includes('/api/v1/maintenance-status'));
  void readBlockFilters;
  void readPublicBlacklist;
  void readRoutePolicyOnce;
});

test('sessionUser consumes embedded equipped_badges in one request and falls back to /me/badges for legacy backends', async () => {
  const { sessionUser } = await import('../lib/resources.ts');
  const { clearAllResources } = await import('../lib/resource.ts');
  const baseMe = {
    id: 7, username: 'pony', email: 'p@example.test', email_verified: true, role: 'user',
    coins: 10, experience: 100, avatar: null, banner: null, bio: '', gender: '', race: '',
    birthday: null, created_at: '2026-01-01T00:00:00Z', profile_revision: 1,
    settings: {}, settings_revision: 1, upstream_identity: null,
    developer_access: { user_id: 7, revision: 1, enabled: false, active: false, banned: false, source: null, maintenance_generation: 0, maintenance_expires_at: null, inactive_reason: null, attempts: 0 },
  };
  const badge = { id: 1, name: '星辰', color: '#6750a4', expires_at: null, position: 1 };

  // 1. New backend embeds equipped_badges: only GET /me is sent.
  let paths = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url), 'https://app.invalid').pathname;
    paths.push(pathname);
    if (pathname === '/api/v1/me') return Response.json({ user: { ...baseMe, equipped_badges: [badge] } });
    return new Response('unexpected', { status: 500 });
  };
  clearAllResources();
  const modern = await sessionUser.read({ token: 'tok-modern' });
  assert.equal(modern.kind, 'ok');
  assert.deepEqual(modern.user.equipped_badges, [badge]);
  assert.deepEqual(paths, ['/api/v1/me']);

  // 2. Legacy backend omits equipped_badges: falls back to GET /me/badges.
  paths = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url), 'https://app.invalid').pathname;
    paths.push(pathname);
    if (pathname === '/api/v1/me') return Response.json({ user: baseMe });
    if (pathname === '/api/v1/me/badges') return Response.json({ badges: [badge], equipped: [badge] });
    return new Response('unexpected', { status: 500 });
  };
  clearAllResources();
  const legacy = await sessionUser.read({ token: 'tok-legacy' });
  assert.equal(legacy.kind, 'ok');
  assert.deepEqual(legacy.user.equipped_badges, [badge]);
  assert.deepEqual(paths, ['/api/v1/me', '/api/v1/me/badges']);

  // 3. Expired session (401) short-circuits without requesting /me/badges.
  paths = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url), 'https://app.invalid').pathname;
    paths.push(pathname);
    return Response.json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } }, { status: 401 });
  };
  clearAllResources();
  const unauth = await sessionUser.read({ token: 'tok-expired' });
  assert.equal(unauth.kind, 'unauthorized');
  assert.deepEqual(paths, ['/api/v1/me']);
  clearAllResources();
});
