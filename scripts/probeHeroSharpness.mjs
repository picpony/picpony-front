/* How sharp is the picture during a hero flight?
 *
 * The flight paints `previewSrc` on `[data-image-detail-layer="preview"]`; in production that is
 * whatever variant `next/image` chose for a ~300px gallery card, scaled to fill the viewport. The
 * question is the ratio between the bitmap's `naturalWidth` and the box it is painted into.
 * Unlike the other probes this one needs **real** images: `next/image` has to actually optimize
 * something, so the fixture serves a live page from derpibooru.org and the browser is pinned to
 * the direct image line.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { stubFor } from './netAuditFixtures.mjs';

const ROOT = process.cwd();
const PORT = 3972, UP = 3973, CDP = 9351;
const ARGS = process.argv.slice(2);
const WIDTH = Number(ARGS.find((a) => /^\d+$/.test(a)) || 1920);
/* `--fake-cdn` rather than an env var, because an npm script cannot set one portably here. */
const FAKE_CDN = process.env.PROBE_FAKE_CDN === '1' || ARGS.includes('--fake-cdn');
const NO_WARM = process.env.PROBE_NO_WARM === '1' || ARGS.includes('--no-warm');

/* Cached to disk after the first success: the live API rate-limits and answers a Cloudflare page
   when it does. Delete the file to refresh. */
const CACHE = path.join(tmpdir(), 'picpony-hero-fixture.json');
let live;
try {
  live = JSON.parse(readFileSync(CACHE, 'utf8'));
  console.log('using cached live fixture');
} catch {
  const res = await fetch(
    'https://derpibooru.org/api/v1/json/search/images?q=pony&per_page=50&sf=score&sd=desc',
    { signal: AbortSignal.timeout(30000) },
  );
  const text = await res.text();
  if (!text.startsWith('{')) throw new Error(`derpibooru answered ${res.status} with non-JSON; try again later`);
  live = JSON.parse(text);
  writeFileSync(CACHE, text);
}
/* Static formats only — an animated GIF bypasses the optimizer and is already 1:1, the one case
   that cannot show the defect — and a source with enough pixels to *be* sharp: a picture whose
   own `medium` is 800px wide cannot fill a 1888 device-pixel box however it is fetched. */
live.images = live.images.filter(
  (i) => ['png', 'jpg', 'jpeg', 'webp'].includes((i.format || '').toLowerCase()) && (i.width || 0) >= 2400,
);
if (!live.images.length) throw new Error('no large static images in the cached fixture');
const byId = new Map(live.images.map((i) => [i.id, i]));
console.log(`live fixture: ${live.images.length} static images, ids ${live.images.slice(0, 3).map((i) => i.id).join(',')}`);

const upstream = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (body) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.endsWith('/search/images')) return json(live);
  const one = /\/images\/(\d+)$/.exec(url.pathname);
  if (one) return json({ image: byId.get(Number(one[1])) ?? live.images[0] });
  const stub = stubFor(`http://127.0.0.1:${UP}${req.url}`);
  if (!stub) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': stub.contentType, 'cache-control': 'no-store' });
  res.end(stub.binary ? Buffer.from(stub.body, 'base64') : stub.body);
});
await new Promise((r) => upstream.listen(UP, '127.0.0.1', r));

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env,
    PICPONY_UPSTREAM_ORIGIN: `http://127.0.0.1:${UP}`,
    PICPONY_DERPI_ORIGIN: `http://127.0.0.1:${UP}/api/v1/json`,
    /* Or the SSR'd feed comes from `.next/cache/fetch-cache`, which persists on disk between
       runs — a fixture change is invisible. Same switch `npm run net:audit` uses. */
    PICPONY_SERVER_MEMO_TTL_MS: '0' },
});
const until = async (fn, ms = 60000) => {
  const e = Date.now() + ms;
  while (Date.now() < e) { try { if (await fn()) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
if (!(await until(() => fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok)))) throw new Error('no server');

const profile = mkdtempSync(path.join(tmpdir(), 'pp-sharp-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
   `--window-size=${WIDTH},1080`,
   ...(process.env.PROBE_DPR ? [`--force-device-scale-factor=${process.env.PROBE_DPR}`] : []),
   '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
await until(async () => {
  const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  page = l.find((t) => t.type === 'page');
  return Boolean(page);
});
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
const listeners = new Map();
ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); return; }
  if (x.method) listeners.get(x.method)?.forEach((fn) => fn(x.params));
};
const on = (method, fn) => {
  if (!listeners.has(method)) listeners.set(method, new Set());
  listeners.get(method).add(fn);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');

/* `--throttle=<mbps>` shapes the faked CDN only, by delaying each fulfillment in proportion to
 * the rung's weight.
 *
 * NOT `Network.emulateNetworkConditions`: a CDP-fulfilled response is synthesised inside the
 * browser and is **not** subject to it — measured, a 370KB rung under a 10Mbps throttle still
 * reported `transferSize: 0` and a 21ms duration, so the first version silently measured
 * localhost. If a throttle appears to make no difference, check whether the bytes are travelling.
 */
const MBPS = Number((ARGS.find((a) => a.startsWith('--throttle=')) || '').split('=')[1] || 0);
const LATENCY_MS = 40;
const shapeDelay = (bytes) => (MBPS > 0 ? LATENCY_MS + (bytes * 8) / (MBPS * 1000) : 0);
if (MBPS > 0) console.log(`shaping the faked CDN to ${MBPS}Mbps, ${LATENCY_MS}ms latency`);

/* PROBE_FAKE_CDN: answer the browser's own derpicdn requests locally.
 *
 * Not a convenience — the warm leg needs the detail-sized bytes inside a plausible hover, and
 * this machine takes ~25s to fetch derpicdn directly, so without this the warm never lands and
 * the probe can only ever report the cold path. It intercepts the BROWSER only: CDP cannot reach
 * the Next server, so `/_next/image` still fetches the real file through the real optimizer and
 * the card-versus-flight comparison stays honest. A checkerboard rather than a flat fill, since
 * a flat image is sharp at every scale.
 */
if (FAKE_CDN) {
  const { deflateSync, crc32 } = await import('node:zlib');
  const png = (w, h) => {
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    /* A fine checkerboard rather than a flat fill. A flat image is sharp at every scale, so it
       could not distinguish a 304px canvas from a 1152px one by eye — and it also compresses to
       nothing, which would hide any cost the transfer has. */
    const rows = [];
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(1 + w * 3);
      for (let x = 0; x < w; x++) {
        const v = ((x >> 1) + (y >> 1)) % 2 ? 235 : 25;
        row[1 + x * 3] = v; row[2 + x * 3] = v; row[3 + x * 3] = v;
      }
      rows.push(row);
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 6 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  /* One body per rung, at the byte size that rung really costs — the question is a *timing*
     one: `medium` is warmed instead of `large` precisely because 373KB cannot land inside a
     hover and ~110KB can. A fake CDN answering every rung instantly at 7KB cannot tell those
     apart, and would report the bug as fixed at any rung. */
  const RUNGS = [
    { match: /\/thumb[_a-z]*\./, w: 128, bytes: 8 * 1024 },
    { match: /\/small\./, w: 320, bytes: 25 * 1024 },
    { match: /\/medium\./, w: 800, bytes: 110 * 1024 },
    { match: /\/(large|full|tall)\./, w: 1280, bytes: 370 * 1024 },
  ];
  const bodies = new Map();
  const bodyFor = (rung) => {
    if (bodies.has(rung.w)) return bodies.get(rung.w);
    /* Padded to the rung's real weight with a tEXt chunk: the checkerboard itself compresses to
       a few KB, so without the padding every rung would arrive in one packet. */
    let buf = png(rung.w, Math.round(rung.w / 1.78));
    if (buf.length < rung.bytes) {
      const pad = Buffer.alloc(rung.bytes - buf.length - 16, 0x41);
      const data = Buffer.concat([Buffer.from([0x70, 0x61, 0x64, 0x00]), pad]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const withType = Buffer.concat([Buffer.from('tEXt', 'ascii'), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(withType) >>> 0);
      const chunkBuf = Buffer.concat([len, withType, crc]);
      // Before IEND, which is the last 12 bytes.
      buf = Buffer.concat([buf.subarray(0, buf.length - 12), chunkBuf, buf.subarray(buf.length - 12)]);
    }
    const b64 = buf.toString('base64');
    bodies.set(rung.w, b64);
    return b64;
  };
  for (const r of RUNGS) bodyFor(r);
  console.log(
    'faking derpicdn: ' +
      RUNGS.map((r) => `${r.w}px/${Math.round(((bodies.get(r.w).length * 3) / 4) / 1024)}KB`).join(' '),
  );
  const arrivals = [];
  on('Fetch.requestPaused', ({ requestId, request }) => {
    const rung = RUNGS.find((r) => r.match.test(request.url)) ?? RUNGS[RUNGS.length - 1];
    const wait = shapeDelay(rung.bytes);
    const asked = Date.now();
    const fulfil = () => {
      arrivals.push({ w: rung.w, kb: Math.round(rung.bytes / 1024), ms: Date.now() - asked });
      void send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'image/png' },
          { name: 'cache-control', value: 'no-store' },
        ],
        body: bodyFor(rung),
      });
    };
    if (wait > 0) setTimeout(fulfil, wait);
    else fulfil();
  });
  globalThis.__arrivals = arrivals;
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*derpicdn.net*', requestStage: 'Request' }],
  });
}

/* Direct line, so the images actually come from derpicdn rather than a proxy this machine may
   not reach; and the standard motion tier, since headless reports `reduce`. */
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));
await ev(`localStorage.setItem('picpony_use_proxy','false');
          localStorage.setItem('trixie_use_cdn','false');
          localStorage.setItem('picpony_motion','standard'); 1`);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 9000));

const out = await ev(`(async () => {
  /* The widest-aspect card. The flight's box is capped by the media well's width, so a portrait
     picture never gets near it — a landscape one is where the upscale actually bites, and it is
     the case the report is about. */
  const cards = [...document.querySelectorAll('.image-card')]
    .map((c) => ({ c, img: c.querySelector('img') }))
    .filter((x) => x.img && x.img.naturalWidth > 0)
    .sort((a, b) => b.img.naturalWidth / b.img.naturalHeight - a.img.naturalWidth / a.img.naturalHeight);
  const card = cards[0]?.c;
  const cardImg = cards[0]?.img;
  if (!cardImg) return { error: 'no decoded card image' };
  const cardInfo = {
    cssWidth: Math.round(cardImg.getBoundingClientRect().width),
    naturalWidth: cardImg.naturalWidth,
    src: (cardImg.currentSrc || '').slice(-70),
    aspect: (cardImg.naturalWidth / cardImg.naturalHeight).toFixed(2),
    dpr: window.devicePixelRatio,
  };

  // The intent ladder: hover, then press. warmImageHeroSource hangs off this, so skipping it
  // measures the un-warmed path.
  const warm = ${NO_WARM ? 'false' : 'true'};
  const link = card.querySelector('a');
  window.__hoverAt = performance.now();
  if (warm) {
    // pointerover, not pointerenter: React synthesises enter/leave from over/out at the root, so
    // a dispatched pointerenter reaches no handler and the probe measures the un-warmed path.
    link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, ${Number(process.env.PROBE_WARM_MS || 1500)}));
  }

  /* Everything the page requested during the hover, so a warm that never started can be told
     from one that started and was not used. */
  const warmRequests = performance.getEntriesByType('resource')
    .filter((r) => r.startTime > window.__hoverAt)
    .map((r) => decodeURIComponent(r.name).slice(-58));

  const samples = [];
  const t0 = performance.now();
  link.click();
  await new Promise((done) => {
    const step = () => {
      /* The flyer FIRST, and it is a canvas, not an img.
         This is the whole reason the probe used to pass while the flight was visibly soft:
         launchFlight hands createHeroFlight the snapshot's previewFrame, a canvas blitted from
         the card's bitmap, and that canvas is what covers the screen for the entire leg. The
         data-image-detail-layer nodes are the surface underneath it, so measuring only those
         answers 'what will it look like once it has landed', never 'what does the flight look
         like'. (No backticks in here: this whole block is inside a template literal handed to
         Runtime.evaluate, and one backtick ends it.) */
      const fly = document.querySelector('.image-hero-flyer-image');
      const prev = document.querySelector('[data-image-detail-layer="preview"]');
      const fin = document.querySelector('[data-image-detail-layer="final"]');
      const finOn = fin && fin.naturalWidth > 0 && Number(getComputedStyle(fin).opacity) > 0.5;
      if (fly) {
        const r = fly.getBoundingClientRect();
        samples.push({
          t: Math.round(performance.now() - t0),
          layer: 'flyer',
          paintedW: Math.round(r.width * (window.devicePixelRatio || 1)),
          naturalW: fly.width,
        });
      } else {
        const p = finOn ? fin : prev;
        if (p) {
          const r = p.getBoundingClientRect();
          samples.push({
            t: Math.round(performance.now() - t0),
            layer: finOn ? 'final' : 'preview',
            paintedW: Math.round(r.width * (window.devicePixelRatio || 1)),
            naturalW: p.naturalWidth,
          });
        }
      }
      if (performance.now() - t0 < 5000) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  return {
    cardInfo,
    warmRequests,
    samples,
    /* Every derpicdn fetch with its duration, so one run prices both rungs: the warm fetches
       medium and the final layer fetches large, on the same throttle. That is what decides whether
       a rung can land inside a hover, and it is the number the medium-instead-of-large choice
       rests on. */
    cdn: performance.getEntriesByType('resource')
      // Not /_next/image, whose own query string contains the CDN URL — that matched the five
      // optimized card variants and reported them as direct CDN fetches.
      .filter((r) => r.name.includes('derpicdn') && !r.name.includes('/_next/image'))
      .map((r) => ({
        rung: (decodeURIComponent(r.name).match(/[/]([a-z_]+)[.][a-z0-9]+$/) || [])[1] || '?',
        kb: Math.round(r.transferSize / 1024) || Math.round(r.encodedBodySize / 1024),
        ms: Math.round(r.duration),
        start: Math.round(r.startTime),
      })),
    url: location.pathname,
    overlay: Boolean(document.querySelector('[data-image-detail-overlay]')),
    layers: [...document.querySelectorAll('[data-image-detail-layer]')].map((e) => ({
      layer: e.dataset.imageDetailLayer,
      naturalW: e.naturalWidth,
      opacity: getComputedStyle(e).opacity,
      complete: e.complete,
      w: (() => { try { return new URL(e.currentSrc || e.src, location.href).searchParams.get('w'); } catch { return null; } })(),
      sizes: e.getAttribute('sizes'),
    })),
    opened: (() => {
      const host = document.querySelector('[data-image-hero-role="detail"]');
      return { id: host?.getAttribute('data-image-hero-id') };
    })(),
    heroActiveAttr: document.querySelector('[data-image-detail-hero-active]')?.getAttribute('data-image-detail-hero-active'),
    finalReady: document.querySelector('[data-image-detail-final-ready]') ? 'yes' : 'no',
  };
})()`);

if (out?.error) console.log(out.error);
else {
  const c = out.cardInfo;
  console.log(`card: ${c.cssWidth}px css, bitmap ${c.naturalWidth}px, aspect ${c.aspect}, dpr ${c.dpr}`);
  console.log('  t(ms)  layer    devicePx  bitmapW  upscale');
  let prevKey = '';
  for (const s of out.samples) {
    const key = s.layer + ':' + s.naturalW;
    if (key === prevKey) continue;
    prevKey = key;
    const up = s.naturalW ? (s.paintedW / s.naturalW).toFixed(2) : '-';
    console.log(`  ${String(s.t).padStart(5)}  ${s.layer.padEnd(8)} ${String(s.paintedW).padStart(8)}  ${String(s.naturalW).padStart(7)}  ${String(up).padStart(7)}x`);
  }
  if (FAKE_CDN && globalThis.__arrivals?.length) {
    console.log('faked CDN, as served (rung, weight, held before fulfilling):');
    for (const a of globalThis.__arrivals) {
      console.log(`   ${String(a.w).padStart(4)}px ${String(a.kb).padStart(4)}KB  held ${String(a.ms).padStart(4)}ms`);
    }
  }
  if (out.cdn?.length) {
    console.log('derpicdn fetches (rung, weight, duration):');
    for (const c of out.cdn) console.log(`   ${c.rung.padEnd(8)} ${String(c.kb).padStart(4)}KB  ${String(c.ms).padStart(4)}ms  (started ${c.start}ms)`);
  }
  console.log('requests during hover:');
  for (const r of (out.warmRequests || []).slice(0, 8)) console.log('   ...' + r);
  console.log('opened:', JSON.stringify(out.opened));
  console.log(`after: url=${out.url} overlay=${out.overlay} heroActive=${out.heroActiveAttr} finalReady=${out.finalReady}`);
  for (const l of out.layers) console.log('   ' + JSON.stringify(l));
  const fly = out.samples.filter((s) => s.layer === 'flyer' && s.naturalW > 0);
  if (fly.length) {
    const worst = fly.reduce((a, b) => (b.paintedW / b.naturalW > a.paintedW / a.naturalW ? b : a));
    console.log(
      `\nflight: canvas ${fly[0].naturalW}px, worst ${worst.paintedW}px painted = ` +
        `${(worst.paintedW / worst.naturalW).toFixed(2)}x upscale at t=${worst.t}ms`,
    );
  } else console.log('\nflight: no flyer canvas sampled (no flight ran)');
  const last = out.samples.at(-1);
  if (last) console.log(`\nat landing: ${last.paintedW}px painted from a ${last.naturalW}px bitmap = ${(last.paintedW / (last.naturalW || 1)).toFixed(2)}x upscale`);
}

/* The assertion, and it is on the flyer canvas rather than on any img.
 *
 * Mechanism guarded: warmImageHeroSource rasterises the detail-sized source on the intent ladder
 * and prepareImageHero hands THAT canvas to the flight instead of one blitted from the card. It
 * was broken for four rounds in a way no probe could see, because the map fed previewSrc — the
 * img *behind* the canvas — so the measurement moved while the picture on screen did not.
 * Only asserted with PROBE_FAKE_CDN: a real derpicdn fetch takes ~25s here and no plausible
 * hover covers it. Without the flag this stays a report.
 */
let failed = false;
if (!out?.error && FAKE_CDN && !NO_WARM) {
  const flyerSamples = out.samples.filter((s) => s.layer === 'flyer' && s.naturalW > 0);
  const canvas = flyerSamples[0]?.naturalW ?? 0;
  const card = out.cardInfo.naturalWidth;
  const worst = flyerSamples.length
    ? Math.max(...flyerSamples.map((s) => s.paintedW / s.naturalW))
    : Infinity;
  if (canvas <= card) {
    console.log(
      `
FAIL: the flight painted a ${canvas}px canvas, the card's own bitmap is ${card}px — ` +
        'the warmed detail frame was not used. This is the regression this probe exists for.',
    );
    failed = true;
  } else if (worst > 1.5) {
    console.log(`
FAIL: flight upscale peaked at ${worst.toFixed(2)}x, over the 1.5x bound.`);
    failed = true;
  } else {
    console.log(`
OK: warmed flight paints a ${canvas}px canvas (card has ${card}px), peak ${worst.toFixed(2)}x.`);
  }
}

ws.close(); browser.kill(); server.kill(); upstream.close();
setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(failed ? 1 : 0); }, 500);
