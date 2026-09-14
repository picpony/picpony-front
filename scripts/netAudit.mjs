/**
 * The request ledger, as a command.
 *
 * Drives a real browser (Edge over CDP) through a fixed set of journeys and counts requests per
 * step. Asserts **counts and the round of each step's own content request**; wall-clock timings
 * are printed and asserted nowhere — a count is a property of the code, a millisecond is a
 * property of the machine.
 *
 * `--write` records the baseline; a plain run compares against it and exits non-zero if any
 * journey got more expensive. Direction is the point: prefetch may move a request *earlier* and
 * may never add one.
 *
 * Harness notes. Take the target list from **`/json/list`**, not `/json/version` — the browser
 * endpoint carries neither `Page` nor `Network`, so enabling them there succeeds and then delivers
 * zero events (reads as "no requests" for a page that loaded fine). Node's global `WebSocket`, so
 * no new dependency. Two things deliberately not measured: frame rate (presented frames cap at
 * ~46fps here, headless or headed — any figure from it is the machine's), and whether remote
 * pictures arrived (every remote `next/image` 400s here — the hostnames resolve into a fake-IP
 * range and Next rejects private IPs; media requests are counted, their statuses are not).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE_PATH = path.join(import.meta.dirname, 'netAudit.baseline.json');
const WRITE = process.argv.includes('--write');
const KEEP = process.argv.includes('--keep');
/**
 * `--live`: talk to the real upstream instead of the fixtures. Off by default — a real run is
 * not *comparable* to another real run (`proxyFetch`'s retry ladder turns one logical read into
 * one or three depending on which line is reachable), so the asserted count stops being a
 * property of the code. Use for a payload-shape check; never to record a baseline.
 */
const LIVE = process.argv.includes('--live');
const ONLY = (() => {
  const flag = process.argv.find((a) => a.startsWith('--only='));
  return flag ? flag.slice('--only='.length) : null;
})();

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

/**
 * Quiescence: no *new* counted request for this long **and** nothing still in flight. The second
 * half is load-bearing: with only the idle timer, `/api.php` through the route handler outlasted
 * the window, so the ledger closed while the policy request was still open and every request
 * waiting on it had not been sent — the first round was measured and called the whole screen.
 */
const IDLE_MS = 900;
/** A journey may not take longer than this, however busy it looks. */
const STEP_CAP_MS = 25_000;
/** The viewport the journeys run at. Wide enough that the drawer is docked and its links exist. */
const VIEWPORT = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------
// What counts as a request
// ---------------------------------------------------------------------------

/**
 * The app's data surfaces, and nothing else. Documents, chunks, fonts and stylesheets are cached
 * by the browser and paid once per session; counting them drowns the signal. The list is the four
 * API lines from `lib/route.ts` plus PicPony's own two endpoints — anything the app can send a
 * *read* to.
 */
const API_PATTERNS = [
  { label: 'picpony', test: (u) => u.pathname === '/api.php' || u.pathname.startsWith('/api.php/') },
  { label: 'relay', test: (u) => u.pathname === '/relay' },
  { label: 'searchapi', test: (u) => u.pathname.startsWith('/search-api/') },
  { label: 'derpi', test: (u) => /(^|\.)(derpibooru\.org|trixiebooru\.org)$/.test(u.hostname) },
  { label: 'accel', test: (u) => u.hostname === 'picponyapi.147052.xyz' },
];

const MEDIA_PATTERNS = [
  { label: 'derpicdn', test: (u) => /(^|\.)derpicdn\.net$/.test(u.hostname) },
  { label: 'cdn', test: (u) => u.hostname === 'wsrv.nl' },
  { label: 'worker', test: (u) => u.hostname === '147052.xyz' },
  { label: 'next-image', test: (u) => u.pathname === '/_next/image' },
  { label: 'asset', test: (u) => /(^|\.)picpony\.top$/.test(u.hostname) },
];

function classify(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const p of API_PATTERNS) if (p.test(url)) return { kind: 'api', label: p.label, url };
  for (const p of MEDIA_PATTERNS) if (p.test(url)) return { kind: 'media', label: p.label, url };
  return null;
}

/** The PicPony action, or the Derpibooru path — what a row in the ledger is called. */
function requestName(entry) {
  const { url, label } = entry;
  if (label === 'picpony') return url.searchParams.get('action') ?? 'api.php';
  if (label === 'relay' || label === 'accel') {
    const inner = url.searchParams.get('url');
    if (inner) {
      try {
        return `→ ${new URL(inner).pathname.replace('/api/v1/json', '')}`;
      } catch {
        /* not a URL */
      }
    }
    return label;
  }
  if (label === 'derpi') return url.pathname.replace('/api/v1/json', '');
  return url.pathname;
}

// ---------------------------------------------------------------------------
// The journeys
// ---------------------------------------------------------------------------

/**
 * `content` names the request the screen exists to make — the only quantity whose *round* is
 * deterministic, so it is what the baseline holds. A step that should send nothing declares none,
 * and its `api: 0` is the whole assertion.
 */
const GALLERY = /\/search\/images/;

const JOURNEYS = [
  {
    name: 'cold home',
    why: 'the first paint everyone pays for',
    steps: [{ label: 'GET /', navigate: '/', content: GALLERY }],
  },
  {
    name: 'home → forum tab',
    why: 'the forum pane is mounted on idle, so the switch should cost nothing',
    steps: [
      { label: 'GET /', navigate: '/', content: GALLERY },
      { label: 'tap 论坛', click: '[data-tab-row] [role="tab"]:nth-of-type(2), a[href="/?tab=forum"]' },
    ],
  },
  {
    name: 'home → search → back',
    why: 'a screen you were just looking at must not reload',
    steps: [
      { label: 'GET /', navigate: '/', content: GALLERY },
      { label: '→ /search', click: 'a[href="/search"]' },
      { label: '← back', back: true },
    ],
  },
  {
    name: 'cold profile',
    why: 'the waterfall: profile → shared faves → images, plus two requests for an unopened tab',
    steps: [{ label: 'GET /user/1', navigate: '/user/1', content: /get_user_uploads/ }],
  },
  {
    /**
     * The re-entry step must go **back through history**, not through a synthesised link: a
     * clicked `createElement('a')` is not intercepted by Next — only a real `<Link>`'s handler
     * navigates — so the synthetic form was a full document load that threw away every
     * module-scope cache, making a re-entry cost exactly what a cold load costs.
     */
    name: 'profile → back → profile',
    why: 'a second visit to the same profile must cost nothing',
    steps: [
      { label: 'GET /user/1', navigate: '/user/1', content: /get_user_uploads/ },
      { label: '→ /', click: 'a[href="/"]', content: GALLERY },
      { label: '← back', back: true },
    ],
  },
  {
    name: 'cold about',
    why: 'one read, no auth — the floor for any screen',
    steps: [{ label: 'GET /about', navigate: '/about', content: /get_team_members/ }],
  },
  {
    name: 'cold policy',
    why: 'a static screen; every request it makes is shell overhead',
    steps: [{ label: 'GET /policy', navigate: '/policy' }],
  },
  {
    name: 'cold favorites',
    why: 'two panes, and the unselected one should not fetch',
    auth: true,
    steps: [{ label: 'GET /favorites', navigate: '/favorites', content: GALLERY }],
  },
  {
    name: 'favorites → back → favorites',
    why: 'the screen that had no snapshot at all',
    auth: true,
    steps: [
      { label: 'GET /favorites', navigate: '/favorites', content: GALLERY },
      { label: '→ /', click: 'a[href="/"]', content: GALLERY },
      /* Forward again through the sidebar's real `<Link>`, so the intent ladder on it runs exactly
         as a press would — then back, the cheapest path of all. */
      { label: '→ /favorites', click: 'a[href="/favorites"]', content: GALLERY },
      { label: '← back', back: true },
    ],
  },
  {
    name: 'cold history',
    why: 'one paged read behind the shell',
    auth: true,
    steps: [{ label: 'GET /history', navigate: '/history', content: /get_browsing_history/ }],
  },
  {
    name: 'cold tasks',
    why: 'one read; the floor for a signed-in screen',
    auth: true,
    steps: [{ label: 'GET /tasks', navigate: '/tasks', content: /get_tasks/ }],
  },
  {
    name: 'cold messages',
    why: 'reads for three tabs when one is selected, and the shell polls unread four times',
    auth: true,
    steps: [{ label: 'GET /messages', navigate: '/messages', content: /get_announcement_history/ }],
  },
];

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${label} did not come up within ${timeoutMs}ms`);
    await sleep(200);
  }
}

/** See `Cdp.send`. Long enough for a cold navigate, short enough to fail rather than hang. */
const CDP_SEND_TIMEOUT_MS = 60_000;

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
        return;
      }
      for (const handler of this.handlers) handler(message);
    });
    socket.addEventListener('close', () => {
      const waiting = [...this.pending.values()];
      this.pending.clear();
      for (const entry of waiting) {
        entry.reject(new Error(`${entry.method}: CDP socket closed`));
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      /* Bounded as well as close-aware: a command the browser never answers is the other way
         this used to hang. Generous — a cold `Page.navigate` on a slow machine is seconds. */
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`${method}: no CDP response in ${CDP_SEND_TIMEOUT_MS}ms`));
      }, CDP_SEND_TIMEOUT_MS);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw');
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

// ---------------------------------------------------------------------------
// A ledger for one step
// ---------------------------------------------------------------------------

/**
 * Chrome reads, excluded from the rounds chain: they fire on every screen in parallel with
 * whatever it is doing, so leaving them in made `contentRound` race (the same code read 1, 2 or
 * 3 across runs). `get_maintenance_status` is deliberately NOT here — `proxyFetch` awaits it
 * before sending anything, so it is a real ancestor of every Derpibooru read and the number has
 * to show that dependency.
 */
const CHROME_READS = new Set(['get_user', 'get_unread_counts', 'get_announcement']);

/**
 * The critical path, in rounds: a request is in round `n + 1` if any request in round `n` had
 * *finished* when it started. A heuristic (merely sequential reads count as rounds) but the
 * number that matters — it is what catches a screen that cannot start its second request until
 * its first came back.
 *
 * The maximum over a step is reported and never asserted: an idle-scheduled request inherits
 * depth it does not owe, and a gap threshold made that worse, because the gap between a policy
 * fetch landing and the effects it unblocks is dominated by hydration. What is deterministic is
 * the ordering, so what gets asserted is the round of the step's own `content` request.
 */
function computeRounds(entries) {
  const chain = entries.filter((e) => !CHROME_READS.has(e.name));
  const settled = chain.filter((e) => e.end !== undefined).sort((a, b) => a.end - b.end);
  let worst = 0;
  for (const entry of entries) {
    if (CHROME_READS.has(entry.name)) {
      /* Marked rather than skipped, so every ledger line prints a round. `c` = chrome. */
      entry.round = 'c';
      continue;
    }
    let depth = 1;
    for (const earlier of settled) {
      if (earlier === entry) continue;
      if (earlier.end > entry.start) break;
      depth = Math.max(depth, (typeof earlier.round === 'number' ? earlier.round : 1) + 1);
    }
    entry.round = depth;
    worst = Math.max(worst, depth);
  }
  return worst;
}

async function runStep(cdp, step, origin, serverReads) {
  const entries = [];
  const byId = new Map();
  let lastAt = 0;
  const t0 = performance.now();

  const off = cdp.on((message) => {
    if (message.method === 'Network.requestWillBeSent') {
      const { requestId, request, timestamp } = message.params;
      const hit = classify(request.url);
      if (!hit) return;
      const entry = {
        ...hit,
        id: requestId,
        method: request.method,
        name: requestName(hit),
        start: timestamp,
        at: performance.now() - t0,
      };
      entries.push(entry);
      byId.set(requestId, entry);
      lastAt = performance.now();
      return;
    }
    if (
      message.method === 'Network.loadingFinished' ||
      message.method === 'Network.loadingFailed'
    ) {
      const entry = byId.get(message.params.requestId);
      if (!entry) return;
      entry.end = message.params.timestamp;
      entry.failed = message.method === 'Network.loadingFailed';
      lastAt = performance.now();
      return;
    }
    if (message.method === 'Network.responseReceived') {
      const entry = byId.get(message.params.requestId);
      if (entry) entry.status = message.params.response.status;
    }
  });

  try {
    if (step.navigate) {
      await cdp.send('Page.navigate', { url: `${origin}${step.navigate}` });
    } else if (step.click) {
      const clicked = await cdp.evaluate(
        `(() => {
           const el = document.querySelector(${JSON.stringify(step.click)});
           if (!el) return false;
           el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
           el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }));
           el.click();
           return true;
         })()`,
      );
      if (!clicked) throw new Error(`no element matched ${step.click}`);
    } else if (step.back) {
      await cdp.evaluate('history.back()');
    }

    lastAt = performance.now();
    const cap = performance.now() + STEP_CAP_MS;
    for (;;) {
      await sleep(120);
      if (performance.now() >= cap) break;
      const inFlight = entries.some((e) => e.end === undefined);
      if (!inFlight && performance.now() - lastAt >= IDLE_MS) break;
    }
  } finally {
    off();
  }

  const api = entries.filter((e) => e.kind === 'api');
  const media = entries.filter((e) => e.kind === 'media');
  const rounds = computeRounds(api);
  /* Matched on the *name* as well as the href: a request on the relay or accel line carries its
     target percent-encoded inside `?url=`, so the pattern appears nowhere in the href. */
  const contentEntry = step.content
    ? api.find((e) => step.content.test(e.name) || step.content.test(e.url.href))
    : undefined;

  /* Reads the *server* made during this step — the caller empties the tally before each one.
     `r0` ("content was in the first byte") is what keeps the floor meaningful: the read moved
     from the browser to the server, it did not disappear. */
  const serverApi = serverReads ? serverReads.slice() : [];
  /* `r0` is only offered to a step that **navigated** (navigate/click/back), and only when the
     browser sent nothing matching. Without the navigation test any server read landing in the
     window could satisfy the content regex, and a screen that had stopped fetching could be
     scored as an improvement — the one thing the floor exists to catch. */
  const changesRoute = Boolean(step.navigate || step.click || step.back);
  const serverContent =
    step.content && changesRoute && !contentEntry
      ? serverApi.some((action) => step.content.test(action))
      : false;

  return {
    label: step.label,
    api: api.length,
    media: media.length,
    serverApi: serverApi.length,
    rounds,
    contentRound:
      contentEntry && typeof contentEntry.round === 'number'
        ? contentEntry.round
        : serverContent
          ? 0
          : null,
    firstApiMs: api.length ? Math.round(Math.min(...api.map((e) => e.at))) : null,
    contentMs: contentEntry ? Math.round(contentEntry.at) : null,
    entries: api.map((e) => ({
      name: e.name,
      label: e.label,
      host: e.url.hostname,
      round: e.round,
      at: Math.round(e.at),
      status: e.status ?? (e.failed ? 'failed' : '—'),
    })),
  };
}

// ---------------------------------------------------------------------------
// The stubbed upstream
// ---------------------------------------------------------------------------

/**
 * Every data request answered from `netAuditFixtures.mjs`; everything else passed through.
 * `STUB_LATENCY_MS` is deliberately non-zero: with instant answers a genuinely parallel pair and
 * a genuinely sequential pair can land in the same millisecond, and the rounds heuristic then
 * reads a waterfall as one round.
 */
const STUB_LATENCY_MS = 30;

async function installStubs(cdp) {
  cdp.on(async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const stub = stubFor(request.url);
    try {
      if (!stub) {
        await cdp.send('Fetch.continueRequest', { requestId });
        return;
      }
      await sleep(STUB_LATENCY_MS);
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: stub.contentType },
          /* The app's reads are `no-store`, but a stub with no cache header at all lets the browser
             heuristically cache one — which would silently remove the second request of a
             re-entry journey and report a fix nobody made. */          { name: 'cache-control', value: 'no-store' },
          { name: 'access-control-allow-origin', value: '*' },
        ],
        body: stub.binary ? stub.body : Buffer.from(stub.body, 'utf8').toString('base64'),
      });
    } catch {
      /* A paused request whose frame navigated away is gone; nothing to answer. */
    }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
}

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------

/**
 * Reset the device between journeys. Motion is pinned because headless Edge reports
 * `prefers-reduced-motion: reduce`, and the tier is resolved before first paint — without this
 * every journey runs the reduced branch, which is not the one most users are on.
 */
async function resetSession(cdp, origin, { auth = false } = {}) {
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Page.navigate', { url: `${origin}/policy` });
  await sleep(600);
  /* The token is a fixture on purpose: what an auth'd journey measures is which requests a
     signed-in screen decides to send, not whether a real session would be accepted. The stubbed
     `get_user` answers success, so the shell stays signed in — against the live upstream it
     would 401 and clear the session, which is why these journeys are stub-only. */
  const session = JSON.stringify({
    token: 'netaudit-fixture-token',
    id: 1,
    username: 'fixture',
    api_key: 'netaudit-fixture-key',
    role: 'user',
  });
  await cdp.evaluate(
    `(() => {
       localStorage.clear();
       sessionStorage.clear();
       localStorage.setItem('picpony_motion', 'standard');
       ${auth ? `localStorage.setItem('user_info', ${JSON.stringify(session)});` : ''}
       return true;
     })()`,
  );
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const failures = [];
const fail = (where, message) => failures.push(`[${where}] ${message}`);

if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('net:audit needs a production build. Run `npm run build` first.');
  process.exit(1);
}

const edge = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
if (!edge) {
  console.error(`No Edge found. Looked in:\n  ${EDGE_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

/* Free port, not 3100: a taken port would kill `next start` with EADDRINUSE *and* send every
   probe to the other process, which reads as this code returning 500. */
const appPort = await freePort();
const debugPort = await freePort();
const upstreamPort = await freePort();
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-netaudit-'));
const origin = `http://127.0.0.1:${appPort}`;

/**
 * A fixture backend for the requests that leave from **Node**, not from the browser.
 *
 * CDP's `Fetch` domain intercepts the page's requests and reaches nothing the server does, so the
 * SSR route-policy read in `app/layout.tsx` is invisible to it — without this the audit would sit
 * permanently on the fallback path. `next start` is pointed here with `PICPONY_UPSTREAM_ORIGIN`,
 * and the same fixture table answers both halves so they cannot disagree.
 *
 * `serverReads` is the tally the `srv` column reads: the assertions have a **floor** as well as a
 * ceiling, and a read moved to the server vanishes from CDP's view — the tally is what keeps the
 * floor meaning "a step that read something must still read something, anywhere".
 */
const serverReads = [];
const upstream = createHttpServer((req, res) => {
  /* Two kinds of server-side read reach this one fixture: PicPony's own actions as
     `/api.php?action=…` (matched on the path) and a Derpibooru read as `/api/v1/json/…`
     (`PICPONY_DERPI_ORIGIN` points here; matched on hostname, so re-addressed to the real one). */
  const asUpstream = req.url?.startsWith('/api/v1/json')
    ? `https://trixiebooru.org${req.url}`
    : `http://127.0.0.1:${upstreamPort}${req.url}`;
  const stub = stubFor(asUpstream);
  if (!stub) {
    res.writeHead(404).end();
    return;
  }
  /* Recorded before the response, so a read still in flight when a step ends is still counted. */
  const action = /[?&]action=([^&]+)/.exec(req.url ?? '')?.[1] ?? req.url ?? '';
  /* `get_maintenance_status` excluded for the same reason `CHROME_READS` excludes `get_user`:
     the server does it on every route, so counting it would make `serverApi` a function of how
     many navigations a journey contains rather than of what moved to the server. */
  if (action !== 'get_maintenance_status') serverReads.push(action);
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
if (!LIVE) await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

/* Node's own binary on Next's CLI entry, not `npx`: on Windows `npx` is a `.cmd`, which Node 24
   refuses to spawn without `shell: true` (EINVAL), and the shell form concatenates its arguments
   (DEP0190). Naming the JS file avoids both. */
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(appPort)], {
  cwd: ROOT,
  stdio: 'ignore',
  env: LIVE
    ? process.env
    : {
        ...process.env,
        PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
        PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${upstreamPort}/api/v1/json`,
        /* Every server-side memo cold, so the ledger measures the path that costs something. Warm,
           the second journey to open a screen reads nothing on either layer — indistinguishable
           from a screen that stopped loading. Reaches both caches (`lib/serverMemo.ts`). */
        PICPONY_SERVER_MEMO_TTL_MS: '0',
      },
});
const browser = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
const cleanup = () => {
  cdp?.close();
  browser.kill();
  server.kill();
  upstream.close();
  if (!KEEP) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Windows sometimes holds the profile briefly. It is in the temp dir either way. */
    }
  }
};
process.on('exit', cleanup);
/* Node does not emit `exit` for signal termination, so without these a Ctrl-C during the
   four-minute run orphans `next start`, a headless Edge, the fixture server and the temp
   profile — and this harness binds random ports, so the orphans poison the pool rather than
   just the next run. */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

try {
  await waitFor('next start', async () => {
    const res = await fetch(`${origin}/policy`, { redirect: 'manual' });
    return res.status < 500;
  });

  /* The SSR half of the route policy, checked directly: a missing inline document is a *silent*
     regression — the client falls back to fetching the policy and everything still works, one
     request and one round more expensive on every screen. */
  if (!LIVE) {
    const html = await (await fetch(`${origin}/policy`)).text();
    if (!html.includes('__picponyRoutePolicy')) {
      fail('ssr', 'the document does not carry the inlined route policy — see lib/route.server.ts');
    }
  }
  const target = await waitFor('Edge', async () => {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await res.json();
    return list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
  });

  cdp = await Cdp.connect(target);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  if (!LIVE) await installStubs(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const journeys = JOURNEYS.filter((j) => !ONLY || j.name.includes(ONLY));
  const results = {};

  console.log(
    `\nnet:audit — ${origin}, ${VIEWPORT.width}x${VIEWPORT.height}, motion pinned standard, ` +
      `${LIVE ? 'LIVE upstream (counts are not comparable)' : `stubbed upstream +${STUB_LATENCY_MS}ms`}`,
  );

  for (const journey of journeys) {
    if (journey.auth && LIVE) {
      console.log(`\n${journey.name}  — skipped: an auth'd journey needs the stubbed session`);
      continue;
    }
    await resetSession(cdp, origin, { auth: journey.auth });
    console.log(`\n${journey.name}  — ${journey.why}${journey.auth ? '  [signed in]' : ''}`);
    console.log('  step                 api  srv  media  rounds   content     first');
    const steps = [];
    for (const step of journey.steps) {
      /* Emptied per step, so the column is what *this* step cost. It was cumulative — which is
         not merely confusing: `serverContent` tests this list to classify a step's content as
         `r0`, so a read one screen made would mark a later screen's content as "already in the
         first byte", the floor passing on a step that had stopped fetching. Reads still in flight
         from the previous step land here; that jitter is why `serverApi` is reported rather than
         asserted. */
      serverReads.length = 0;
      const result = await runStep(cdp, step, origin, LIVE ? null : serverReads);
      if (!LIVE) {
        const filterReads = serverReads.filter((name) => name === 'get_block_tags').length;
        if (filterReads > 1) fail(journey.name, `${result.label} duplicated the public filter-definition read`);
        if (step.navigate && filterReads === 0) {
          fail(journey.name, `${result.label} did not read the public filter definitions`);
        }
      }
      steps.push(result);
      console.log(
        `  ${result.label.padEnd(20)} ${String(result.api).padStart(3)}  ${String(result.serverApi).padStart(3)}  ${String(result.media).padStart(5)}  ` +
          `${String(result.rounds).padStart(6)}  ` +
          `${(result.contentRound === null ? '—' : `r${result.contentRound} ${result.contentMs}ms`).padStart(9)}  ` +
          `${(result.firstApiMs === null ? '—' : `${result.firstApiMs}ms`).padStart(7)}`,
      );
      for (const entry of result.entries) {
        console.log(
          `      r${entry.round} ${String(entry.at).padStart(5)}ms  ${String(entry.status).padStart(4)}  ` +
            `${entry.label.padEnd(9)} ${entry.name}`,
        );
      }
    }
    /* `rounds` is deliberately absent from the record. It is reported above and asserted nowhere —
       see `computeRounds` for why the maximum cannot be held to a number. */
    results[journey.name] = steps.map((s) => ({
      label: s.label,
      api: s.api,
      media: s.media,
      /* Reads the *server* made for this step. Recorded so the floor below can be asserted on
         `api + serverApi`: moving a read to the server must not read as the screen having
         stopped loading. */
      serverApi: s.serverApi,
      contentRound: s.contentRound,
    }));
  }

  if (WRITE && LIVE) {
    fail('harness', '--write refuses --live: a live run\'s counts are not reproducible');
  } else if (WRITE && ONLY) {
    /* Or the baseline is silently truncated to whatever `--only` selected, and the next full
       run prints “new journey, nothing to compare” for everything that was dropped and exits
       0 — the whole ledger gone, reported as a pass. */
    fail('harness', '--write refuses --only: it would truncate the baseline to the filtered set');
  } else if (WRITE) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nbaseline written — ${path.relative(ROOT, BASELINE_PATH)}`);
  } else if (LIVE) {
    console.log('\nlive run — ledger only, nothing compared');
  } else if (!existsSync(BASELINE_PATH)) {
    console.log('\nno baseline yet; run `npm run net:audit -- --write` to record one');
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    console.log('\nagainst the baseline');
    for (const [name, steps] of Object.entries(results)) {
      const before = baseline[name];
      if (!before) {
        console.log(`  ${name.padEnd(26)} new journey, nothing to compare`);
        continue;
      }
      for (const [index, step] of steps.entries()) {
        const was = before[index];
        if (!was || was.label !== step.label) {
          console.log(`  ${name} / ${step.label}: shape changed, re-record the baseline`);
          continue;
        }
        /* Both layers asserted. The ceiling is applied twice — to browser requests (what a user
           waits on) and to the total, because "move a request earlier, never add one" is a rule
           about requests, not about which process sends them. The floor is applied to the total,
           because a read moved to the server looks identical to a stopped screen from CDP alone.
           Two consecutive runs are byte-identical now that the tally is per-step and
           `PICPONY_SERVER_MEMO_TTL_MS=0` reaches both caches (Next's Data Cache persists to
           `.next/cache/fetch-cache`). */
        const dApi = step.api - was.api;
        const wasTotal = was.api + (was.serverApi ?? 0);
        const stepTotal = step.api + (step.serverApi ?? 0);
        const dRound =
          step.contentRound !== null && was.contentRound !== null
            ? step.contentRound - was.contentRound
            : 0;
        const mark = dApi > 0 || dRound > 0 ? '✗' : dApi < 0 || dRound < 0 ? '↓' : ' ';
        const roundCell =
          was.contentRound === null && step.contentRound === null
            ? 'content —'
            : `content r${was.contentRound ?? '—'}→r${step.contentRound ?? '—'}`;
        /* `browser+server` when either side has a server read, so a step whose content moved
           layers reads as such at a glance. The server half is reported, never asserted — see the
           split above. */
        const apiCell =
          (was.serverApi ?? 0) || step.serverApi
            ? `api ${was.api}+${was.serverApi ?? 0}→${step.api}+${step.serverApi}`
            : `api ${was.api}→${step.api}`;
        console.log(`  ${mark} ${`${name} / ${step.label}`.padEnd(40)} ${apiCell.padEnd(20)} ${roundCell}`);
        /* A journey may always get cheaper — that is the work — and may never get dearer, because
           every optimisation here is meant to move a request earlier rather than add one. */
        if (dApi > 0) fail(name, `${step.label} sends ${dApi} more request(s) than the baseline`);
        if (stepTotal > wasTotal) {
          fail(
            name,
            `${step.label} costs ${stepTotal - wasTotal} more request(s) than the baseline across both layers`,
          );
        }
        if (dRound > 0) {
          fail(name, `${step.label}'s own read fell ${dRound} round(s) deeper than the baseline`);
        }
        /* And a floor: a step that read something before must still read something, and a step
           whose own content request was identified before must still identify it. An upper bound
           alone cannot tell an optimisation from a breakage.
           `srv` deliberately cannot satisfy the floor on its own: a step's server tally picks up
           reads no part of that screen asked for (Next prefetches the sidebar's account link, so
           unrelated screens carry a `get_user_profile`). Keyed on `api + srv` those steps could
           stop fetching entirely and still pass — measured. A matching content read at r0 is
           different: it proves this very screen loaded its content on the server. In that case
           an idle announcement missing the observation window cannot make the screen fail. */
        if (was.api > 0 && step.api === 0 && step.contentRound !== 0) {
          fail(name, `${step.label} now sends no browser requests at all — the screen is not loading`);
        } else if (wasTotal > 0 && stepTotal === 0) {
          fail(name, `${step.label} now sends no requests at all — the screen is not loading`);
        }
        if (was.contentRound !== null && step.contentRound === null) {
          fail(name, `${step.label} no longer sends its own read at all`);
        }
      }
    }
  }
} catch (error) {
  fail('harness', error.message);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('\nall checks passed');
/* Explicit, because falling off the end does not end this process: the CDP socket is open and two
   children are alive, so the event loop never drains and the command hangs after printing its
   result. The `exit` handler above does the cleanup. */
process.exit(0);
