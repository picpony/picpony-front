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
const {opOf,rustError,rustResponse}=await import('./rustRoutes.mjs');
let sent=[];
/* Answers by operation id (the old action name) — `rustRoutes.mjs` maps each Rust route to it. */
let answer=()=>null;
globalThis.fetch = async (url, init={}) => {
 const target=new URL(url,'https://fixture.invalid');
 const action=target.pathname.startsWith('/api/v1/')?opOf(init.method,target.href):null;
 const body=init.body ? JSON.parse(init.body) : null;
 sent.push({action,body,url:String(url),init,method:init.method??'GET',path:target.pathname});
 return rustResponse(await answer(action,body,target));
};
const space=(over={})=>({owner_id:1,has_password:true,unlock_seconds:15,active:false,unlocked:true,expires_at:null,...over});
const privacyPage=(images)=>({owner_id:1,items:images.map(image=>({image_id:image.id,image,revision:0,created_at:'2026-01-01T00:00:00Z'})),total:images.length,page:1,limit:100,metadata_source:'user_snapshot'});
const favesPage=(rows)=>({image_ids:rows.map(r=>r[0]),items:rows.map(([image_id,folder_ids])=>({image_id,created_at:'2026-01-01T00:00:00Z',folder_ids})),total:rows.length,page:1,per_page:100});
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
beforeEach(()=>{ values.clear(); values.set(LS_KEYS.userInfo,JSON.stringify({id:1,username:'test',token}));sent=[];answer=()=>null; clearAllResources(); });
afterEach(()=>{privacy.lockPrivacy(token);});

test('the folder index reads every page and keeps each picture once, with its membership',async()=>{
 const rows=Array.from({length:150},(_,i)=>[1000-i,[2]]);
 answer=(a,b,target)=>{const page=Number(target.searchParams.get('page'));const slice=page===1?rows.slice(0,100):[[rows[99][0],[2]],...rows.slice(100)];return {...favesPage(slice),total:150,page};};
 const index=await api.getFaves(token,2);
 assert.equal(index.ids.length,150);assert.deepEqual(index.folders[1000],[2]);assert.equal(index.dates[1000],'2026-01-01T00:00:00Z');
 assert.deepEqual(sent.map(x=>[x.action,new URL(x.url,'https://fixture.invalid').searchParams.get('folder_id'),new URL(x.url,'https://fixture.invalid').searchParams.get('per_page')]),[['get_faves','2','100'],['get_faves','2','100']]);
});
test('a refused read is an error, never an empty list',async()=>{
 answer=()=>rustError(404,'FOLDER_NOT_FOUND','收藏夹不存在或不属于此账号');
 await assert.rejects(api.getFaves(token,9),e=>e.notFound&&e.code==='FOLDER_NOT_FOUND');
 answer=()=>rustError(503,'DATABASE_UNAVAILABLE');
 await assert.rejects(api.getFaveFolders(token),e=>e.status===503&&e.retryable);
});
test('folder mutations speak the Rust routes; favouriting is idempotent and replayable',async()=>{
 answer=(a)=>a==='toggle_fave'?{image_id:7,folder_ids:[2],favorited:true}:a==='set_image_fave_folders'?{image_id:7,folder_ids:[],favorited:false}:a==='merge_fave_folders'?{target_folder_id:3}:null;
 await api.setFaved(token,7,true,{folderId:2}); await api.setFaved(token,7,false);
 await api.setImageFaveFolders(token,7,[]); await api.deleteFaveFolders(token,[2,3]); await api.mergeFaveFolders(token,[2],3);
 assert.deepEqual(sent.map(x=>[x.method,x.path,x.body]),[
  ['PUT','/api/v1/me/favorites/7',{saved:true,folder_id:2}],['PUT','/api/v1/me/favorites/7',{saved:false}],
  ['PUT','/api/v1/me/favorites/7/folders',{folder_ids:[]}],['POST','/api/v1/me/favorite-folders/deletions',{folder_ids:[2,3]}],
  ['POST','/api/v1/me/favorite-folder-merges',{source_folder_ids:[2],target_folder_id:3}]]);
 const keys=sent.map(x=>new Headers(x.init.headers).get('Idempotency-Key'));
 assert.ok(keys[0]&&keys[1]&&keys[4]&&new Set([keys[0],keys[1],keys[4]]).size===3);
});
test('both transfers expose per-folder partial failures',async()=>{
 answer=()=>({affected_count:2,inserted_count:1,failed_count:1,failed_items:[{image_id:8,folder_id:3,code:'ALREADY_PRESENT',reason:'该项目已存在'}],target_results:[{folder_id:3,requested_count:2,inserted_count:1,duplicate_count:1,blocked_count:0}],removed_count:0,mode:'copy'});
 const result=await api.batchTransferFaves(token,{imageIds:[7,8],sourceFolderId:1,targetFolderIds:[3],mode:'copy',folderNames:new Map([[3,'画作']])});
 assert.deepEqual(result.targets[0],{folderId:3,folderName:'画作',requested:2,succeeded:1,failed:1,reasons:{'该项目已存在':1}});
 assert.equal(model.transferSummary(result,'copy',2).partial,true);
 assert.match(model.transferSummary(result,'copy',2).text,/失败 1 张/);
 await api.batchTransferPrivacyFaves(token,{imageIds:[7,8],targetFolderIds:[3],mode:'move'});
 assert.equal(sent[0].path,'/api/v1/me/favorite-folders/1/transfers');assert.equal('source_folder_id' in sent[0].body,false);
 assert.equal(sent[1].path,'/api/v1/me/privacy-space/transfers');assert.deepEqual(sent[1].body,{image_ids:[7,8],target_folder_ids:[3],mode:'move'});
});
test('privacy writes use account verification before reset; failures stop the reset',async()=>{
 answer=a=>a==='verify_password'?{verified:true}:null;
 await privacy.resetPrivacy(token,'account-password');
 assert.deepEqual(sent.map(x=>[x.action,x.body]),[['verify_password',{password:'account-password'}],['reset_privacy_space',{password:'account-password'}]]);
 /* The session check a 401 sets off (`GET /me`) answers that the session is fine. */
 sent=[];answer=a=>a==='get_user'?{user:{id:1,username:'test'}}:rustError(401,'PASSWORD_MISMATCH','密码错误，或密码已发生变化');
 await assert.rejects(privacy.resetPrivacy(token,'wrong'));await tick();
 assert.deepEqual(sent.map(x=>x.action).filter(a=>a!=='get_user'),['verify_password']);
});
test('privacy password and presence bodies match the contract',async()=>{
 answer=a=>['set_privacy_password','verify_privacy_password','change_privacy_password','set_privacy_faves_presence'].includes(a)?space():a==='add_privacy_fave'?{image_id:7,added:true,revision:0}:null;
 await api.setPrivacyPassword(token,'abc123');await api.verifyPrivacyPassword(token,'abc123');
 await api.changePrivacyPassword(token,'abc123','xyz456');await api.addPrivacyFave(token,picture(7));await api.removePrivacyFave(token,7);
 await api.setPrivacyFavesPresence(token,false,{keepalive:true});await api.lockPrivacySpace(token,{keepalive:true});
 assert.deepEqual(sent.map(x=>x.action),['set_privacy_password','verify_privacy_password','change_privacy_password','add_privacy_fave','remove_privacy_fave','set_privacy_faves_presence','lock_privacy_space']);
 assert.deepEqual(sent[2].body,{old_password:'abc123',new_password:'xyz456'});assert.equal(sent[3].body.image.id,7);assert.equal(sent[3].path,'/api/v1/me/privacy-space/favorites/7');
 assert.equal(sent[4].body,null);assert.deepEqual(sent[5].body,{active:false});assert.equal(sent[5].init.keepalive,true);assert.equal(sent[6].method,'DELETE');
});
test('shared privacy distinguishes a locked space, open pictures and a missing owner',async()=>{
 answer=()=>rustError(403,'PRIVACY_LOCKED','隐私空间未解锁或解锁已过期，请重新输入密码');assert.equal((await api.getSharedPrivacyFaves(token,2)).state,'locked');
 answer=()=>privacyPage([picture(7)]);assert.equal((await api.getSharedPrivacyFaves(token,2)).images[0].id,7);
 assert.equal(sent.at(-1).path,'/api/v1/users/2/privacy-space/favorites');
 answer=()=>rustError(404,'SPACE_NOT_FOUND','隐私空间不可用');await assert.rejects(api.getSharedPrivacyFaves(token,2),e=>e.notFound);
 answer=()=>rustError(401,'PASSWORD_MISMATCH','密码错误，或密码已发生变化');
 await assert.rejects(api.verifySharedPrivacyPassword(token,2,'nope'),e=>api.isPasswordMismatch(e)&&api.isRefusal(e));
});
test('C11 reports rating/hidden-tag exclusions separately from missing and blacklisted pictures',()=>{
 const settings={contentFilter:'safe',banAnthro:true,banDiscomfort:false,onlyPony:false,hiddenTags:['hidden']};
 const images=[picture(1),{...picture(2),tags:['explicit']},{...picture(3),tags:['hidden']},picture(5)];
 const result=model.withholdFromDevice(images,[1,2,3,4,5],settings,DEFAULT_BLOCK_FILTERS,[5]);
 assert.deepEqual(result.images.map(x=>x.id),[1]);assert.equal(result.filtered,2);assert.equal(result.missing,2);
});
test('legacy favourites links preserve username, folder and page; defaults and auto privacy follow contracts',()=>{
 assert.equal(model.legacyFavoritesHref('#mode=shared_faves&user=A%20B&folder=3&page=2'),'/favorites/shared/A%20B/3?page=2');
 assert.equal(model.sharedFolderHref(12,3),'/favorites/shared/~12/3');assert.equal(model.sharedFolderHref('12',3),'/favorites/shared/12/3');
 assert.deepEqual(model.faveOwnerOf('~12'),{ownerId:12});assert.deepEqual(model.faveOwnerOf('12'),{username:'12'});
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
test('import skips known ids, sends batches in order, and honours cancellation between them',async()=>{
 let progress=0; const controller=new AbortController();
 answer=(a,b)=>a==='get_faves'?favesPage([[1,[1]]]):a==='batch_add_faves'?{folder_id:2,requested_count:b.image_ids.length,inserted_count:b.image_ids.length,new_favorite_count:b.image_ids.length}:null;
 const wanted=[1,...Array.from({length:150},(_,i)=>i+2)];
 const result=await actions.importFavourites(token,wanted,2,{signal:controller.signal,onProgress:()=>{progress++;controller.abort();}});
 assert.deepEqual(result.skipped,[1]);assert.equal(result.imported.length,actions.IMPORT_BATCH);assert.equal(progress,1);
 const writes=sent.filter(x=>x.action==='batch_add_faves');
 assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{image_ids:wanted.slice(1,1+actions.IMPORT_BATCH),folder_id:2});
});
test('privacy list is cleared on lock, a late list answer cannot reopen it, and leave stops presence',async()=>{
 let release;answer=a=>a==='check_has_privacy_password'?space():a==='get_privacy_faves'?new Promise(r=>release=r):a==='set_privacy_faves_presence'?space():null;
 const leave=privacy.enterPrivacyScreen(token);const loading=privacy.checkPrivacy(token);await tick();
 privacy.lockPrivacy(token);release(privacyPage([picture(9)]));await loading;
 assert.equal(privacy.privacySnapshot().images,null);assert.equal(privacy.privacySnapshot().status,'locked');leave();
 answer=a=>a==='check_has_privacy_password'?space():a==='get_privacy_faves'?privacyPage([picture(9)]):a==='set_privacy_faves_presence'?space():null;
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
  answer=a=>a==='check_has_privacy_password'?space():a==='get_privacy_faves'?privacyPage([picture(7)]):a==='set_privacy_faves_presence'?space():null;
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
  faveFolders.seed({token},{folders:[{id:1,isMain:true},{id:2,isMain:false}],privacy:{hasPassword:false,unlocked:false,visible:false,itemCount:null}},Date.now());
  answer=a=>a==='set_image_fave_folders'?{image_id:7,folder_ids:[2],favorited:true}:a==='get_faves'?favesPage([[7,[2]],[8,[1]]]):a==='get_fave_folders'?{folders:[],privacy_space:{...space(),visible:false,image_count:null}}:null;
  await actions.setImageFolders(token,7,[2]);await tick();
  assert.deepEqual(faveIds.peek({token,folderId:1}).data.ids,[8]);
  assert.deepEqual(faveIds.peek({token,folderId:2}).data.ids,[7]);
  values.set(LS_KEYS.userInfo,JSON.stringify({token:'other'}));
  const writes=sent.length;
  await assert.rejects(actions.restoreFavourite(token,7,[1,2],1),{name:'AbortError'});
  assert.equal(sent.length,writes);
});
test('the account\'s folder list names each folder\'s cover (latest_image_id), null for an empty one',async()=>{
 answer=a=>a==='get_fave_folders'?{folders:[
  {id:1,name:'主收藏夹',is_main:true,created_at:'Thu 2026-01-01 8:00 AM CST (UTC+08:00)',image_count:3,latest_image_id:2001},
  {id:2,name:'空',is_main:false,created_at:'Thu 2026-01-01 8:00 AM CST (UTC+08:00)',image_count:0,latest_image_id:null},
 ],privacy_space:{...space(),visible:true,image_count:4}}:null;
 const list=await api.getFaveFolders(token);
 assert.deepEqual(list.folders.map(f=>[f.id,f.itemCount,f.latestImageId]),[[1,3,2001],[2,0,null]]);
});
test('a wrong privacy password is 403 PASSWORD_MISMATCH: a field refusal by its code, and no sign-out',async()=>{
 answer=()=>rustError(403,'PASSWORD_MISMATCH','密码错误，或密码已发生变化');
 const error=await api.verifyPrivacyPassword(token,'wrong').then(()=>null,e=>e);
 assert.equal(error.status,403);
 assert.equal(api.isPasswordMismatch(error),true);
 assert.equal(api.isRefusal(error),true,'shown beside the field');
 const {ApiError}=await import('../lib/api/errors.ts');
 assert.equal(api.isRefusal(new ApiError('http',{status:403,code:'FORBIDDEN'})),false,'any other 403 is a permission refusal, not the field');
 assert.ok(!sent.some(x=>x.path==='/api/v1/me'),'a 403 never asks whether the session is still alive');
});
