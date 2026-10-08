/* The phone drawer's swipe (`useDrawerSwipe`, lib/motion.ts) in a real browser: every way a gesture
 * can end hands the panel and the scrim back to their classes and leaves the drawer where React
 * says — a release, a close from elsewhere while the finger is down (Back: on a phone the edge Back
 * gesture reaches the page as this very drag before the system takes it), a close while a release
 * springs open, a finger that never ends, and `enabled` flipping mid-gesture (a picture's route, the
 * docked breakpoint) — and in the 关闭 tier.
 *
 * Before the fix a Back during the drag was undone by the drag's own release (the drawer reopened);
 * a finger that never ended left the scrim at its inline opacity over a closed drawer; and a revert
 * left GSAP's resting transform inline (`translate: none`), so a closed drawer stood on screen.
 *
 * Uses the installed Python Playwright and system Edge, like `repairOverlayTest.mjs`; no Next build
 * and no app server. `lib/motion.ts` is bundled for real with GSAP, its Observer and
 * `@gsap/react`; only the app modules it reaches for elsewhere are stubbed.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const virtual = {
  '@/lib/appearance': `exports.motionTier=()=>window.__tier||'standard';exports.useMotionTier=()=>window.__tier||'standard';
    exports.motionScale=()=>1;exports.scaledMs=x=>x;exports.setMotionScaleListener=()=>{};exports.useEntranceMotion=()=>true;
    exports.MOTION_SPEED_SCALE={fast:0.7,default:1,slow:1.4};exports.CUSTOM_PALETTE='custom';`,
  '@/lib/appScroller': `exports.getAppScroller=()=>null;exports.heroOwnsScreen=()=>false;exports.setHeroBusyCheck=()=>{};`,
  '@/lib/pageTransit': `exports.beginPageTransit=()=>()=>{};exports.notifyThemeWipeStart=()=>{};exports.routeTransitActive=()=>false;exports.setThemeWipeGuard=()=>{};`,
  '@/lib/tabIntent': `exports.setTabIntent=()=>{};exports.tabIntent=()=>null;`,
  '@/lib/masonry': `exports.replacedSkeleton=()=>false;`,
  '@/lib/utils': `exports.runWhenIdle=f=>{const t=setTimeout(f,0);return()=>clearTimeout(t)};exports.clamp01=v=>Math.min(1,Math.max(0,v));`,
  '@/lib/tabScroll': `exports.recallTabScroll=()=>undefined;exports.rememberTabScroll=()=>{};exports.tabPanelTop=()=>0;exports.TAB_SHARED_CHROME_PX=64;`,
};
const packageFiles = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
  gsap: 'gsap/dist/gsap.js',
  'gsap/CustomEase': 'gsap/dist/CustomEase.js',
  'gsap/Flip': 'gsap/dist/Flip.js',
  'gsap/Observer': 'gsap/dist/Observer.js',
  '@gsap/react': '@gsap/react/dist/index.js',
};
/* A drawer and a scrim with the shell's own geometry and transitions (AppLayout): the panel slides
   on the individual `translate` property, the scrim fades, both on the effects clock. */
const entry = `
import React, {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useDrawerSwipe} from '@/lib/motion';
window.changes = [];
function App() {
  const drawerRef = useRef(null), scrimRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  useDrawerSwipe({drawerRef, scrimRef, open, enabled, onOpenChange: (next) => { window.changes.push(next); setOpen(next); }});
  window.setOpen = (value) => flushSync(() => setOpen(value));
  window.setEnabled = (value) => flushSync(() => setEnabled(value));
  window.state = () => ({open});
  return <>
    <div ref={scrimRef} className={'scrim' + (open ? ' open' : '')} />
    <aside ref={drawerRef} className={'drawer' + (open ? ' open' : '')}>drawer</aside>
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
const server = createServer((req, res) => {
  if (req.url === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(js);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><body style="margin:0"><style>
    .drawer{position:fixed;top:0;bottom:0;left:0;width:288px;background:#ddd;translate:calc(-100% - 8px) 0;transition:translate 108ms}
    .drawer.open{translate:0 0}
    .scrim{position:fixed;inset:0;background:#0005;opacity:0;pointer-events:none;transition:opacity 108ms}
    .scrim.open{opacity:1;pointer-events:auto}
    </style><div id="root"></div><script src="/app.js"></script></body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

const python = String.raw`
import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(sys.argv[1], wait_until='networkidle')
    page.wait_for_function('typeof window.setOpen === "function"')
    STATE = '''() => { const d = document.querySelector('.drawer'), s = document.querySelector('.scrim');
      return {open: window.state().open, right: Math.round(d.getBoundingClientRect().right),
              scrim: Math.round(parseFloat(getComputedStyle(s).opacity) * 100) / 100,
              inline: (d.getAttribute('style') || '') + '|' + (s.getAttribute('style') || ''), changes: window.changes.slice()}; }'''
    DRAG = '''([x0, dx, steps]) => {
      const point = (x) => new Touch({identifier: 1, target: document.body, clientX: x, clientY: 420});
      document.body.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, cancelable: true, touches: [point(x0)], changedTouches: [point(x0)]}));
      for (let i = 1; i <= steps; i++) {
        const t = point(x0 + dx * i / steps);
        document.dispatchEvent(new TouchEvent('touchmove', {bubbles: true, cancelable: true, touches: [t], changedTouches: [t]}));
      }
    }'''
    END = '''(kind) => { const t = new Touch({identifier: 1, target: document.body, clientX: 0, clientY: 420});
      document.dispatchEvent(new TouchEvent(kind, {bubbles: true, cancelable: true, touches: [], changedTouches: [t]})); }'''

    def start(tier='standard'):
        page.evaluate("t => { window.__tier = t; window.setEnabled(true); window.setOpen(true); }", tier)
        page.wait_for_timeout(250)
        page.evaluate('() => { window.changes = []; }')

    def drag(x0, dx, steps=8):
        page.evaluate(DRAG, [x0, dx, steps])
        page.wait_for_timeout(30)

    def end(kind):
        page.evaluate(END, kind)

    def check(label, open_):
        page.wait_for_timeout(600)
        st = page.evaluate(STATE)
        assert st['inline'] == '|', (label, 'inline styles left', st)
        assert st['open'] == open_, (label, 'open', st)
        assert (st['right'] > 0) == open_, (label, 'panel on screen', st)
        assert (st['scrim'] > 0) == open_, (label, 'scrim', st)
        return st

    # A release shut, and one that springs back open: both handed back, React told once.
    start(); drag(240, -200); end('touchend')
    assert check('release shut', False)['changes'] == [False]
    start(); drag(240, -40); end('touchend')
    assert check('release open', True)['changes'] == [True]

    # Back while the edge gesture's finger is on the open drawer, then the system cancels the touch:
    # the close stands — the release does not reopen the drawer — and nothing is left behind.
    start(); drag(4, 80); page.evaluate('window.setOpen(false)'); page.wait_for_timeout(200); end('touchcancel')
    st = check('closed during the edge drag', False)
    assert True not in st['changes'], ('reopened by its own release', st)

    # The same with a finger that never ends.
    start(); drag(240, -120); page.evaluate('window.setOpen(false)')
    check('closed, finger never ends', False)
    end('touchend')
    check('the late lift finds nothing to do', False)

    # Closed while a release springs it open: turned round, not reopened.
    start(); drag(240, -40); end('touchend'); page.wait_for_timeout(30); page.evaluate('window.setOpen(false)')
    st = check('closed during the release', False)
    assert st['changes'] == [], ('the release told React after the close', st)

    # A route change that disables the swipe mid-drag (a picture's route) and closes the drawer.
    start(); drag(240, -100); page.evaluate('() => { window.setOpen(false); window.setEnabled(false); }'); end('touchcancel')
    check('disabled and closed mid-drag', False)

    # Disabled mid-drag with the drawer left open (the docked breakpoint): as React has it.
    start(); drag(240, -100); page.evaluate('window.setEnabled(false)'); end('touchcancel')
    check('disabled mid-drag, still open', True)

    # Disabled while a release springs it shut: the shut still lands.
    start(); drag(240, -200); end('touchend'); page.wait_for_timeout(20); page.evaluate('window.setEnabled(false)')
    check('disabled during a closing release', False)

    # 关闭: the release lands at once, and a close from elsewhere still stands.
    start('off'); drag(240, -200); end('touchend')
    check('off: release shut', False)
    start('off'); drag(4, 80); page.evaluate('window.setOpen(false)'); end('touchcancel')
    st = check('off: closed during the drag', False)
    assert True not in st['changes'], st

    assert not errors, errors
    print('PASS: drawer swipe - release shut and open, a close during the drag (cancelled, lifted late, never lifted), a close during a release, disabled mid-drag (closed and open), disabled during a release, off tier')
    browser.close()
`;
try {
  const result = await new Promise((done, reject) => {
    const child = spawn('python', ['-c', python, `http://127.0.0.1:${server.address().port}`], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', done);
  });
  if (result !== 0) process.exitCode = result ?? 1;
} finally {
  server.close();
}
