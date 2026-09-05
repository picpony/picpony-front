/* `npm run net:tabnav` — tap a tab, open a thread after a configurable gap, press back. Prints
   the URL, the selected tab, the showing pane, history calls and console output at each step. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3956, UP = 3957, CDP = 9343;

const upstream = createServer((req, res) => {
  const asUpstream = req.url?.startsWith('/api/v1/json')
    ? `https://trixiebooru.org${req.url}`
    : `http://127.0.0.1:${UP}${req.url}`;
  const stub = stubFor(asUpstream);
  if (!stub) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));

const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env,
    PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${UP}`,
    PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${UP}/api/v1/json` },
});
const until = async (fn, ms = 40000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
};
if (!(await until(() => fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok)))) throw new Error('no server');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = mkdtempSync(path.join(tmpdir(), 'pp-back-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, `--window-size=${process.argv[2] ?? 1280},900`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let page;
if (!(await until(async () => {
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  page = list.find((t) => t.type === 'page');
  return Boolean(page);
}))) throw new Error('no cdp');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
};
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');

const STATE = `(() => {
  const tabs = [...document.querySelectorAll('[role="tab"], [role="tablist"] [data-tab]')]
    .map((t) => ({ tab: t.dataset.tab, selected: t.getAttribute('aria-selected') }));
  const panes = [...document.querySelectorAll('[data-tab-pane]')].map((p) => ({
    pane: p.dataset.tabPane,
    active: p.hasAttribute('data-tab-pane-active'),
    display: getComputedStyle(p).display,
    h: Math.round(p.getBoundingClientRect().height),
  }));
  return { url: location.pathname + location.search, tabs, panes };
})()`;

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
await evalIn(`localStorage.setItem('picpony_motion','standard'); 1`);
const CONTROL = process.argv[5] === 'control';
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${CONTROL ? '?tab=forum' : ''}` });
await new Promise((r) => setTimeout(r, 4500));
console.log('A. cold              ', JSON.stringify(await evalIn(STATE)));

/* Hook the history API so a push that is *made* and a push that *lands* can be told apart. */await evalIn(`window.__control = ${CONTROL}; 1`);
await evalIn(`(() => {
  window.__hist = [];
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k].bind(history);
    history[k] = (a, b, url) => { window.__hist.push([k, String(url), Math.round(performance.now())]); return orig(a, b, url); };
  }
  window.__t0 = performance.now();
  window.__clicks = [];
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a,button') : null;
    window.__clicks.push({
      at: Math.round(performance.now()),
      tag: a?.tagName, href: a?.getAttribute('href'),
      phase: 'capture', prevented: e.defaultPrevented,
    });
  }, true);
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a,button') : null;
    window.__clicks.push({
      at: Math.round(performance.now()),
      tag: a?.tagName, href: a?.getAttribute('href'),
      phase: 'bubble', prevented: e.defaultPrevented,
    });
  });
  window.onerror = (m) => { window.__clicks.push({ error: String(m).slice(0, 120) }); };
  const t = [...document.querySelectorAll('[data-tab]')].find((e) => e.dataset.tab === 'forum');
  if (!window.__control) t?.click();
  return 1;
})()`);
/* Gap between the tab tap and opening a thread. `TAB_PUSH_COALESCE_MS` is 728ms at the slow
   speed scale, so a shorter gap opens the thread before the coalesced tab push has landed. */
await new Promise((r) => setTimeout(r, Number(process.argv[4] ?? 2500)));
console.log('B. tapped 论坛        ', JSON.stringify(await evalIn(STATE)));

const opened = await evalIn(`(() => {
  const pane = document.querySelector('[data-tab-pane="forum"]');
  const row = pane?.querySelector('a[href^="/forum/"]');
  if (!row) return 'no forum row';
  row.click();
  return row.getAttribute('href');
})()`);
console.log('C. clicked row        ', opened);
console.log('   history calls       ', JSON.stringify(await evalIn('window.__hist')));
console.log('   clicks              ', JSON.stringify(await evalIn('window.__clicks')));
console.log('   offline banner?     ', await evalIn(
  `Boolean([...document.querySelectorAll('[role="status"]')].find((e) => (e.textContent||'').includes('网络不可用')))`));
for (let i = 0; i < 8; i += 1) {
  await new Promise((r) => setTimeout(r, 300));
  console.log(`   +${(i + 1) * 300}ms  ` + (await evalIn('location.pathname + location.search'))
    + '   hist=' + JSON.stringify(await evalIn('window.__hist')));
}

/* The page's own control, not `history.back()` — that is what a user presses. */
const backKind = process.argv[3] ?? 'button';
if (backKind === 'button') {
  const clicked = await evalIn(`(() => {
    const b = [...document.querySelectorAll('button, a')].find((e) =>
      (e.getAttribute('aria-label') || e.textContent || '').includes('返回论坛'));
    if (!b) return 'no back control';
    b.click();
    return b.tagName + ':' + (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 12);
  })()`);
  console.log('   back control       ', clicked);
} else {
  await evalIn(`history.back(); 1`);
}
await new Promise((r) => setTimeout(r, 3500));
console.log('D. after back        ', JSON.stringify(await evalIn(STATE)));

console.log('\nconsole:');
for (const l of logs.slice(0, 12)) console.log('  ' + l.slice(0, 200));

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
