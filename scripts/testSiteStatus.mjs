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
globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
let cookie = '';
globalThis.document = { get cookie(){return cookie}, set cookie(value){cookie=value} };
after(() => {
  globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  globalThis.document = originalDocument; globalThis.localStorage = originalStorage;
  delete globalThis.__siteStatusTestInvalidate;
});

const { PUT, POST, GET } = await import('../app/api/v1/[...path]/route.ts');
const { SITE_STATUS_CACHE_TAG } = await import('../lib/constants.ts');
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
  const resources = ['/admin/api-route-policy','/admin/image-route-policy','/admin/maintenance',
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
