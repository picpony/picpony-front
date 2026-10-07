/* Real React + Edge checks for the design-system primitives' behaviour contracts:
 * busy buttons keep focus and block activation, toggle semantics, chip and drop-zone
 * structure, the labelled Select, Menu focus return, manual tab activation, one-time-code
 * autofill, badge/checkbox entrance rules, the cursor pager, switch naming, the `fill`
 * heading, avatar retry, the sign-in state, clearable search, the password toggle and the
 * shared combobox contract. The primitives are real; only the seams that would pull in the
 * motion engine, routing or the session (appearance, motion, history layers, auth) are
 * fixtures. No stylesheet: these are behaviour checks, the geometry ones live in the
 * browser probes. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Script } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const virtual = {
  '@/lib/appearance': `exports.MOTION_SPEED_SCALE={fast:1,default:1,slow:1};exports.motionTier=()=> 'off';exports.scaledMs=x=>x;`,
  '@/lib/motionLazy': `exports.TabPanesMotion=()=>null;`,
  '@/lib/hooks': `exports.useMediaQuery=()=>false;`,
  '@/lib/historyLayers': `const React=require('react');exports.useHistoryLayer=()=>React.useRef(null);`,
  '@/lib/useIntentPrefetch': `exports.useIntentPrefetch=()=>({onPointerEnter(){},onPointerLeave(){},onFocus(){},onBlur(){},onPointerDown(){}});`,
  '@/lib/scrollTo': `exports.scrollAppToTop=()=>{};exports.scrollAppToElement=()=>{};`,
  './Reveal': `const React=require('react');module.exports=({children,className})=>React.createElement('div',{className},children);`,
  './FadeInImage': `const React=require('react');module.exports=({src,alt})=>React.createElement('img',{src,alt});`,
  './AuthModal': `exports.useAuthModal=()=>({openAuth:(view)=>window.log.push('auth:'+view)});`,
  'react-icons/md': `const React=require('react');module.exports=new Proxy({}, {get:()=>props=>React.createElement('svg',{'aria-hidden':'true'})});`,
  empty: '',
};
const packageFiles = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const entry = `
import React, {useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Chip from '@/components/Chip';
import Select from '@/components/Select';
import Menu from '@/components/Menu';
import Tabs from '@/components/Tabs';
import TabPanes, {TabPane} from '@/components/TabPanes';
import CodeInput from '@/components/CodeInput';
import DropZone from '@/components/DropZone';
import {CountBadge} from '@/components/Badge';
import Checkbox from '@/components/Checkbox';
import Pagination, {LoadMoreButton} from '@/components/Pagination';
import ToggleSwitch from '@/components/ToggleSwitch';
import EmptyState from '@/components/EmptyState';
import Avatar from '@/components/Avatar';
import SignInRequired from '@/components/SignInRequired';
import SearchInput from '@/components/SearchInput';
import {Input} from '@/components/Input';
import Popover from '@/components/Popover';
import {useCombobox} from '@/lib/useCombobox';
window.log=[];
const WORDS=['apple','apricot','banana'];
function Combo(){
  const [text,setText]=useState('');const [open,setOpen]=useState(false);const anchor=useRef(null);
  const options=useMemo(()=>text?WORDS.filter(w=>w.startsWith(text)):[],[text]);
  const box=useCombobox({options,open,onOpenChange:setOpen,onSelect:(o)=>window.log.push('pick:'+o),onEnterWithoutActive:()=>window.log.push('enter:'+text),resetKey:text});
  return <div ref={anchor}><input id="combo" aria-label="水果" {...box.inputProps} value={text} onChange={e=>{setText(e.target.value);setOpen(true);}}/>
    <Popover open={box.isOpen} {...box.listboxProps} aria-label="建议" anchorRef={anchor} onClose={()=>setOpen(false)}>
      {options.map((o,i)=><div key={o} {...box.getOptionProps(i)} className={box.optionClassName(i)}>{o}</div>)}
    </Popover><button id="after-combo">之后</button></div>;
}
function Fixture(){
  const [busy,setBusy]=useState(false),[faved,setFaved]=useState(false),[sex,setSex]=useState('');
  const [menuOpen,setMenuOpen]=useState(false);const menuAnchor=useRef(null);
  const [tabA,setTabA]=useState('one'),[tabM,setTabM]=useState('m1');
  const [code,setCode]=useState(''),[code2,setCode2]=useState('12');
  const [count,setCount]=useState(3),[checked,setChecked]=useState(true),[on,setOn]=useState(false);
  const [q,setQ]=useState(''),[pw,setPw]=useState(''),[avatar,setAvatar]=useState('http://127.0.0.1:9/broken.png');
  window.fx={setBusy:v=>flushSync(()=>setBusy(v)),setCount:v=>flushSync(()=>setCount(v)),setChecked:v=>flushSync(()=>setChecked(v)),setAvatar:v=>flushSync(()=>setAvatar(v)),code:()=>code};
  window.codeValue=code;
  return <main>
    <form onSubmit={e=>{e.preventDefault();window.log.push('submit');}}><input id="field" aria-label="字段"/>
      <Button id="busy" type="submit" loading={busy} onClick={()=>window.log.push('busy-click')}>保存</Button></form>
    <IconButton id="fave" aria-label="收藏" toggle selected={faved} onClick={()=>setFaved(!faved)} icon={<svg/>}/>
    <IconButton id="plain" aria-label="更多" selected icon={<svg/>}/>
    <div id="chips"><Chip>just a tag</Chip><Chip onRemove={()=>window.log.push('removed')}>twilight</Chip></div>
    <Select label="性别" value={sex} onChange={setSex} options={[{value:'m',label:'男'},{value:'f',label:'女'}]}/>
    <button ref={menuAnchor} id="menu-anchor" aria-haspopup="menu" onClick={()=>setMenuOpen(true)}>分享</button>
    <Menu open={menuOpen} onClose={()=>setMenuOpen(false)} anchorRef={menuAnchor} aria-label="分享菜单" items={[{value:'copy',label:'复制链接'},{value:'x',label:'其他'}]} onSelect={v=>window.log.push('menu:'+v)}/>
    <Tabs label="自动" tabs={[{value:'one',label:'一'},{value:'two',label:'二'},{value:'three',label:'三',badge:2}]} value={tabA} onChange={setTabA}/>
    <TabPanes value={tabA}><TabPane value="one"><p>面板一</p></TabPane><TabPane value="two"><p>面板二</p></TabPane><TabPane value="three"><p>面板三</p></TabPane></TabPanes>
    <Tabs label="手动" activation="manual" tabs={[{value:'m1',label:'甲'},{value:'m2',label:'乙'},{value:'m3',label:'丙'}]} value={tabM} onChange={v=>{setTabM(v);window.log.push('manual:'+v);}} panelId={v=>'panel-'+v}/>
    <div id="code1"><CodeInput value={code} onChange={setCode} aria-label="验证码甲"/></div>
    <div id="code2"><CodeInput value={code2} onChange={setCode2} aria-label="验证码乙"/></div>
    <DropZone accept="image/*" onFile={f=>window.log.push('file:'+f.name)} onReject={f=>window.log.push('reject:'+f.name)} aria-label="拖放区"><span>提示</span><button id="inner-btn" onClick={()=>window.log.push('inner')}>内部</button></DropZone>
    <div id="count"><CountBadge count={count} label={count+' 条未读'}/></div>
    <div id="checkbox"><Checkbox checked={checked} onChange={setChecked} label="勾选"/></div>
    <div id="pager-a"><Pagination currentPage={1} hasMore={false} onPageChange={()=>{}} scrollToTop={false}/></div>
    <div id="pager-b"><Pagination currentPage={3} hasMore onPageChange={()=>{}} scrollToTop={false}/></div>
    <div id="more"><LoadMoreButton onClick={()=>window.log.push('more')} isLoading={busy}/></div>
    <ToggleSwitch checked={on} onChange={setOn} label="开关" description="说明文字" layout="row"/>
    <div id="fill"><EmptyState fill title="页面不存在"/></div>
    <div id="avatar"><Avatar unoptimized src={avatar} name="头像"/></div>
    <div id="signin"><SignInRequired description="登录后即可查看"/></div>
    <SearchInput value={q} onChange={setQ} placeholder="筛选"/>
    <Input type="password" label="密码" value={pw} onChange={e=>setPw(e.target.value)}/>
    <Combo/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;

const modules = new Map();
function resolve(specifier, parent) {
  if (/\.(css|json)$/.test(specifier)) return 'virtual:empty';
  if (specifier in virtual) return 'virtual:' + specifier;
  if (specifier in packageFiles) return path.join(root, 'node_modules', packageFiles[specifier]);
  let file = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) :
    specifier.startsWith('.') ? path.resolve(path.dirname(parent), specifier) : null;
  if (!file) throw new Error(`Unmapped dependency ${specifier} from ${parent}`);
  if (!path.extname(file)) file = ['.tsx', '.ts', '.js', '/index.js'].map((ext) => file + ext).find(existsSync);
  if (!file || !existsSync(file)) throw new Error(`Missing dependency ${specifier}`);
  return file;
}
function bundle(id, source) {
  if (modules.has(id)) return;
  modules.set(id, '');
  let code = source ?? (id.startsWith('virtual:') ? virtual[id.slice(8)] : readFileSync(id, 'utf8'));
  if (source !== undefined || /\.tsx?$/.test(id)) code = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, specifier) => {
    const child = resolve(specifier, id);
    bundle(child);
    return `require(${JSON.stringify(child)})`;
  });
  modules.set(id, code);
}
bundle('entry', entry);
const js = `(()=>{const process={env:{NODE_ENV:'production'}};const modules={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:(module,exports,require)=>{${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports,require);return m.exports;}require('entry')})();`;
new Script(js, { filename: 'primitives-bundle' });
const server = createServer((req, res) => {
  if (req.url === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="zh-CN"><body><style>
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    [role=listbox],[role=menu]{background:white;border:1px solid #888}
  </style><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const python = String.raw`
import sys,json
from playwright.sync_api import sync_playwright,expect
PNG=sys.argv[2]
checks=[]
def ok(name): checks.append(name)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 try:
  page=browser.new_page()
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(sys.argv[1],wait_until='networkidle')
  log=lambda: page.evaluate('window.log')
  # 1. busy keeps focus and blocks activation, including implicit submission
  page.locator('#field').focus(); page.keyboard.press('Tab')
  busy=page.locator('#busy'); expect(busy).to_be_focused()
  page.evaluate('window.fx.setBusy(true)')
  expect(busy).to_be_focused(); expect(busy).to_have_attribute('aria-busy','true'); expect(busy).to_have_attribute('aria-disabled','true')
  assert busy.evaluate('b=>!b.disabled')
  page.keyboard.press('Enter'); page.locator('#field').focus(); page.keyboard.press('Enter')
  assert 'submit' not in log() and 'busy-click' not in log(), log()
  expect(page.locator('#more button')).to_have_attribute('aria-busy','true')
  assert page.locator('#more button').evaluate('b=>!b.disabled')
  page.evaluate('window.fx.setBusy(false)'); busy.focus(); page.keyboard.press('Enter')
  assert log()[-2:]==['busy-click','submit'], log(); ok('busy-keeps-focus-and-blocks')
  # 2. toggle semantics
  expect(page.locator('#fave')).to_have_attribute('aria-pressed','false'); page.locator('#fave').click()
  expect(page.locator('#fave')).to_have_attribute('aria-pressed','true')
  assert page.locator('#plain').get_attribute('aria-pressed') is None; ok('icon-toggle-semantics')
  # 3. chips
  assert page.get_by_role('button',name='just a tag').count()==0
  page.get_by_role('button',name='移除 twilight',exact=True).click(); assert log()[-1]=='removed'; ok('chip-label-and-remove-name')
  # 4. labelled select
  combo=page.get_by_role('combobox',name='性别',exact=True); expect(combo).to_be_visible()
  combo.click(); lb=page.get_by_role('listbox',name='性别',exact=True); expect(lb).to_be_visible()
  page.keyboard.press('ArrowDown'); page.keyboard.press('Enter')
  expect(combo).to_contain_text('女'); assert combo.evaluate('b=>b.parentElement.hasAttribute("data-filled")'); ok('labelled-select')
  # 5. menu returns focus itself
  page.locator('#menu-anchor').click(); first=page.get_by_role('menuitem',name='复制链接')
  expect(first).to_be_focused(); page.keyboard.press('Escape'); expect(page.locator('#menu-anchor')).to_be_focused()
  page.locator('#menu-anchor').click(); expect(first).to_be_focused(); page.keyboard.press('Enter')
  expect(page.locator('#menu-anchor')).to_be_focused(); assert log()[-1]=='menu:copy', log(); ok('menu-focus-return')
  # 6. tabs: automatic selects on arrow, manual only moves focus
  one=page.get_by_role('tab',name='一',exact=True); one.focus(); page.keyboard.press('ArrowRight')
  two=page.get_by_role('tab',name='二',exact=True); expect(two).to_be_focused(); expect(two).to_have_attribute('aria-selected','true')
  expect(page.get_by_role('tabpanel',name='二',exact=True)).to_be_visible()
  expect(page.get_by_role('tab',name='三 2 条未读',exact=True)).to_have_count(1)
  a=page.get_by_role('tab',name='甲',exact=True); a.focus(); page.keyboard.press('ArrowRight')
  b=page.get_by_role('tab',name='乙',exact=True); expect(b).to_be_focused(); expect(b).to_have_attribute('aria-selected','false')
  assert not any(x.startswith('manual:') for x in log())
  page.keyboard.press('Enter'); expect(b).to_have_attribute('aria-selected','true'); assert log()[-1]=='manual:m2'; ok('tabs-activation')
  # 7. one-time code: a whole code in one box, and no typing past the first empty box
  boxes=page.locator('#code1 input'); boxes.nth(0).focus(); page.keyboard.insert_text('123456')
  assert [boxes.nth(i).input_value() for i in range(6)]==list('123456'), [boxes.nth(i).input_value() for i in range(6)]
  boxes2=page.locator('#code2 input'); boxes2.nth(4).click(); expect(boxes2.nth(2)).to_be_focused(); ok('code-input-autofill-and-focus')
  # 8. drop zone: its target is a layer, content controls are their own, drops are checked
  zone=page.get_by_role('button',name='拖放区',exact=True); inner=page.get_by_role('button',name='内部',exact=True)
  assert not zone.evaluate('(z)=>z.contains(document.getElementById("inner-btn"))')
  inner.click(); assert log()[-1]=='inner'
  page.evaluate('''()=>{const target=document.getElementById('inner-btn').closest('[data-dropzone-content]').parentElement;
    for (const [name,type] of [['a.txt','text/plain'],['b.png','image/png']]) { const dt=new DataTransfer(); dt.items.add(new File(['x'],name,{type}));
      target.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); } }''')
  assert log()[-2:]==['reject:a.txt','file:b.png'], log(); ok('drop-zone-structure-and-accept')
  # 9. count badge and checkbox: no entrance on mount, one on arrival
  cls=lambda sel: page.locator(sel).evaluate('e=>e.className')
  assert 'animate-control-pop' not in cls('#count > span'); expect(page.locator('#count .sr-only')).to_have_text('3 条未读')
  page.evaluate('window.fx.setCount(0)'); page.evaluate('window.fx.setCount(5)'); assert 'animate-control-pop' in cls('#count > span')
  box=page.locator('#checkbox label > span > span').nth(1)
  assert 'animate-control-pop' not in box.evaluate('e=>e.className')
  page.evaluate('window.fx.setChecked(false)'); page.evaluate('window.fx.setChecked(true)'); assert 'animate-control-pop' in box.evaluate('e=>e.className'); ok('entrance-only-on-change')
  # 10. cursor pager offers only pages that exist
  pages=lambda sel: page.locator(sel+' button[aria-label^="第 "]').evaluate_all('bs=>bs.map(b=>b.getAttribute("aria-label"))')
  assert pages('#pager-a')==['第 1 页'], pages('#pager-a'); assert pages('#pager-b')==['第 1 页','第 2 页','第 3 页','第 4 页'], pages('#pager-b'); ok('cursor-pager-window')
  # 11. switch: the label names it, the supporting line describes it
  sw=page.get_by_role('switch',name='开关',exact=True); expect(sw).to_have_accessible_description('说明文字'); ok('switch-name-and-description')
  # 12. a fill status is the page heading
  expect(page.locator('#fill h1')).to_have_text('页面不存在'); ok('fill-title-is-h1')
  # 13. avatar: a failed URL does not poison the next one
  page.locator('#avatar').scroll_into_view_if_needed(); page.wait_for_function('!document.querySelector("#avatar img")')
  page.evaluate('(src)=>window.fx.setAvatar(src)', PNG); expect(page.locator('#avatar img')).to_have_count(1); ok('avatar-retry-per-url')
  # 14. sign-in state opens nothing by itself, and opens the dialog on demand
  assert not any(x.startswith('auth:') for x in log())
  expect(page.locator('#signin')).to_contain_text('需要登录'); page.locator('#signin').get_by_role('button',name='登录',exact=True).click()
  assert log()[-1]=='auth:login'; ok('sign-in-required')
  # 15. clearable search keeps the caret in the field
  search=page.get_by_role('searchbox',name='筛选'); search.fill('abc'); page.get_by_role('button',name='清除',exact=True).click()
  expect(search).to_have_value(''); expect(search).to_be_focused(); ok('search-clear')
  # 16. password toggle, and the field keeps focus
  pwd=page.get_by_label('密码',exact=True); pwd.fill('secret'); pwd.focus()
  page.get_by_role('button',name='显示密码',exact=True).click(); expect(pwd).to_have_attribute('type','text'); expect(pwd).to_be_focused()
  expect(page.get_by_role('button',name='隐藏密码',exact=True)).to_have_count(1); ok('password-toggle')
  # 17. combobox: nothing active until arrowed into; Enter submits text; Tab picks and moves on
  c=page.locator('#combo'); c.focus(); page.keyboard.type('ap')
  expect(page.get_by_role('listbox',name='建议')).to_be_visible(); assert c.get_attribute('aria-activedescendant') is None
  page.keyboard.press('Enter'); assert log()[-1]=='enter:ap' and not any(x.startswith('pick:') for x in log()), log()
  c.fill(''); page.keyboard.type('ap'); page.keyboard.press('ArrowDown')
  active=c.get_attribute('aria-activedescendant'); assert active and page.locator('[id="'+active+'"]').inner_text()=='apple'
  page.keyboard.press('Enter'); assert log()[-1]=='pick:apple', log()
  c.fill(''); page.keyboard.type('ap'); page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown'); page.keyboard.press('Tab')
  assert log()[-1]=='pick:apricot', log(); expect(page.locator('#after-combo')).to_be_focused()
  c.focus(); c.fill(''); page.keyboard.type('b'); expect(page.get_by_role('listbox',name='建议')).to_be_visible(); page.keyboard.press('Escape')
  expect(page.get_by_role('listbox',name='建议')).to_have_count(0); ok('combobox-contract')
  assert not errors, errors
  print(json.dumps({'ok':True,'checks':checks},ensure_ascii=False))
 finally: browser.close()
`;
try {
  const code = await new Promise((ok, fail) => {
    const child = spawn('python', ['-c', python, `http://127.0.0.1:${server.address().port}`, PNG], { stdio: 'inherit', windowsHide: true });
    child.on('error', fail);
    child.on('exit', ok);
  });
  if (code !== 0) process.exitCode = code || 1;
} finally {
  await new Promise((ok) => server.close(ok));
}
