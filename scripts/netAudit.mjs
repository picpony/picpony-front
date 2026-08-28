/**
 * The request ledger, as a command.
 *
 * Every claim in the data-request work needs one of two numbers behind it: how many requests a
 * screen costs, and how many *rounds* those requests take. Prose cannot hold either — the
 * profile page's three-hop waterfall and the two favourite-list requests that fire for a tab
 * nobody opened were both in shipped code, invisible in review, and obvious the first time
 * anything counted them.
 *
 * So this drives a real browser through a fixed set of journeys and counts. It asserts on
 * **counts and rounds** and merely *reports* wall-clock timings, which is the same split
 * `palette.mjs` draws between a `floor` pair and a `report` pair: a count is a property of the
 * code, a millisecond is a property of the machine and the day.
 *
 * `--write` records the current numbers as the baseline; a plain run compares against it and
 * exits non-zero if any journey got more expensive. That direction is the whole point. Prefetch
 * is allowed to move a request *earlier* and is never allowed to add one, and without a
 * committed baseline "no extra requests" is an intention rather than a check.
 *
 * How it drives the browser is per the project's existing harness note: Edge with
 * `--remote-debugging-port`, the target list from **`/json/list`** rather than `/json/version`
 * (the browser endpoint carries neither `Page` nor `Network`, so enabling them there succeeds
 * and then delivers zero events — a probe that reports "no requests" for a page that loaded
 * fine), and Node's global `WebSocket` so there is no new dependency.
 *
 * Two things it deliberately does not measure:
 *
 * - **Frame rate.** A full-viewport composited transform tops out around 46fps in both headless
 *   and headed Chromium on this machine, so a presented-frame control never reaches 60 and any
 *   figure taken from it would be the machine's rather than the code's.
 * - **Whether the pictures arrived.** Every remote `next/image` 400s in a production build here,
 *   because the hostnames resolve into a fake-IP range and Next 16's `fetchExternalImage` rejects
 *   private IPs. Media requests are counted so a prefetch change cannot quietly multiply them,
 *   and nothing asserts on their status.
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
 * Talk to the real upstream instead of the fixtures.
 *
 * Off by default, and the reason is not that the upstream is down — it answers. It is that a real
 * run is not *comparable* to another real run: `proxyFetch`'s retry ladder turns one logical read
 * into one or three requests depending on which line happens to be reachable, so the count this
 * command asserts on stops being a property of the code. Use it to sanity-check a payload shape or
 * to watch the failover ladder work; never to record a baseline.
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
 * Quiescence: no *new* counted request for this long **and** nothing still in flight.
 *
 * Both halves are load-bearing, and the second one was learned the hard way. With only the idle
 * timer, the first run of this harness reported the home page as three requests and no gallery
 * fetch at all — because `/api.php` through the route handler to the upstream takes longer than
 * the idle window on this machine, so the ledger closed while the policy request was still open
 * and every request that waits on it had not been sent yet. A ledger that stops before the
 * responses arrive measures the *first* round and calls it the whole screen, which is precisely
 * the shape of failure it exists to find.
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
 * The app's data surfaces, and nothing else.
 *
 * A document, a chunk, a font and a stylesheet are all cached by the browser and paid once per
 * session, so counting them would drown the signal this exists to find. The list is the four API
 * lines from `lib/route.ts` plus PicPony's own two endpoints — anything the app can send a *read*
 * to. `/relay` and `/search-api` are ours; the rest are upstream.
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
 * `content` names the request the screen exists to make, and every step that sends any should
 * declare one — it is the only quantity here whose *round* is deterministic, so it is what the
 * baseline holds. It is also the Phase 1 metric: the home feed's own request was gated behind a
 * policy fetch, so this number moves without any count changing.
 *
 * A step that should send **nothing** declares none, and its `api: 0` is the whole assertion.
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
     * A second visit to the same profile, and the step that matters is the third.
     *
     * It goes back through history rather than through a synthesised link, and that is not a
     * stylistic choice — it is the harness's own bug, fixed. The first version built an
     * `<a>` with `document.createElement` and clicked it, which Next does not intercept: only a
     * real `<Link>`'s React handler turns a click into a client navigation. So every "return to
     * the screen" step was a **full document load**, the module-scope caches were thrown away
     * with the page, and the ledger showed a re-entry costing exactly as much as a cold load —
     * which is precisely the claim it was there to test.
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
         as a press would — and then back, which is the cheapest path of all. */
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
      this.pending.set(id, { resolve, reject, method });
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
 * Chrome reads, excluded from the rounds chain.
 *
 * These three fire on every screen in the app and are nobody's causal ancestor — the shell asks for
 * them the moment it mounts, in parallel with whatever the screen is doing. Leaving them in made
 * `contentRound` race: on a client-side navigation to `/`, whether `get_user` happened to *finish*
 * before the gallery pane mounted decided whether the feed read round 1 or round 3, for identical
 * code. Two runs of the same baseline disagreed on exactly that step.
 *
 * `get_maintenance_status` is deliberately **not** in here. `proxyFetch` awaits it before it will
 * send anything, so it is a real ancestor of every Derpibooru read in the app — which is the
 * dependency this whole exercise exists to remove, and therefore the one the number has to show.
 */
const CHROME_READS = new Set(['get_user', 'get_unread_counts', 'get_announcement']);

/**
 * The critical path, in rounds.
 *
 * A request is in round `n + 1` if any request in round `n` had already *finished* when it
 * started. That is a heuristic and worth saying so: two requests that merely happen to be
 * sequential count as two rounds even if nothing forced the order. It is still the number that
 * matters, because the failure it catches — a screen that cannot start its second request until
 * its first came back — looks exactly like that from the outside, and a parallelised screen
 * provably reads 1.
 *
 * **The maximum over a step is reported and never asserted on**, and the reason took two baseline
 * runs to see. A gap threshold was tried first, to stop an idle-scheduled request from inheriting
 * depth it does not owe — the home route mounts its forum pane on an idle callback, so
 * `get_forum_posts` read round 2 in one run and round 3 in the next. The threshold made things
 * worse rather than better: the gap between a policy fetch landing and the effects it unblocks is
 * dominated by *hydration*, not by the response, so a real dependency sat right on the boundary
 * and the same code read 1, 2 or 3 across runs.
 *
 * What is deterministic is the *ordering*, so what gets asserted is the round of one named
 * request per journey — the one the screen exists to make. `contentRound` cannot move without a
 * causal change, and a screen whose own read climbs from round 2 to round 3 has grown a waterfall
 * whatever the scheduler was doing that second.
 */
function computeRounds(entries) {
  const chain = entries.filter((e) => !CHROME_READS.has(e.name));
  const settled = chain.filter((e) => e.end !== undefined).sort((a, b) => a.end - b.end);
  let worst = 0;
  for (const entry of entries) {
    if (CHROME_READS.has(entry.name)) {
      /* Marked rather than skipped, so the ledger still prints a round for every line. `c` reads
         as "chrome" and cannot be confused with a depth. */
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

async function runStep(cdp, step, origin) {
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
  /* Matched on the *name* as well as the href, because a request on the relay or the accel line
     carries its target percent-encoded inside `?url=` — so a pattern like `/search/images` appears
     nowhere in the href, and the content column silently read `—` for the one journey it exists
     to measure. `requestName` has already unwrapped the line. */
  const contentEntry = step.content
    ? api.find((e) => step.content.test(e.name) || step.content.test(e.url.href))
    : undefined;

  return {
    label: step.label,
    api: api.length,
    media: media.length,
    rounds,
    contentRound: contentEntry && typeof contentEntry.round === 'number' ? contentEntry.round : null,
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
 *
 * `STUB_LATENCY_MS` is deliberately non-zero. With instant answers a genuinely parallel pair and a
 * genuinely sequential pair can land in the same millisecond, and the rounds heuristic — which asks
 * whether a request started after another had *finished* — then reads a waterfall as one round. A
 * small uniform delay keeps the causal order legible while leaving a whole journey under a second.
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
             re-entry journey and report a fix nobody made. */
          { name: 'cache-control', value: 'no-store' },
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
 * Reset the device between journeys.
 *
 * The motion tier is pinned because headless Edge reports `prefers-reduced-motion: reduce`, and
 * the tier is resolved once before first paint — so without this every journey runs the reduced
 * branch, which is not the one most users are on and which takes the hero flight (and therefore
 * the whole press-path warming ladder) out of the picture.
 */
async function resetSession(cdp, origin, { auth = false } = {}) {
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Page.navigate', { url: `${origin}/policy` });
  await sleep(600);
  /* The token is a fixture, and that is the point: what an auth'd journey measures is which
     requests a signed-in screen decides to send, not whether a real session would be accepted.
     The stubbed `get_user` answers success, so the shell stays signed in for the whole journey —
     against the live upstream it would 401 and `AppLayout` would clear the session after one
     round, which is why these journeys are stub-only. */
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

/* Not 3100. That port is normally already taken by something of the user's, so `next start` would
   die with EADDRINUSE *and* every probe would hit the other process — which reads as this code
   returning 500. */
const appPort = await freePort();
const debugPort = await freePort();
const upstreamPort = await freePort();
const profileDir = mkdtempSync(path.join(tmpdir(), 'picpony-netaudit-'));
const origin = `http://127.0.0.1:${appPort}`;

/**
 * A fixture backend for the requests that leave from **Node**, not from the browser.
 *
 * CDP's `Fetch` domain intercepts the page's requests and reaches nothing the server does, so
 * without this the one thing `app/layout.tsx` does on the data path — reading the route policy
 * during SSR so the client never has to — could not be measured at all. The audit would sit
 * permanently on the fallback path and report no improvement from the change that removed a request
 * and a round from every screen.
 *
 * `next start` is pointed at it with `PICPONY_UPSTREAM_ORIGIN`. It answers from the same fixture
 * table the browser side uses, so the two halves cannot disagree about what the backend said.
 */
const upstream = createHttpServer((req, res) => {
  const stub = stubFor(`http://127.0.0.1:${upstreamPort}${req.url}`);
  if (!stub) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
if (!LIVE) await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));

/* Node's own binary on Next's CLI entry, not `npx`. On Windows `npx` is a `.cmd`, which Node 24
   refuses to spawn without `shell: true` (EINVAL) — and the shell form concatenates its arguments
   rather than escaping them, which Node deprecates in the same breath (DEP0190). Naming the JS
   file avoids both and needs no shell on any platform. */
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(appPort)], {
  cwd: ROOT,
  stdio: 'ignore',
  env: LIVE
    ? process.env
    : { ...process.env, PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}` },
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

try {
  await waitFor('next start', async () => {
    const res = await fetch(`${origin}/policy`, { redirect: 'manual' });
    return res.status < 500;
  });

  /* The SSR half of the route policy, checked directly rather than only inferred from the ledger.
     A missing inline document is a *silent* regression: the client falls back to fetching the
     policy itself and everything still works, one request and one round more expensive on every
     screen. That is precisely the kind of quiet loss the ledger would show as a number nobody
     looked at, so it gets its own assertion. */
  if (!LIVE) {
    const html = await (await fetch(`${origin}/policy`)).text();
    if (!html.includes('__picponyRoutePolicy')) {
      fail('ssr', 'the document does not carry the inlined route policy — see lib/route.server.ts');
    }
  }
  const target = await waitFor('Edge', async () => {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await res.json();
    /* `/json/list`, and the first `page` target. `/json/version` hands back the *browser*
       endpoint, which carries neither `Page` nor `Network`. */
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
    console.log('  step                 api  media  rounds   content     first');
    const steps = [];
    for (const step of journey.steps) {
      const result = await runStep(cdp, step, origin);
      steps.push(result);
      console.log(
        `  ${result.label.padEnd(20)} ${String(result.api).padStart(3)}  ${String(result.media).padStart(5)}  ` +
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
      contentRound: s.contentRound,
    }));
  }

  if (WRITE && LIVE) {
    fail('harness', '--write refuses --live: a live run\'s counts are not reproducible');
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
        const dApi = step.api - was.api;
        const dRound =
          step.contentRound !== null && was.contentRound !== null
            ? step.contentRound - was.contentRound
            : 0;
        const mark = dApi > 0 || dRound > 0 ? '✗' : dApi < 0 || dRound < 0 ? '↓' : ' ';
        const roundCell =
          was.contentRound === null && step.contentRound === null
            ? 'content —'
            : `content r${was.contentRound ?? '—'}→r${step.contentRound ?? '—'}`;
        console.log(`  ${mark} ${`${name} / ${step.label}`.padEnd(40)} api ${was.api}→${step.api}   ${roundCell}`);
        /* A journey may always get cheaper — that is the work — and may never get dearer, because
           every optimisation here is meant to move a request earlier rather than add one. */
        if (dApi > 0) fail(name, `${step.label} sends ${dApi} more request(s) than the baseline`);
        if (dRound > 0) {
          fail(name, `${step.label}'s own read fell ${dRound} round(s) deeper than the baseline`);
        }
        /* And a floor, which this command learned the hard way. A one-line bug in the resource
           store made every migrated screen stop fetching entirely, and the report above called it
           a triumph — the home page "improved" from five requests to one, the gallery empty behind
           it. An upper bound alone cannot tell an optimisation from a breakage. So: a step that
           read something before must still read something, and a step whose own content request
           was identified before must still identify it. */
        if (was.api > 0 && step.api === 0) {
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
   result — which reads exactly like a probe that is still working. The `exit` handler above does
   the cleanup. The two UI probes already exit this way. */
process.exit(0);
