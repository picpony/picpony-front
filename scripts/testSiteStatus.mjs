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

const { POST, GET } = await import('../app/api.php/[[...path]]/route.ts');
const { SITE_STATUS_CACHE_TAG } = await import('../lib/constants.ts');
const state = await import('../lib/siteStatus.ts');
const route = await import('../lib/route.ts');
const { readRoutePolicy } = await import('../lib/route.server.ts');
const { readMaintenance } = await import('../lib/maintenance.server.ts');
const { readSemanticConfig } = await import('../app/search/semantic.server.ts');

function request(action, method='POST') {
  const req = new Request(`https://app.invalid/api.php?action=${action}`, {
    method, headers: { Authorization:'Bearer fixture-status', 'content-type':'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ enabled: true }) } : {}),
  });
  Object.defineProperty(req,'nextUrl',{value:new URL(req.url)});
  return req;
}

test('all accepted status writes expire the shared server tag without consuming the forwarded answer', async () => {
  const actions = ['admin_save_global_api_route_policy','admin_save_global_image_route_policy','admin_toggle_maintenance',
    'admin_toggle_translate','admin_toggle_semantic_search','admin_save_semantic_cloud'];
  for (const action of actions) {
    invalidations.length = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).searchParams.get('action'), action);
      assert.equal(init.method,'POST');
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-status');
      return Response.json({success:true, message:'saved'});
    };
    const res = await POST(request(action), {params:Promise.resolve({})});
    assert.deepEqual(await res.json(),{success:true,message:'saved'});
    assert.deepEqual(invalidations,[{tag:SITE_STATUS_CACHE_TAG,profile:{expire:0}}]);
  }
});

test('refusals, malformed acknowledgements, failed HTTP, GET and unrelated writes do not invalidate status', async () => {
  const cases = [
    ['admin_toggle_maintenance','POST',200,JSON.stringify({success:false})],
    ['admin_toggle_maintenance','POST',200,JSON.stringify({success:'true'})],
    ['admin_toggle_maintenance','POST',200,'<html>failure</html>'],
    ['admin_toggle_maintenance','POST',503,JSON.stringify({success:true})],
    ['admin_toggle_maintenance','GET',200,JSON.stringify({success:true})],
    ['update_email','POST',200,JSON.stringify({success:true})],
  ];
  for (const [action,method,status,body] of cases) {
    invalidations.length=0;
    globalThis.fetch=async()=>new Response(body,{status,headers:{'content-type':'application/json'}});
    await (method==='GET'?GET:POST)(request(action,method),{params:Promise.resolve({})});
    assert.deepEqual(invalidations,[],`${method} ${action} ${status}`);
  }
});

test('all three server consumers tag the same status document and preserve its public interpretation', async () => {
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    const action=new URL(url).searchParams.get('action');
    if(action==='get_maintenance_status') {
      calls.push(init);
      return Response.json({success:true,maintenance_mode:true,maintenance_message:'暂停更新',
        global_api_route_policy:'direct',global_image_route_policy:'cdn',semantic_search_mode:'qwen',
        semantic_cloud_enabled:true,semantic_cloud_has_key:true,semantic_cloud_timeout_ms:8000});
    }
    if(action==='get_block_tags')return Response.json({success:true,tags:[]});
    if(action==='get_public_blacklist')return Response.json({success:true,blacklist:[]});
    throw new Error('unexpected fixture read '+action);
  };
  assert.equal((await readRoutePolicy()).api,'direct');
  assert.deepEqual(await readMaintenance(),{active:true,message:'暂停更新'});
  const semantic=await readSemanticConfig();
  assert.equal(semantic.availability,'on');assert.equal(semantic.estimateMs,3500);
  assert.equal(calls.length,3);
  for(const init of calls)assert.deepEqual(init.next.tags,[SITE_STATUS_CACHE_TAG]);
});

test('a confirmed public patch fences older reads, whitelists data and never affects the server snapshot', () => {
  const started=state.savedSiteStatusRevision();
  let notified=0;const stop=state.subscribeSavedSiteStatus(()=>notified++);
  state.publishSavedSiteStatus({maintenance:true,semantic:{availability:'on',timeoutMs:18000,api_key:'private'},provider:'private'});
  assert.deepEqual(state.getSavedSiteStatus(),{maintenance:true,semantic:{availability:'on',timeoutMs:18000}});
  assert.deepEqual(state.getServerSiteStatus(),{});
  state.publishObservedSiteStatus({success:true,maintenance_mode:false,semantic_search_mode:'off'},started);
  assert.equal(state.getSavedSiteStatus().maintenance,true);
  const beforeSame=state.savedSiteStatusRevision();
  state.publishSavedSiteStatus({maintenance:true});
  state.publishObservedSiteStatus({success:true,maintenance_mode:false},beforeSame);
  assert.equal(state.getSavedSiteStatus().maintenance,true);
  assert.equal(notified,1,'an unchanged acknowledgement fences reads without rerendering');
  state.publishObservedSiteStatus({success:true,maintenance_mode:false,semantic_search_mode:'off'},state.savedSiteStatusRevision());
  assert.equal(state.getSavedSiteStatus().maintenance,false);
  assert.equal(state.getSavedSiteStatus().semantic.availability,'off');
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
    if(String(url).includes('get_maintenance_status'))return new Promise(resolve=>{release=resolve});
    return Response.json({success:true,tags:[],blacklist:[]});
  };
  const older=route.refreshRoutePolicy();
  for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(release);
  route.applySavedRoutePolicy({global_image_route_policy:'picpony'});
  release(Response.json({success:true,global_api_route_policy:'api_accel',global_image_route_policy:'direct'}));
  await older;
  assert.equal(route.apiPolicy(),'direct');assert.equal(route.imagePolicy(),'picpony');
  assert.match(cookie,/picpony/);
});
