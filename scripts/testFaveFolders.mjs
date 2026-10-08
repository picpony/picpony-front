import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { requireTypeStripping } from './tsResolve.mjs';
requireTypeStripping('testFaveFolders');

const values = new Map();
const events = new EventTarget();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
globalThis.window = {
 addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args), dispatchEvent: e => events.dispatchEvent(e),
 requestAnimationFrame: cb => setTimeout(cb, 0), setTimeout, clearTimeout,
 matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){} }),
 __picponyRoutePolicy: {api:'direct',image:'direct'},
};
const documentEvents = new EventTarget();
globalThis.document = { visibilityState:'visible', hidden:false, cookie:'', addEventListener:(...a)=>documentEvents.addEventListener(...a), removeEventListener:(...a)=>documentEvents.removeEventListener(...a) };
let sent=[];
let answer=()=>({success:true});
globalThis.fetch = async (url, init={}) => {
 const target=new URL(url,'https://fixture.invalid');
 const action=target.searchParams.get('action');
 const body=init.body ? JSON.parse(init.body) : null;
 sent.push({action,body,url:String(url),init});
 return Response.json(await answer(action,body,target));
};
const api=await import('../lib/api/favorites.ts');
const model=await import('../lib/favorites.ts');
const {DEFAULT_BLOCK_FILTERS}=await import('../lib/blockFilters.ts');
const {ZipWriter,crc32,uniqueEntryName}=await import('../lib/zip.ts');
const {validatePrivacyPassword}=await import('../lib/validation.ts');
const {LS_KEYS}=await import('../lib/constants.ts');
const {clearAllResources}=await import('../lib/resource.ts');
const actions=await import('../lib/favoritesActions.ts');
const privacy=await import('../lib/favoritesPrivacy.ts');
const {SYNCED_SETTINGS}=await import('../lib/settingsSync.ts');
await (await import('../lib/route.ts')).ensureRoutePolicy();
const token='test-faves';
const picture=id=>({id,name:`${id}.png`,tags:['safe'],width:800,height:600,view_url:`https://derpicdn.net/img/${id}/full.png`,representations:{full:`https://derpicdn.net/img/${id}/full.png`}});
const tick=()=>new Promise(r=>setTimeout(r,5));
beforeEach(()=>{ values.clear(); values.set(LS_KEYS.userInfo,JSON.stringify({id:1,username:'test',token}));sent=[];answer=()=>({success:true}); clearAllResources(); });
afterEach(()=>{privacy.lockPrivacy(token);});

test('folder index normalises strings, duplicates and membership',async()=>{
 answer=()=>({success:true,faves:['3',3,4,-1],faves_dates:{3:'2026-01-01 00:00:00'},faves_folders:{3:['1',2,2]}});
 assert.deepEqual(await api.getFaves(token,2),{ids:[3,4],dates:{3:'2026-01-01 00:00:00'},folders:{3:[1,2]}});
 assert.equal(new URL(sent[0].url,'https://fixture.invalid').searchParams.get('folder_id'),'2');
});
test('malformed successful lists fail rather than inventing an empty state',async()=>{
 await assert.rejects(api.getFaves(token),e=>e.kind==='invalid');
 await assert.rejects(api.getFaveFolders(token),e=>e.kind==='invalid');
});
test('folder mutations retain the old wire types and empty membership cancels a favourite',async()=>{
 await api.toggleFave(token,7,{folderId:2}); await api.toggleFave(token,7,{remove:true});
 await api.setImageFaveFolders(token,7,[]); await api.deleteFaveFolders(token,[2,3]); await api.mergeFaveFolders(token,[2],3);
 assert.deepEqual(sent.map(x=>x.body),[{image_id:7,folder_id:2},{image_id:7,fave:false},{image_id:7,folder_ids:[]},{folder_ids:['2','3']},{source_folder_ids:['2'],target_folder_id:'3'}]);
});
test('both transfers expose per-folder partial failures',async()=>{
 answer=()=>({success:true,affected_count:2,target_results:[{folder_id:3,folder_name:'画作',requested_count:2,success_count:1,failed_count:1,failure_reasons:{拒绝:1}}]});
 const result=await api.batchTransferFaves(token,{imageIds:[7,8],sourceFolderId:1,targetFolderIds:[3],mode:'copy'});
 assert.equal(model.transferSummary(result,'copy',2).partial,true);
 assert.match(model.transferSummary(result,'copy',2).text,/失败 1 张/);
 await api.batchTransferPrivacyFaves(token,{imageIds:[7,8],targetFolderIds:[3],mode:'move'});
 assert.equal(sent[0].body.source_folder_id,1);assert.equal('source_folder_id' in sent[1].body,false);
});
test('privacy writes use account verification before reset; failures stop the reset',async()=>{
 await privacy.resetPrivacy(token,'account-password');
 assert.deepEqual(sent.map(x=>[x.action,x.body]),[['verify_password',{password:'account-password'}],['reset_privacy_space',{current_password:'account-password'}]]);
 sent=[];answer=()=>({success:false,error:'密码错误'});
 await assert.rejects(privacy.resetPrivacy(token,'wrong'));
 assert.deepEqual(sent.map(x=>x.action),['verify_password']);
});
test('privacy password and presence bodies match the contract',async()=>{
 await api.setPrivacyPassword(token,'abc123');await api.verifyPrivacyPassword(token,'abc123');
 await api.changePrivacyPassword(token,'abc123','xyz456');await api.addPrivacyFave(token,picture(7));await api.removePrivacyFave(token,7);
 await api.setPrivacyFavesPresence(token,false,{keepalive:true});await api.lockPrivacySpace(token,{keepalive:true});
 assert.deepEqual(sent[2].body,{old_password:'abc123',new_password:'xyz456'});assert.equal(sent[3].body.image_data.id,7);
 assert.deepEqual(sent[4].body,{image_id:7});assert.deepEqual(sent[5].body,{active:false});assert.equal(sent[5].init.keepalive,true);assert.equal(sent[6].body,null);
});
test('shared privacy distinguishes no password, a locked space, open pictures and missing owner',async()=>{
 answer=()=>({success:false,has_password:false});assert.equal((await api.getSharedPrivacyFaves(token,2)).state,'no-password');
 answer=()=>({success:false,error:'需要密码'});assert.equal((await api.getSharedPrivacyFaves(token,2)).state,'locked');
 answer=()=>({success:true,faves:[picture(7)]});assert.equal((await api.getSharedPrivacyFaves(token,2)).images[0].id,7);
 answer=()=>({success:false,error:'用户不存在'});await assert.rejects(api.getSharedPrivacyFaves(token,2),e=>e.status===404);
});
test('C11 reports rating/hidden-tag exclusions separately from missing and blacklisted pictures',()=>{
 const settings={contentFilter:'safe',banAnthro:true,banDiscomfort:false,onlyPony:false,hiddenTags:['hidden']};
 const images=[picture(1),{...picture(2),tags:['explicit']},{...picture(3),tags:['hidden']},picture(5)];
 const result=model.withholdFromDevice(images,[1,2,3,4,5],settings,DEFAULT_BLOCK_FILTERS,[5]);
 assert.deepEqual(result.images.map(x=>x.id),[1]);assert.equal(result.filtered,2);assert.equal(result.missing,2);
});
test('legacy favourites links preserve username, folder and page; defaults and auto privacy follow contracts',()=>{
 assert.equal(model.legacyFavoritesHref('#mode=shared_faves&user=A%20B&folder=3&page=2'),'/favorites/shared/A%20B/3?page=2');
 assert.equal(model.legacyFavoritesHref('#shared_privacy:2:name'),'/favorites/privacy/2');
 const folders=[{id:1,name:'主收藏夹',isMain:true},{id:2,name:'作品',isMain:false}];
 assert.equal(model.resolveDefaultFolder(folders,{id:99,name:'gone'}).id,1);
 assert.equal(model.goesToPrivacySpace({alreadyFaved:false,autoPrivacy:true,contentFilter:'developer',tags:['explicit']}),true);
 assert.equal(model.goesToPrivacySpace({alreadyFaved:true,autoPrivacy:true,contentFilter:'developer',tags:['explicit']}),false);
 assert.equal(validatePrivacyPassword('abc123'),null);assert.ok(validatePrivacyPassword('ab 123'));assert.ok(validatePrivacyPassword('12345'));
});
test('lookup bounds URL size and both favourites reads explicitly ask Everything',async()=>{
 answer=()=>({images:[],total:0});await api.lookupImagesByIds([1,2]);await api.getDerpiFaves('test-key',1,50);
 assert.ok(sent.every(x=>new URL(x.url).searchParams.get('filter_id')==='56027'));
 await assert.rejects(api.lookupImagesByIds(Array.from({length:51},(_,i)=>i+1)),RangeError);
});
test('all six settings are registered with account scope',()=>{
 for(const id of ['defaultFaveToMain','defaultFaveFolder','publicFaveFolderIds','showPrivacyFaves','autoPrivacyFaves','privacyUnlockDurationSeconds'])assert.equal(SYNCED_SETTINGS.find(x=>x.id===id)?.scope,'account',id);
});
test('import skips known ids, runs sequentially, and honours cancellation between writes',async()=>{
 let progress=0; const controller=new AbortController();
 answer=a=>a==='get_faves'?{success:true,faves:[1]}:{success:true};
 const result=await actions.importFavourites(token,[1,2,3],2,{signal:controller.signal,onProgress:()=>{progress++;controller.abort();}});
 assert.deepEqual(result.skipped,[1]);assert.deepEqual(result.imported,[2]);assert.equal(progress,1);
 assert.equal(sent.filter(x=>x.action==='toggle_fave').length,1);
});
test('privacy list is cleared on lock, a late list answer cannot reopen it, and leave stops presence',async()=>{
 let release;answer=a=>a==='check_has_privacy_password'?{has_password:true,unlocked:true}:a==='get_privacy_faves'?new Promise(r=>release=r):{success:true};
 const leave=privacy.enterPrivacyScreen(token);const loading=privacy.checkPrivacy(token);await tick();
 privacy.lockPrivacy(token);release({success:true,faves:[picture(9)]});await loading;
 assert.equal(privacy.privacySnapshot().images,null);assert.equal(privacy.privacySnapshot().status,'locked');leave();
 answer=a=>a==='check_has_privacy_password'?{has_password:true,unlocked:true}:a==='get_privacy_faves'?{success:true,faves:[picture(9)]}:{success:true};
 const leave2=privacy.enterPrivacyScreen(token);await privacy.checkPrivacy(token);leave2();await tick();
 assert.ok(sent.some(x=>x.action==='set_privacy_faves_presence'&&x.body.active===false));assert.equal(privacy.privacySnapshot().beating,false);
});
test('classic and ZIP64 archives open with Python zipfile; CRC and UTF-8 names survive',async()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 for(const zip64 of ['auto','always']){
  const zip=new ZipWriter({zip64});zip.add('图片.png',new Uint8Array([1,2,3]));zip.add('empty',new Uint8Array());
  const blob=zip.finish();assert.equal(zip.finish(),blob);assert.throws(()=>zip.add('later',new Uint8Array()));
  const check=spawnSync('python',['-c',"import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.read('图片.png') == bytes([1,2,3]); assert z.read('empty') == b''"],{input:Buffer.from(await blob.arrayBuffer()),env:{...process.env,PYTHONUTF8:'1'}});
  assert.equal(check.status,0,check.stderr.toString());
 }
});
test('archive names are safe, case-insensitively unique and never traversal entries',()=>{
 const taken=new Set();assert.equal(uniqueEntryName('https://x/A.png','fallback',taken),'A.png');assert.equal(uniqueEntryName('https://x/a.png','fallback',taken),'a_2.png');
 assert.equal(uniqueEntryName('https://x/%2E%2E','fallback',taken),'fallback');assert.equal(uniqueEntryName('https://x/CON.png','fallback',taken),'_CON.png');
 assert.equal(uniqueEntryName('https://x/a%2Fb.png','fallback',taken),'a_b.png');
});

test('unlock expiry clears the list and an expired background deadline cannot be revived', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  answer=a=>a==='check_has_privacy_password'?{has_password:true,unlocked:true}:a==='get_privacy_faves'?{success:true,faves:[picture(7)]}:{success:true};
  const leave=privacy.enterPrivacyScreen(token);
  await privacy.checkPrivacy(token);
  assert.equal(privacy.privacySnapshot().status,'open');
  leave();
  t.mock.timers.tick(15_001);
  assert.equal(privacy.privacySnapshot().status,'locked');
  assert.equal(privacy.privacySnapshot().images,null);
  assert.equal(privacy.privacySnapshot().autoLocked,true);
  const leaveAgain=privacy.enterPrivacyScreen(token);
  assert.equal(privacy.privacySnapshot().status,'locked');
  leaveAgain();
});

test('a mutation corrects every loaded folder and refuses a stale-session undo',async()=>{
  const {faveIds,faveFolders}=await import('../lib/resources.ts');
  const all={ids:[7,8],dates:{},folders:{7:[1,2],8:[1]}};
  faveIds.seed({token},all,Date.now());
  faveIds.seed({token,folderId:1},all,Date.now());
  faveIds.seed({token,folderId:2},{ids:[7],dates:{},folders:{7:[1,2]}},Date.now());
  faveFolders.seed({token},{folders:[{id:1,isMain:true},{id:2,isMain:false}],privacy:null},Date.now());
  await actions.setImageFolders(token,7,[2]);await tick();
  assert.deepEqual(faveIds.peek({token,folderId:1}).data.ids,[8]);
  assert.deepEqual(faveIds.peek({token,folderId:2}).data.ids,[7]);
  values.set(LS_KEYS.userInfo,JSON.stringify({token:'other'}));
  const writes=sent.length;
  await assert.rejects(actions.restoreFavourite(token,7,[1,2],1),{name:'AbortError'});
  assert.equal(sent.length,writes);
});
