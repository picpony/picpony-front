/* What is actually on screen during a gallery page turn: scroll offset, how many cards exist,
   and how many of them have a decoded image inside the viewport. Scratch probe. */import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3958, UP = 3959, CDP = 9345;

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
const profile = mkdtempSync(path.join(tmpdir(), 'pp-page-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

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
const onEvent = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method) onEvent.forEach((fn) => fn(msg));
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

/* Stub the BROWSER's reads too, not only the server's. The env vars redirect what the Next
   server fetches — but page 2 is read by the *browser*, through `proxyFetch`, and those went to
   the real derpibooru: the read never landed, `keepPrevious` held page 1, and the probe measured
   a page turn that never happened while still reporting "none was blank". Same shape as
   `npm run net:audit`, whose fixtures these are. */
onEvent.push(async (msg) => {
  if (msg.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = msg.params;
  /* A relay or proxy line carries the real target in `?url=`; `stubFor` wants that, not the
     wrapper. */  let target = request.url;
  try {
    const inner = new URL(request.url).searchParams.get('url');
    if (inner) target = inner;
  } catch {
    /* Not a parseable URL; fall through with the raw one. */
  }
  const stub = stubFor(target);
  try {
    if (!stub) {
      await send('Fetch.continueRequest', { requestId });
      return;
    }
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: stub.contentType },
        { name: 'cache-control', value: 'no-store' },
        { name: 'access-control-allow-origin', value: '*' },
      ],
      body: stub.binary ? stub.body : Buffer.from(stub.body, 'utf8').toString('base64'),
    });
  } catch {
    /* A paused request whose frame navigated away is gone; nothing to answer. */
  }
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
await evalIn(`localStorage.setItem('picpony_motion','standard'); 1`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
/* Short wait: the entrance cascade is sampled at the top of the evaluated block, and a long wait
   would let it finish unobserved. The block does its own settling before clicking. */
await new Promise((r) => setTimeout(r, 900));

const out = await evalIn(`(async () => {
  const sc = document.querySelector('[data-image-hero-gallery-scroll]');
  if (!sc) return 'no scroller';

  /* Was any card hidden after this load had painted? A guard for the ordering bug that removed
     the entrance cascade: the hook's component must be a sibling *after* the ref'd grid, because
     React attaches a parent's ref only after its children's layout effects run. Rendered inside
     the grid it read a null ref, skipped, and never re-ran — no entrance on load, and the first
     pass that found a root was a page turn, which put a blank screen under the glide. */
  const cascadeSeen = await (async () => {
    const start = performance.now();
    while (performance.now() - start < 6000) {
      const hit = [...document.querySelectorAll('.image-card')].some((c) => {
        const cs = getComputedStyle(c);
        return cs.visibility === 'hidden' || Number(cs.opacity) <= 0.05;
      });
      if (hit) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return false;
  })();

  /* Now settle, then go to the bottom — after the cascade has been observed. */
  await new Promise((r) => setTimeout(r, 3500));
  sc.scrollTop = sc.scrollHeight;
  await new Promise((r) => setTimeout(r, 700));

  await new Promise((r) => setTimeout(r, 900));
  const buttons = [...document.querySelectorAll('button')];
  const pager = buttons.filter((b) => b.closest('nav, [aria-label*="分页"], [role="navigation"]'));
  const next = buttons.find((b) => (b.getAttribute('aria-label') || '').includes('下一页'))
    ?? buttons.find((b) => b.textContent.trim() === '2');
  if (!next) {
    return 'no next control; buttons=' + JSON.stringify(buttons.slice(0, 40).map((b) =>
      (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 14)));
  }
  window.__nextLabel = (next.getAttribute('aria-label') || next.textContent || '').trim();
  window.__pagerCount = pager.length;

  const sample = () => {
    const vh = sc.clientHeight, top = sc.getBoundingClientRect().top;
    const cards = [...document.querySelectorAll('.image-card')];
    let inView = 0, shimmering = 0, failed = 0, visible = 0, bare = 0, hidden = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.bottom < top || r.top > top + vh) continue;
      inView++;
      /* The CARD's own visibility, before anything about its contents. The entrance cascade
         sets GSAP autoAlpha on .image-card (opacity plus visibility:hidden), so a card parked at
         the head of the stagger holds a perfectly good shimmer inside a box that paints nothing.
         Testing the img and taking the shimmer as proof of life is how this probe passed while a
         page turn showed a blank screen. (No backticks: inside a template literal.) */
      const cs = getComputedStyle(c);
      if (cs.visibility === 'hidden' || Number(cs.opacity) <= 0.05) {
        hidden++;
        if (!window.__diag) {
          window.__diag = {
            inline: c.getAttribute('style'),
            opacity: cs.opacity,
            visibility: cs.visibility,
            contentVisibility: cs.contentVisibility,
            cls: c.className,
            parentInline: c.parentElement?.getAttribute('style'),
            parentCls: c.parentElement?.className,
            anim: (c.getAnimations ? c.getAnimations().length : -1),
            href: c.querySelector('a[href^="/pic/"]')?.getAttribute('href'),
            at: Math.round(performance.now()),
          };
        }
        continue;
      }
      if (c.querySelector('.skeleton, [class*="skeleton"]')) { shimmering++; continue; }
      const img = c.querySelector('img');
      /* No <img> at all means FadeInImage took its give-up branch and is painting the "failed"
         plate — a placeholder, not a blank. Locally every remote image 400s (the documented
         constraint), so that is where every card ends up. */
      if (!img) { failed++; continue; }
      if (Number(getComputedStyle(img).opacity) > 0.05) visible++;
      else bare++;
    }
    /* The first card's image id, so a turn that actually swapped the data can be told from one
       that re-rendered the same rows. */
    const first = cards[0]?.querySelector('a[href^="/pic/"]')?.getAttribute('href') ?? '-';
    return { t: Math.round(performance.now() - t0), scrollTop: Math.round(sc.scrollTop),
             h: sc.scrollHeight, cards: cards.length, inView, shimmering, plate: failed, visible, HIDDEN: hidden, BARE: bare, first };
  };

  const collect = (ms) => new Promise((done) => {
    const rows = [];
    const start = performance.now();
    const step = () => {
      rows.push(sample());
      if (performance.now() - start < ms) requestAnimationFrame(step); else done(rows);
    };
    requestAnimationFrame(step);
  });

  const firstHref = () =>
    document.querySelector('.image-card a[href^="/pic/"]')?.getAttribute('href') ?? '-';
  const trace = { url0: location.search || '(none)', first0: firstHref() };

  const t0 = performance.now();
  next.click();
  await new Promise((r) => setTimeout(r, 0));
  const fwd = await collect(2000);

  /* Back to a page that has already been fetched, and the setup matters as much as the click.
     This leg used to press 上一页 from wherever the forward glide had left the scroller — the
     TOP of the list — so there was no travel and the one configuration that shows the bug could
     not occur. The reported sequence is next, scroll down again, previous. */
  await new Promise((r) => setTimeout(r, 1200));
  trace.url1 = location.search || '(none)';
  trace.first1 = firstHref();
  sc.scrollTop = sc.scrollHeight;
  await new Promise((r) => setTimeout(r, 700));
  const prev = [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') || '').includes('上一页'));
  if (!prev) return { fwd: fwd.filter((_, i) => i % 8 === 0), back: 'no prev control' };
  const backFrom = Math.round(sc.scrollTop);
  prev.click();
  const back = await collect(2000);

  trace.diag = window.__diag ?? null;
  trace.sg = window.__sg ?? null;
  trace.url2 = location.search || '(none)';
  trace.first2 = firstHref();
  return {
    cascadeSeen,
    trace,
    backFrom,
    clicked: window.__nextLabel,
    feedRequests: performance.getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => n.indexOf('search/images') !== -1 || n.indexOf('%2Fsearch%2Fimages') !== -1)
      .map((n) => { const u = decodeURIComponent(n); const m = u.match(/[?&]page=(\d+)/); return 'page=' + (m ? m[1] : '?'); }),
    pagerButtons: window.__pagerCount,
    fwd: fwd.filter((_, i) => i % 8 === 0),
    back: back.filter((_, i) => i % 8 === 0),
  };
})()`);

if (typeof out === 'string') console.log(out);
else {
  console.log('clicked:', out.clicked, ' pager buttons:', out.pagerButtons);
  console.log('page state:', JSON.stringify(out.trace));
  console.log('cards hidden after a cold paint:', out.cascadeSeen ? 'YES' : 'no');
console.log('feed requests:', JSON.stringify(out.feedRequests, null, 1));
  for (const [label, rows] of Object.entries(out).filter(([k]) => k === 'fwd' || k === 'back')) {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') continue;
    console.log(`
${label === 'fwd' ? '下一页' : '上一页 (already fetched)'}`);
    if (typeof rows === 'string') { console.log('  ' + rows); continue; }
    console.log('  t(ms)  scrollTop  scrollH  cards  inView  shimmer  plate  visible  HIDDEN   BARE  first');
    for (const r of rows) {
      console.log(`  ${String(r.t).padStart(5)}  ${String(r.scrollTop).padStart(9)}  ${String(r.h).padStart(7)}  ${String(r.cards).padStart(5)}  ${String(r.inView).padStart(6)}  ${String(r.shimmering).padStart(7)}  ${String(r.plate).padStart(5)}  ${String(r.visible).padStart(7)}  ${String(r.HIDDEN).padStart(6)}  ${String(r.BARE).padStart(5)}  ${r.first}`);
    }
  }
}

/* Two assertions. First: a card in view must show *something* — the shimmer while its image
   decodes, the plate once every line has failed. Blank is the bug: a `complete` but *failed*
   image used to satisfy the loaded check, which removed the shimmer and left the <img> at
   opacity 1 with nothing in it. Second (the cold-load half of the same predicate): `/` renders
   its first feed page on the server, so on a cold load the cards are painted before the motion
   chunk arrives — an entrance cascade starting then parks fifty already-visible cards at
   autoAlpha: 0. So no card may be hidden at all; `StaggerGrid` decides readiness once, at
   mount. A client navigation cascades as normal and is not what this samples. */
let worst = 0;
for (const rows of Object.values(out)) {
  if (!Array.isArray(rows) || typeof rows[0] !== 'object') continue;
  for (const r of rows) worst = Math.max(worst, (r.BARE ?? r.bare ?? 0) + (r.HIDDEN ?? 0));
}
const hiddenAfterPaint = out && typeof out === 'object' && out.cascadeSeen === true;
console.log(worst === 0
  ? '\nevery card in view showed a shimmer or a plate; none was blank'
  : `
FAIL: up to ${worst} card(s) in view were blank: no shimmer, no image, no plate`);
if (hiddenAfterPaint) {
  console.log(
    'FAIL: a card was hidden after the cold load had already painted it. The entrance cascade is'
      + ' running over server-rendered content — check that StaggerGrid still decides readiness'
      + ' once at mount rather than waiting for the motion chunk.',
  );
}
const failed = worst !== 0 || hiddenAfterPaint;

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 500);
