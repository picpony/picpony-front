/* Cold-load probe: is the content in the first byte, and does React accept the markup? Not a
   checked-in command — a scratch probe alongside `npm run net:audit`, same fixtures. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3944, UP = 3945, CDP = 9333;

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
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${UP}`,
    PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${UP}/api/v1/json`,
  },
});
const until = async (fn, ms = 40000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
if (!(await until(() => fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok)))) throw new Error('no server');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = mkdtempSync(path.join(tmpdir(), 'pp-hyd-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

let page;
if (!(await until(async () => {
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  page = list.find((t) => t.type === 'page');
  return Boolean(page);
}))) throw new Error('no cdp target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const PATTERNS = {
  'image cards': /image-card/g,
  'gallery <img>': /_next\/image\?url/g,
  'profile hero': /profile-hero|data-profile-hero/g,
  'level bar': /aria-label="[^"]*等级|role="progressbar"/g,
  'team rows': /data-team-member|team-member/g,
  'fixture user': /fixture/g,
};

/* Reproduce the reported case: a visitor whose stored image line is *not* the default. Without
   the cookie the server renders the default (proxy) and the client wants direct — a mismatch on
   every server-rendered <img>. */
const forceLine = process.env.PROBE_IMAGE_LINE;
if (forceLine) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await new Promise((r) => setTimeout(r, 2500));
  await send('Runtime.evaluate', { expression: `(() => {
    localStorage.setItem('picpony_use_proxy', 'false');
    localStorage.setItem('trixie_use_cdn', 'false');
    return 1;
  })()`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 1500));
  const ck = await send('Runtime.evaluate', {
    expression: `document.cookie`,
    returnByValue: true,
  });
  console.log('  seeded prefs; cookie =', ck.result?.result?.value);
}

for (const target of process.argv.slice(2)) {
  logs.length = 0;
  const url = `http://127.0.0.1:${PORT}${target}`;
  const html = await (await fetch(url)).text();
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 5000));
  /* Only hydration. Resource 4xx are the documented local constraint (remote `next/image` URLs
     resolve into 198.18/15 and Next's SSRF guard rejects them), and they drown the signal. */  const bad = logs.filter((l) => /hydrat|did not match|server rendered HTML/i.test(l));
  console.log(`\n${target}`);
  console.log(`  html bytes             ${html.length}`);
  for (const [label, re] of Object.entries(PATTERNS)) {
    const n = (html.match(re) || []).length;
    if (n) console.log(`  ${label.padEnd(22)} ${n}`);
  }
  console.log(`  console warnings       ${bad.length}`);
  for (const l of bad.slice(0, 8)) console.log(`    ${l.slice(0, 220)}`);
}

ws.close();
browser.kill();
server.kill();
upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 800);
