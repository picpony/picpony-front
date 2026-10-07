/* Real React + Edge checks for where focus goes when content leaves (F7 FX3): `PresenceList`'s
 * removal focus on every tier — a focus inside a leaving entry goes to the same control of the
 * entry now in its place, else of the one before it, else to `fallbackFocus`; a lost focus is
 * placed only for a removal the call site claimed (`claimFocus`); a live focus is never moved —
 * and `PresenceBlock`'s, and `Tabs`' roving tab stop moved after the commit's read, never written
 * by React during a switch. The primitives are real; the motion tier is a switch the checks flip
 * (`window.__tier`). No stylesheet: these are behaviour checks. Run: node scripts/testPresenceFocus.mjs */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Script } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const virtual = {
  '@/lib/appearance': `exports.MOTION_SPEED_SCALE={fast:0.7,default:1,slow:1.4};exports.motionTier=()=>window.__tier||'standard';exports.scaledMs=x=>window.__tier==='off'?0:x;`,
  '@/lib/hooks': `exports.useMediaQuery=()=>false;`,
  '@/lib/motionLazy': `exports.TabPanesMotion=()=>null;`,
  empty: '',
};
const packageFiles = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
};
const entry = `
import React, {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import PresenceList from '@/components/PresenceList';
import PresenceBlock from '@/components/PresenceBlock';
import Tabs from '@/components/Tabs';
const START = ['a','b','c'];
function Row({id, busy}){
  return <li data-presence-key={id} id={'row-'+id}>
    <input type="checkbox" aria-label={'开关 '+id} disabled={busy}/>
    <button id={'menu-'+id} aria-label={'更多 '+id}>⋮</button>
  </li>;
}
function Fixture(){
  const [rows,setRows]=useState(START);
  const [busy,setBusy]=useState(null);
  const [blockShown,setBlockShown]=useState(true);
  const [tab,setTab]=useState('one');
  const list=useRef(null);
  window.fx={
    remove:(id)=>flushSync(()=>setRows((r)=>r.filter((x)=>x!==id))),
    reset:()=>flushSync(()=>{setRows(START);setBusy(null);}),
    busy:(id)=>flushSync(()=>setBusy(id)),
    claim:(ids)=>{window.__release=list.current.claimFocus(ids);},
    release:()=>window.__release&&window.__release(),
    hideBlock:()=>flushSync(()=>setBlockShown(false)),
    tab:(v)=>flushSync(()=>setTab(v)),
  };
  return <main>
    <h1 id="title">标题</h1>
    <button id="elsewhere">别处</button>
    <PresenceList ref={list} items={rows} getKey={(x)=>x} fallbackFocus={()=>document.getElementById('empty-heading')}>
      {(entries,ref)=><div style={{position:'relative'}}><ul ref={ref}>{entries.map(({item,key})=><Row key={key} id={item} busy={busy===item}/>)}</ul>
        {rows.length===0 && <h2 id="empty-heading">空了</h2>}</div>}
    </PresenceList>
    <div style={{position:'relative'}}>
      <PresenceBlock show={blockShown} fallbackFocus={()=>document.getElementById('block-landing')}>
        <div><button id="in-block">块内</button></div>
      </PresenceBlock>
      <h2 id="block-landing">块的去处</h2>
    </div>
    <Tabs label="标签" tabs={[{value:'one',label:'一'},{value:'two',label:'二'},{value:'three',label:'三'}]} value={tab} onChange={setTab}/>
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
new Script(js, { filename: 'presence-bundle' });
const server = createServer((req, res) => {
  if (req.url === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="zh-CN"><body><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const python = String.raw`
import sys,json
from playwright.sync_api import sync_playwright
checks=[]
def ok(name): checks.append(name)
ACTIVE="(()=>{const a=document.activeElement;return a===document.body?'BODY':(a.id||a.tagName)})()"
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 try:
  page=browser.new_page()
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(sys.argv[1],wait_until='networkidle')
  # Focus read in the same task as the removal's commit: decided in that commit, before any frame.
  remove=lambda i: page.evaluate("(i)=>{window.fx.remove(i);return "+ACTIVE+";}",i)
  def fresh(tier):
    page.evaluate("(t)=>{window.__tier=t;window.fx.reset();}",tier); page.wait_for_timeout(450)
  for tier in ('standard','reduced','off'):
    fresh(tier)
    # 1. inside a leaving row: the same control of the row now in its place, then of the one before
    page.focus('#menu-b'); assert remove('b')=='menu-c', (tier, 'after b')
    got=remove('c'); assert got=='menu-a', (tier, 'last of two goes back', got, page.evaluate("()=>[...document.querySelectorAll('ul > li')].map(l=>l.id+(l.inert?'(inert)':''))"))
    # 2. the last row: the fallback (a heading: a landing, no tab stop left behind)
    got=remove('a'); assert got=='empty-heading', (tier, got)
    assert page.evaluate("()=>document.getElementById('empty-heading').hasAttribute('data-route-focus')")
    page.wait_for_timeout(450)
    # 3. a lost focus is placed only for a claimed removal, at the slot the row last had
    fresh(tier)
    page.focus('#menu-a'); page.evaluate("()=>document.activeElement.blur()")
    assert remove('a')=='BODY', (tier, 'unclaimed lost focus must stay')
    page.focus('#menu-b'); page.evaluate("()=>{window.fx.claim(['b']);document.activeElement.blur();}")
    assert remove('b')=='menu-c', (tier, 'claimed lost focus is placed at the same control')
    # 4. a live focus elsewhere is never moved, claimed or not
    fresh(tier)
    page.evaluate("()=>window.fx.claim(['a'])"); page.focus('#elsewhere')
    assert remove('a')=='elsewhere', (tier, 'live focus moved')
    # 5. a released claim is no claim
    page.evaluate("()=>{window.fx.claim(['b']);window.fx.release();}"); page.evaluate("()=>document.activeElement.blur()")
    assert remove('b')=='BODY', (tier, 'released claim still placed focus')
    # 6. a control the row disables while its delete is out does not shift the count
    fresh(tier)
    page.focus('#menu-a'); page.evaluate("()=>window.fx.busy('a')")
    assert remove('a')=='menu-b', (tier, 'slot shifted by a disabled control')
    ok('presence-focus-'+tier)
  # 7. a block leaving with the focus inside hands it to its fallback, on the commit that starts the exit
  page.evaluate("()=>{window.__tier='standard';}")
  page.focus('#in-block')
  got=page.evaluate("()=>{window.fx.hideBlock();return "+ACTIVE+";}")
  assert got=='block-landing', got; ok('presence-block-focus')
  # 8. tabs: one tab stop, moved to the selected tab after the commit, never written by React
  stops=lambda: page.evaluate("()=>[...document.querySelectorAll('[role=tab]')].map(t=>t.tabIndex)")
  assert stops()==[0,-1,-1], stops()
  page.evaluate("""()=>{window.__writes=[];const o=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(n==='tabindex')window.__writes.push(v);return o.call(this,n,v);};}""")
  page.evaluate("()=>window.fx.tab('three')")
  assert stops()==[-1,-1,0], stops()
  assert page.evaluate("()=>window.__writes.length")==0, page.evaluate("()=>window.__writes")
  page.get_by_role('tab',name='三',exact=True).focus(); page.keyboard.press('ArrowLeft')
  assert stops()==[-1,0,-1], stops()
  page.keyboard.press('Home'); assert stops()==[0,-1,-1], stops()
  page.keyboard.press('End'); assert stops()==[-1,-1,0], stops()
  ok('tabs-roving-stop')
  if errors: raise AssertionError(errors)
 finally:
  browser.close()
print(json.dumps({'ok':True,'checks':checks},ensure_ascii=False))
`;
try {
  const code = await new Promise((ok, fail) => {
    const child = spawn('python', ['-c', python, `http://127.0.0.1:${server.address().port}/`], { stdio: 'inherit', windowsHide: true });
    child.on('error', fail);
    child.on('exit', ok);
  });
  if (code !== 0) process.exitCode = code || 1;
} finally {
  await new Promise((ok) => server.close(ok));
}
