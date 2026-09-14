/* Real React + Edge checks for authentication response ownership, controlled
 * editor lifecycle and form/selection semantics. APIs and decorations are local
 * fixtures; the tested components, overlay hooks and WangEditor are unchanged. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Script } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const virtual = {
  '@/lib/appearance': `exports.MOTION_SPEED_SCALE={slow:1};exports.motionTier=()=> 'off';exports.scaledMs=x=>x;`,
  '@/lib/hero': `exports.isImageHeroTransitionRunning=()=>false;exports.waitForImageHeroTransition=()=>Promise.resolve();`,
  '@/lib/api': `exports.api=new Proxy({}, {get:(_,name)=>(...args)=>window.fixtureRequest(name,args)});`,
  '../lib/api': `exports.api=new Proxy({}, {get:(_,name)=>(...args)=>window.fixtureRequest(name,args)});`,
  '@/lib/resources': `exports.sessionUser={read:({token})=>window.fixtureUser(token)};`,
  'react-icons/md': `const React=require('react');module.exports=new Proxy({}, {get:()=>props=>React.createElement('svg',props)});`,
  'next/dynamic': `const React=require('react');module.exports=()=>props=>props.isOpen?React.createElement('button',{onClick:()=>props.onVerify('fixture-captcha')},'Pass captcha'):null;`,
  'next/navigation': `exports.useRouter=()=>({push:(...args)=>window.navigations.push(args)});`,
  './CaptchaModal': `module.exports=()=>null;`,
  './LottieIcon': `module.exports=()=>null;`,
  './Logo': `module.exports=()=>null;`,
  './FadeInImage': `const React=require('react');module.exports=({src,alt})=>React.createElement('img',{src,alt});`,
  '@/components/Spinner': `const React=require('react');module.exports=()=>React.createElement('span',{'role':'status'},'Loading');`,
  '@/components/ErrorRetry': `const React=require('react');module.exports=({title,onRetry,retryLabel})=>React.createElement('div',null,title,React.createElement('button',{onClick:onRetry},retryLabel));`,
  './IconButton': `const React=require('react');module.exports=({icon,dismiss,variant,tooltip,...props})=>React.createElement('button',{type:'button',...props},icon);`,
  './Button': `const React=require('react');module.exports=({children,loading,disabled,variant,icon,size,fullWidth,...props})=>React.createElement('button',{type:'button',disabled:disabled||loading,...props},children);`,
  './Toast': `exports.showToast=(message)=>window.toasts.push(message);`,
  '@/components/Toast': `exports.showToast=(message)=>window.toasts.push(message);`,
  '@wangeditor/editor': `module.exports=window.wangEditor;`,
  'empty': '',
};
const packageFiles = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
};
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {AuthProvider,useAuthModal} from '@/components/AuthModal';
import {Input,Textarea} from '@/components/Input';
import Select from '@/components/Select';
import ProgressBar from '@/components/ProgressBar';
import RichTextEditor from '@/components/RichTextEditor';
import ImageSearchModal from '@/components/ImageSearchModal';
import ImageCropper from '@/components/ImageCropper';
import {useConfirm,usePrompt} from '@/components/ConfirmDialog';
import {writeUserInfo,clearUserInfo,readToken} from '@/lib/hooks';
window.requests=[];window.toasts=[];window.editorChanges=[];window.navigations=[];
window.fixtureRequest=(name,args)=>new Promise(resolve=>window.requests.push({name,args,resolve}));
window.respond=(index,data,status=200)=>window.requests[index].resolve(Response.json(data,{status}));
window.fixtureUser=async()=>({kind:'ok',user:{username:'Fixture'}});
window.changeSession=(token)=>token?writeUserInfo({token,username:token}):clearUserInfo(readToken());
function Controls(){const auth=useAuthModal();window.auth=auth;return null;}
function Questions(){const c=useConfirm(),p=usePrompt();window.askConfirm=()=>c.confirm({title:'Confirm fixture',message:'Fixture'}).then(x=>window.confirmResult=x);window.askPrompt=()=>p.prompt({title:'Prompt fixture',label:'Fixture'}).then(x=>window.promptResult=x);return <>{c.confirmDialog}{p.promptDialog}</>;}
function App(){
 const [searchOpen,setSearchOpen]=useState(false),[questions,setQuestions]=useState(true);
 const [cropFile,setCropFile]=useState(null);
 window.openBrokenCrop=()=>flushSync(()=>setCropFile(new File(['not an image'],'broken.png',{type:'image/png'})));
 window.setSearchOpen=x=>flushSync(()=>setSearchOpen(x));window.hideQuestions=()=>flushSync(()=>setQuestions(false));
 const [editor,setEditor]=useState({show:true,disabled:true,value:'Initial',revision:0,callback:'first'});
 const [selection,setSelection]=useState({disabled:false,value:'a',options:[{value:'a',label:'Unavailable first',disabled:true},{value:'b',label:'Available middle'},{value:'c',label:'Unavailable last',disabled:true}]});
 window.updateEditor=patch=>flushSync(()=>setEditor(prev=>({...prev,...patch})));
 window.updateSelection=patch=>flushSync(()=>setSelection(prev=>({...prev,...patch})));
 return <AuthProvider><Controls/>
 {questions&&<Questions/>}<ImageSearchModal isOpen={searchOpen} onClose={()=>setSearchOpen(false)}/>
 <ImageCropper file={cropFile} onClose={()=>setCropFile(null)} onCropped={()=>{}} aspect={1} outputWidth={256}/>
 <Input label="Fixture field" helper="Required format" aria-describedby="external-hint"/>
 <span id="external-hint">Additional hint</span>
 <Textarea label="Fixture textarea" error="Fixture validation error" count={{value:2,max:3}}/>
 <Select {...selection} onChange={value=>setSelection(prev=>({...prev,value}))} aria-label="Fixture selection"/>
 <ProgressBar value={NaN} label="Unknown progress"/><ProgressBar value={120} label="Bounded progress"/>
 <section id="editor-fixture">{editor.show&&<RichTextEditor key={editor.revision} value={editor.value} disabled={editor.disabled} placeholder="Fixture editor" onChange={value=>{window.editorChanges.push({value,callback:editor.callback});setEditor(prev=>({...prev,value}));}}/>}</section>
 </AuthProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);`;

const modules = new Map();
function resolve(specifier, parent) {
  if (/\.(css|json)$/.test(specifier)) return 'virtual:empty';
  if (specifier in virtual) return 'virtual:' + specifier;
  if (specifier in packageFiles) return path.join(root, 'node_modules', packageFiles[specifier]);
  let file = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) :
    specifier.startsWith('.') ? path.resolve(path.dirname(parent), specifier) : null;
  if (!file) throw new Error(`Unmapped dependency ${specifier} from ${parent}`);
  if (!path.extname(file)) file = ['.tsx', '.ts', '.js', '/index.js'].map(ext=>file+ext).find(existsSync);
  if (!file || !existsSync(file)) throw new Error(`Missing dependency ${specifier}`);
  return file;
}
function bundle(id, source) {
  if (modules.has(id)) return;
  modules.set(id, '');
  let code = source ?? (id.startsWith('virtual:') ? virtual[id.slice(8)] : readFileSync(id, 'utf8'));
  if (source !== undefined || /\.tsx?$/.test(id)) code = ts.transpileModule(code, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_,specifier)=>{
    const child=resolve(specifier,id);bundle(child);return `require(${JSON.stringify(child)})`;
  });
  modules.set(id, code);
}
bundle('entry', entry);
const js = `(()=>{const process={env:{NODE_ENV:'production'}};const modules={${[...modules].map(([id,code])=>`${JSON.stringify(id)}:(module,exports,require)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}require('entry')})();`;
new Script(js, { filename: 'review-ui-bundle' });
const server = createServer((req,res)=>{
  if(req.url==='/app.js')return void res.writeHead(200,{'content-type':'text/javascript'}).end(js);
  if(req.url==='/editor.js')return void res.writeHead(200,{'content-type':'text/javascript'}).end(readFileSync(path.join(root,'node_modules/@wangeditor/editor/dist/index.js')));
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><style>
    :root{--z-dialog:100;--z-popover:200}button{padding:8px;margin:2px}.fixed{position:fixed}.inset-0{inset:0}.z-dialog{z-index:100}.z-popover{z-index:200}.bg-scrim-veil{background:#8888}[role=dialog]{background:white;padding:20px;margin:20px;max-height:90vh;overflow:auto}input,textarea{display:block}[data-slate-editor]{min-height:80px}.invisible{visibility:hidden}
  </style><div id="root"></div><script src="/editor.js"></script><script src="/app.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const python = String.raw`
import sys,json
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 try:
  page=browser.new_page()
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)+'\n'+(e.stack or '')))
  page.on('console',lambda message: print(message.text) if message.type=='error' else None)
  page.goto(sys.argv[1],wait_until='networkidle')
  assert not errors,errors
  editor=page.locator('[data-slate-editor]')
  expect(editor).to_have_attribute('contenteditable','false')
  expect(editor).to_have_attribute('role','textbox')
  expect(editor).to_have_attribute('aria-multiline','true')
  expect(editor).to_have_attribute('aria-label','Fixture editor')
  assert page.locator('#editor-fixture button[data-tooltip]:not([aria-label])').count()==0
  assert page.locator("#editor-fixture button[data-menu-key='group-image']:not([aria-label])").count()==0
  page.evaluate("window.updateEditor({disabled:false,callback:'second'})")
  expect(editor).to_have_attribute('contenteditable','true')
  editor.fill('Changed content')
  page.wait_for_function("window.editorChanges.some(x=>x.value==='Changed content'&&x.callback==='second')")
  page.evaluate("window.updateEditor({value:''})")
  expect(editor).to_have_text('')
  for _ in range(3):
   page.evaluate('window.updateEditor({show:false})')
   page.evaluate('window.updateEditor({show:true})')
   expect(page.locator('[data-slate-editor]')).to_have_count(1)
  field=page.get_by_role('textbox',name='Fixture field',exact=True)
  assert field.evaluate("el=>el.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id).textContent).join(' ')")=='Additional hint Required format'
  area=page.get_by_role('textbox',name='Fixture textarea',exact=True)
  assert 'Fixture validation error' in area.evaluate("el=>document.getElementById(el.getAttribute('aria-describedby')).textContent")
  assert page.get_by_role('progressbar',name='Unknown progress').get_attribute('aria-valuenow') is None
  expect(page.get_by_role('progressbar',name='Bounded progress')).to_have_attribute('aria-valuenow','100')
  select=page.get_by_role('combobox',name='Fixture selection')
  select.click()
  assert select.evaluate("el=>document.getElementById(el.getAttribute('aria-activedescendant')).textContent").strip()=='Available middle'
  for key in ['End','Home']:
   page.keyboard.press(key)
   assert select.evaluate("el=>document.getElementById(el.getAttribute('aria-activedescendant')).getAttribute('aria-disabled')")!='true'
  page.evaluate('window.updateSelection({disabled:true})')
  expect(page.get_by_role('listbox')).not_to_be_visible()

  def open_login(name='Fixture'):
   page.evaluate("window.auth.openAuth('login')")
   dialog=page.get_by_role('dialog',name='登录',exact=True)
   dialog.locator('#auth-login-f1').fill(name)
   dialog.locator('#auth-login-f2').fill('Password123')
   dialog.get_by_role('button',name='登录',exact=True).click()
   page.get_by_role('button',name='Pass captcha').click()
   return dialog
  def response(index,token):
   page.evaluate('([i,t])=>window.respond(i,{success:true,token:t,username:t})',[index,token])

  # Closing invalidates synchronously, even before the exit animation unmounts.
  dialog=open_login()
  page.wait_for_function('window.requests.length===1')
  page.evaluate('window.auth.closeAuth()')
  response(0,'cancelled-token')
  page.wait_for_timeout(50)
  assert page.evaluate("localStorage.getItem('user_info')")==None
  assert page.evaluate('window.toasts.length')==0
  # The newer attempt owns the session even if the cancelled one returns later.
  dialog=open_login('Older')
  page.wait_for_function('window.requests.length===2')
  page.evaluate('window.auth.closeAuth()')
  dialog=open_login('Newer')
  page.wait_for_function('window.requests.length===3')
  response(2,'newer-token')
  page.wait_for_function("JSON.parse(localStorage.getItem('user_info'))?.token==='newer-token'")
  response(1,'older-token')
  page.wait_for_timeout(50)
  assert page.evaluate("JSON.parse(localStorage.getItem('user_info')).token")=='newer-token'
  # Token A -> B -> A is still a different session and cannot revive the attempt.
  page.evaluate('window.changeSession(null)')
  dialog=open_login()
  page.wait_for_function('window.requests.length===4')
  page.evaluate("window.changeSession('other-token');window.changeSession(null)")
  response(3,'aba-token')
  page.wait_for_timeout(50)
  assert page.evaluate("localStorage.getItem('user_info')")==None
  page.evaluate('window.auth.closeAuth()')
  # Switching forms invalidates a delayed response and does not switch back.
  dialog=open_login()
  page.wait_for_function('window.requests.length===5')
  page.evaluate("window.auth.switchView('reset')")
  response(4,'replaced-token')
  page.wait_for_timeout(50)
  expect(page.get_by_role('dialog',name='找回密码',exact=True)).to_be_visible()
  assert page.evaluate("localStorage.getItem('user_info')")==None
  page.evaluate('window.auth.closeAuth()')
  # Register, then cancel while email verification is pending.
  page.evaluate("window.auth.openAuth('register')")
  dialog=page.get_by_role('dialog',name='注册',exact=True)
  dialog.locator('#auth-register-f1').fill('NewMember')
  dialog.locator('#auth-register-f2').fill('member@example.test')
  dialog.locator('#auth-register-f3').fill('Password123')
  dialog.get_by_role('button',name='注册',exact=True).click()
  page.get_by_role('button',name='Pass captcha').click()
  page.wait_for_function('window.requests.length===6')
  page.evaluate('window.respond(5,{success:true,user_id:7,username:"NewMember"})')
  code=page.get_by_role('group',name='邮箱验证码').locator('input')
  for i,char in enumerate('123456'):code.nth(i).fill(char)
  dialog.get_by_role('button',name='验证并登录',exact=True).click()
  page.wait_for_function('window.requests.length===7')
  page.evaluate('window.auth.closeAuth()')
  response(6,'cancelled-verification')
  page.wait_for_timeout(50)
  assert page.evaluate("localStorage.getItem('user_info')")==None
  # Image-search results cannot navigate after its dialog has been dismissed.
  page.evaluate('window.setSearchOpen(true)')
  search=page.get_by_role('dialog',name='以图搜图',exact=True)
  search.locator('input[type=file]').set_input_files({'name':'fixture.png','mimeType':'image/png','buffer':b'fixture-image'})
  search.get_by_role('button',name='开始搜索',exact=True).click()
  page.wait_for_function('window.requests.length===8')
  search.get_by_role('button',name='取消',exact=True).click()
  page.evaluate('window.requests[7].resolve({searchQuery:"should-not-navigate"})')
  page.wait_for_timeout(50)
  assert page.evaluate('window.navigations.length')==0
  page.evaluate('window.openBrokenCrop()')
  crop=page.get_by_role('dialog',name='调整图片',exact=True)
  expect(crop).to_contain_text('图片无法读取，请选择其他图片')
  expect(crop.get_by_role('button',name='确认',exact=True)).to_be_disabled()
  crop.get_by_role('button',name='重新选择',exact=True).click()
  expect(crop).not_to_be_visible()
  page.evaluate('void window.askConfirm();void window.askPrompt()')
  page.evaluate('window.hideQuestions()')
  page.wait_for_function('window.confirmResult===false&&window.promptResult===null')
  assert not errors,errors
  print(json.dumps({'ok':True,'checks':['auth-close','auth-replacement','auth-session-aba','auth-email-cancel','editor-initial-disabled','editor-controlled-clear','editor-current-callback','editor-remount','editor-accessible-dom','field-descriptions','select-disabled-options','select-disabled-while-open','progress-nonfinite','image-search-cancel','image-cropper-corrupt-file','confirm-prompt-unmount']},ensure_ascii=False))
 finally:browser.close()
`;
try {
  const code = await new Promise((resolve,reject)=>{
    const child=spawn('python',['-c',python,`http://127.0.0.1:${server.address().port}`],{stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',resolve);
  });
  if(code!==0)process.exitCode=code||1;
} finally { await new Promise(resolve=>server.close(resolve)); }
