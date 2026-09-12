/* Real browser regression checks for overlay keyboard contracts and captcha input.
 * Uses the installed Python Playwright and system Edge; no Next build or real API.
 * Only network, motion and decorative primitives are stubbed. Modal, Select,
 * Popover, Menu, CaptchaModal, SliderCaptcha, overlay hooks and track encoding are real.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const virtual = {
  '@/lib/appearance': `exports.MOTION_SPEED_SCALE={slow:1};exports.motionTier=()=> 'off';exports.scaledMs=x=>x;`,
  '@/lib/motion': `exports.spring=()=>({});exports.gsap={to:()=>({kill(){}})};`,
  '@/lib/api': `exports.api={captchaGet:()=>window.captchaGet(),captchaVerify:(x,track)=>window.captchaVerify(x,track)};`,
  'react-icons/md': `const React=require('react');module.exports=new Proxy({}, {get:()=>props=>React.createElement('svg',props)});`,
  './IconButton': `const React=require('react');module.exports=({icon,dismiss,variant,tooltip,...props})=>React.createElement('button',{type:'button',...props},icon);`,
  './Button': `const React=require('react');module.exports=({children,variant,icon,...props})=>React.createElement('button',{type:'button',...props},children);`,
  './Spinner': `const React=require('react');module.exports=()=>React.createElement('span',{'role':'status'},'Loading');`,
  './Skeleton': `const React=require('react');module.exports=props=>React.createElement('div',props);`,
  './ErrorRetry': `const React=require('react');module.exports=({title,onRetry,retryLabel})=>React.createElement('div',null,title,React.createElement('button',{onClick:onRetry},retryLabel));`,
};
const packageFiles = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
};
const entry = `
import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import Menu from '@/components/Menu';
import CaptchaModal from '@/components/CaptchaModal';
import {useOverlayLayer} from '@/lib/overlay';
window.calls=[]; window.getCalls=0; window.failGet=true; window.verifySuccess=true;
window.captchaGet=async()=>{
  window.getCalls++;
  if(window.failGet) throw new Error('offline');
  return {success:true,bg:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="310" height="155"/>',piece:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"/>',y:30};
};
window.captchaVerify=async(x,track)=>{
  window.calls.push({x,track});
  if(window.pendingVerify) await new Promise(resolve=>window.resolveVerify=resolve);
  return window.verifySuccess?{success:true,token:'fixture-token'}:{success:false,error:'校验未通过'};
};
function App(){
 const [outer,setOuter]=useState(false),[inner,setInner]=useState(false),[menu,setMenu]=useState(false);
 const [captcha,setCaptcha]=useState(false),[value,setValue]=useState('a'),[rerenders,setRerenders]=useState(0);
 const [drawer,setDrawer]=useState(false),[detail,setDetail]=useState(false),[allowEscape,setAllowEscape]=useState(true);
 const menuAnchor=useRef(null), drawerRef=useRef(null),detailRef=useRef(null),backRef=useRef(null);
 useOverlayLayer(drawer,drawerRef,{onClose:()=>setDrawer(false)});
 useOverlayLayer(detail,detailRef,{onClose:()=>setDetail(false),additionalRefs:[backRef]});
 window.rerender=()=>flushSync(()=>setRerenders(n=>n+1));
window.setInnerEscape=value=>flushSync(()=>setAllowEscape(value));
window.openBoth=()=>flushSync(()=>{setOuter(true);setInner(true)});
 return <>
  <main inert={drawer||detail}>
   <button onClick={()=>setOuter(true)}>Open modal</button>
   <button onClick={()=>setCaptcha(true)}>Open captcha</button>
   <button onClick={()=>setDrawer(true)}>Open drawer</button>
   <button onClick={()=>setDetail(true)}>Open detail</button>
   <button id="outside">Outside</button>
  </main>
  {drawer&&<aside ref={drawerRef} tabIndex={-1} role="dialog" aria-label="Drawer"><button>Drawer first</button><button onClick={()=>setDrawer(false)}>Drawer close</button></aside>}
  {detail&&<><section ref={detailRef} tabIndex={-1} role="dialog" aria-label="Detail"><button>Detail first</button></section><button ref={backRef} onClick={()=>setDetail(false)}>Detail back</button></>}
  <Modal isOpen={outer} onClose={()=>setOuter(false)} title="Outer" hideCloseButton>
   <button>First</button><button tabIndex={-1}>Not tabbable</button><button disabled>Disabled</button>
   <Select value={value} onChange={setValue} options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]} aria-label="Choice" />
   <button ref={menuAnchor} onClick={()=>setMenu(true)}>Menu</button>
   <Menu open={menu} onClose={refocus=>{setMenu(false);if(refocus)menuAnchor.current?.focus()}} anchorRef={menuAnchor} aria-label="Actions" items={[{value:'item',label:'Menu action'}]} onSelect={()=>setMenu(false)}/>
   <button onClick={()=>setInner(true)}>Open inner</button><div id="real-editor"/><button>Last</button><span>{rerenders}</span>
   <Modal isOpen={inner} onClose={()=>setInner(false)} title="Inner" hideCloseButton closeOnEscape={allowEscape}><button>Inner action</button></Modal>
  </Modal>
  <CaptchaModal isOpen={captcha} onClose={()=>setCaptcha(false)} onVerify={token=>{window.verified=token;setCaptcha(false)}}/>
 </>;
}
createRoot(document.getElementById('root')).render(<App/>);`;

const modules = new Map();
function resolve(specifier, parent) {
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
const server = createServer((req,res)=>{
  if(req.url==='/app.js')return void res.writeHead(200,{'content-type':'text/javascript'}).end(js);
  if(req.url==='/editor.js')return void res.writeHead(200,{'content-type':'text/javascript'}).end(readFileSync(path.join(root,'node_modules/@wangeditor/editor/dist/index.js')));
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(`<!doctype html><html><body><style>
    :root{--z-dialog:100;--z-popover:200}body{font-family:sans-serif}button{padding:10px;margin:3px}.fixed{position:fixed}.inset-0{inset:0}.z-dialog{z-index:100}.z-popover{z-index:200}.bg-scrim-veil{background:#8888}[role=dialog]{background:white;padding:20px;max-width:500px;margin:20px}[role=slider]{width:50px;height:40px;border:1px solid;position:relative}.max-w-78{width:310px}img{width:310px;height:155px}.relative{position:relative}
    </style><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const python = String.raw`
import sys, json, base64
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)+'\n'+(e.stack or '')))
    page.goto(sys.argv[1],wait_until='networkidle')
    page.add_script_tag(url=sys.argv[1]+'/editor.js')
    page.get_by_role('button',name='Open modal',exact=True).click()
    outer=page.get_by_role('dialog',name='Outer',exact=True)
    expect(outer).to_be_focused()
    page.keyboard.press('Shift+Tab')
    expect(page.get_by_role('button',name='Last',exact=True)).to_be_focused()
    page.keyboard.press('Tab')
    expect(page.get_by_role('button',name='First',exact=True)).to_be_focused()
    page.locator('#outside').evaluate('(el)=>el.focus()')
    expect(outer).to_be_focused()
    page.evaluate("window.realEditor=wangEditor.createEditor({selector:'#real-editor',config:{autoFocus:false},mode:'simple'})")
    editor=page.locator('[data-slate-editor]')
    assert editor.evaluate('(el)=>el.tabIndex') == -1
    editor.focus()
    page.keyboard.press('Tab')
    expect(editor).to_be_focused()
    assert '    ' in editor.text_content(), 'The editor must receive Tab as indentation'
    page.get_by_role('combobox').focus()
    # WangEditor's selectionchange handler is debounced by 100 ms; let that
    # library-owned callback finish before destroying this isolated test editor.
    page.wait_for_timeout(150)
    page.evaluate('window.realEditor.destroy()')
    page.get_by_role('combobox').click()
    expect(page.get_by_role('listbox')).to_be_visible()
    page.evaluate('window.rerender()')
    page.keyboard.press('Escape')
    expect(page.get_by_role('listbox')).not_to_be_visible()
    expect(outer).to_be_visible()
    page.get_by_role('button',name='Menu',exact=True).click()
    expect(page.get_by_role('menuitem',name='Menu action')).to_be_focused()
    page.keyboard.press('Tab')
    expect(page.get_by_role('menuitem',name='Menu action')).not_to_be_visible()
    expect(page.get_by_role('button',name='Open inner',exact=True)).to_be_focused()
    page.get_by_role('button',name='Menu',exact=True).click()
    expect(page.get_by_role('menuitem',name='Menu action')).to_be_focused()
    page.keyboard.press('Shift+Tab')
    expect(page.get_by_role('menuitem',name='Menu action')).not_to_be_visible()
    expect(page.get_by_role('combobox')).to_be_focused()
    page.get_by_role('button',name='Menu',exact=True).click()
    expect(page.get_by_role('menuitem',name='Menu action')).to_be_focused()
    page.keyboard.press('Escape')
    expect(outer).to_be_visible()
    page.get_by_role('button',name='Open inner',exact=True).click()
    inner=page.get_by_role('dialog',name='Inner',exact=True)
    expect(inner).to_be_focused()
    page.evaluate('window.setInnerEscape(false);window.rerender()')
    page.keyboard.press('Escape')
    expect(inner).to_be_visible()
    expect(outer).to_be_visible()
    page.evaluate('window.setInnerEscape(true)')
    page.keyboard.press('Escape')
    expect(inner).not_to_be_visible()
    expect(page.get_by_role('button',name='Open inner',exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(outer).not_to_be_visible()
    expect(page.get_by_role('button',name='Open modal',exact=True)).to_be_focused()
    page.evaluate('window.openBoth()')
    expect(inner).to_be_focused()
    assert inner.evaluate('(el)=>Number(getComputedStyle(el.parentElement).zIndex)') > outer.evaluate('(el)=>Number(getComputedStyle(el.parentElement).zIndex)')
    page.keyboard.press('Escape')
    expect(inner).not_to_be_visible()
    expect(outer).to_be_visible()
    expect(outer).to_be_focused()
    page.keyboard.press('Escape')
    expect(outer).not_to_be_visible()
    for label,last in [('Drawer','Drawer close'),('Detail','Detail back')]:
        page.get_by_role('button',name='Open '+label.lower(),exact=True).click()
        panel=page.get_by_role('dialog',name=label,exact=True)
        expect(panel).to_be_focused()
        assert page.locator('main').evaluate('(el)=>el.inert')
        page.keyboard.press('Shift+Tab')
        expect(page.get_by_role('button',name=last,exact=True)).to_be_focused()
        page.keyboard.press('Escape')
        expect(panel).not_to_be_visible()
        expect(page.get_by_role('button',name='Open '+label.lower(),exact=True)).to_be_focused()
        assert not page.locator('main').evaluate('(el)=>el.inert')
    page.get_by_role('button',name='Open captcha',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('网络错误')
    expect(page.get_by_role('button',name='取消',exact=True)).to_be_visible()
    page.evaluate('window.failGet=false')
    page.get_by_role('button',name='重新获取验证码').click()
    slider=page.get_by_role('slider',name='拼图位置')
    expect(slider).to_have_attribute('aria-valuenow','0')
    slider.focus()
    for i in range(12): page.keyboard.press('Shift+ArrowRight')
    page.keyboard.press('ArrowLeft')
    expect(slider).to_have_attribute('aria-valuenow','119')
    page.keyboard.press('Enter')
    page.wait_for_function('window.verified === "fixture-token"')
    calls=page.evaluate('window.calls')
    assert len(calls)==1 and calls[0]['x']==119
    track=json.loads(bytes(b^90 for b in base64.b64decode(calls[0]['track'])))
    assert track[0]==[0,0,0] and track[-1][0]==119 and len(track)<=150
    assert all(sample[1]==0 for sample in track)
    assert all(a[2]<=b[2] for a,b in zip(track,track[1:]))
    expect(page.get_by_role('dialog',name='安全验证')).not_to_be_visible()
    page.wait_for_timeout(300)
    page.evaluate('window.verifySuccess=false;window.verified=null')
    page.get_by_role('button',name='Open captcha',exact=True).click()
    slider=page.get_by_role('slider',name='拼图位置')
    slider.focus()
    page.keyboard.press('End')
    page.keyboard.press('Enter')
    expect(page.get_by_role('alert')).to_contain_text('校验未通过')
    assert page.evaluate('window.verified') is None
    page.get_by_role('button',name='重新获取验证码').click()
    expect(slider).to_have_attribute('aria-valuenow','0')
    page.get_by_role('button',name='取消',exact=True).click()
    expect(page.get_by_role('dialog',name='安全验证')).not_to_be_visible()
    page.wait_for_timeout(300)
    page.evaluate('window.verifySuccess=true;window.pendingVerify=true')
    page.get_by_role('button',name='Open captcha',exact=True).click()
    slider=page.get_by_role('slider',name='拼图位置')
    slider.focus()
    page.keyboard.press('Shift+ArrowRight')
    page.keyboard.press('Enter')
    page.wait_for_function('!!window.resolveVerify')
    page.get_by_role('button',name='取消',exact=True).click()
    page.evaluate('window.resolveVerify()')
    page.wait_for_timeout(300)
    assert page.evaluate('window.verified') is None, 'Cancelled verification must not log in during modal exit'
    page.evaluate('window.pendingVerify=false')
    page.get_by_role('button',name='Open captcha',exact=True).click()
    slider=page.get_by_role('slider',name='拼图位置')
    box=slider.bounding_box()
    assert box
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    page.mouse.down()
    page.mouse.move(box['x']+box['width']/2+80,box['y']+box['height']/2+3,steps=10)
    page.mouse.up()
    page.wait_for_function('window.verified === "fixture-token"')
    pointer=page.evaluate('window.calls.at(-1)')
    pointer_track=json.loads(bytes(b^90 for b in base64.b64decode(pointer['track'])))
    assert pointer_track[0]==[0,0,0] and pointer_track[-1][0]==round(pointer['x'])
    assert pointer_track[-1][1]==3 and len(pointer_track)>2
    assert not errors, errors
    print('PASS: modal Tab boundaries, portal focus, topmost Escape, simultaneous nesting and paint order, real editor Tab, menu Tab exits, callback updates, disabled Escape, nested restoration, drawer/detail isolation, captcha failure/retry/cancel, pointer and keyboard protocol, cancellation during exit')
    browser.close()
`;
try {
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('python',['-c',python,`http://127.0.0.1:${server.address().port}`],{stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',resolve);
  });
  if(result!==0)process.exitCode=result??1;
} finally {server.close();}
