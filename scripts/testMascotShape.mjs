/** The mascot's silhouette: the runs read off its artwork, the hit region drawn from them, where its
    bubble points, and the route that reads them — with the upstream stubbed, never a live read. */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import sharp from 'sharp';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testMascotShape');

const { shapeRows, parseMascotShape, shapePath, shapeHead, shapeLift, MASCOT_SHAPE_GRID, MASCOT_SHAPE_ALPHA } = await import('../lib/mascot/shapeModel.ts');
const { GET } = await import('../app/mascot-shape/route.ts');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/* The route also reads the public mascot configuration (review P1-F8). Those reads are answered
   here, never by the network and never by a test's image stub: `mascotConfig` is the backend's
   answer per `selected_id` ('' for the default), and `null` is an unreachable backend. Every
   assignment to `globalThis.fetch` below sets the image stub behind this. */
let mascotConfig = null;
const configReads = [];
let imageFetch = originalFetch;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  get: () => async (url, init) => {
    const address = new URL(String(url));
    if (address.searchParams.get('action') === 'get_mascot_config') {
      const selected = address.searchParams.get('selected_id') ?? '';
      configReads.push(selected);
      const answer = mascotConfig?.[selected];
      return answer ? Response.json(answer) : new Response('down', { status: 503 });
    }
    return imageFetch(url, init);
  },
  set: (fn) => { imageFetch = fn; },
});

/** A shape from rows of `#` (character) and `.` (empty). */
function drawn(lines) {
  const h = lines.length;
  const w = lines[0].length;
  const alpha = lines.flatMap((line) => [...line].map((c) => (c === '#' ? 255 : 0)));
  return { w, h, rows: shapeRows(alpha, w, h) };
}

/** The path's rectangles, as `clip-path: path()` would fill them. */
function rects(path) {
  const out = [];
  for (const m of path.matchAll(/M(\d+) (\d+)H(\d+)V(\d+)H(\d+)Z/g)) {
    const [x0, top, x1, bottom, back] = m.slice(1).map(Number);
    assert.equal(back, x0, 'every rectangle closes where it opened');
    assert.ok(x1 > x0 && bottom > top, 'no empty rectangle');
    out.push([x0, top, x1, bottom]);
  }
  assert.equal(path.replace(/M\d+ \d+H\d+V\d+H\d+Z/g, ''), '', 'nothing but rectangles');
  return out;
}

const inside = (boxes, x, y) => boxes.some(([x0, top, x1, bottom]) => x >= x0 && x < x1 && y >= top && y < bottom);

/** Distance from a point to the nearest character cell, in the figure's pixels. */
function distance(shape, cw, ch, x, y) {
  let best = Infinity;
  shape.rows.forEach((runs, row) => {
    for (let i = 0; i < runs.length; i += 2) {
      const dx = Math.max(runs[i] * cw - x, 0, x - runs[i + 1] * cw);
      const dy = Math.max(row * ch - y, 0, y - (row + 1) * ch);
      best = Math.min(best, Math.hypot(dx, dy));
    }
  });
  return best;
}

/* A pony-ish figure: a body, a slanting neck, a thin leg a cell wide, a gap between legs. */
const FIGURE = drawn([
  '........................',
  '.................##.....',
  '................####....',
  '...............#####....',
  '..............####......',
  '.............####.......',
  '....##########.###......',
  '...############.........',
  '..#############.........',
  '..############..........',
  '...##########...........',
  '...#..#....#..#.........',
  '...#..#....#..#.........',
  '...#..#....#..#.........',
  '...#..#....#..#.........',
  '........................',
]);

test('runs follow the alpha threshold and close at the grid edge', () => {
  const w = 5;
  const alpha = [0, MASCOT_SHAPE_ALPHA - 1, MASCOT_SHAPE_ALPHA, 255, 0, /* row 2 */ 255, 0, 0, 255, 255];
  assert.deepEqual(shapeRows(alpha, w, 2), [[2, 4], [0, 1, 3, 5]]);
  assert.deepEqual(shapeRows(new Uint8Array(6), 3, 2), [[], []]);
});

test('a shape from the wire is taken only whole, ascending and inside its grid', () => {
  const good = { w: 4, h: 2, rows: [[0, 2], [1, 3]] };
  assert.deepEqual(parseMascotShape(good), good);
  assert.deepEqual(parseMascotShape({ w: 3, h: 1, rows: [[0, 1, 2, 3]] }), { w: 3, h: 1, rows: [[0, 1, 2, 3]] });
  for (const bad of [
    null, 'shape', [], { w: 4, h: 2 }, { w: 0, h: 1, rows: [[]] }, { w: 257, h: 1, rows: [[]] },
    { w: 4.5, h: 1, rows: [[]] }, { w: 4, h: 2, rows: [[0, 2]] },
    { w: 4, h: 1, rows: [[0]] }, { w: 4, h: 1, rows: [[2, 1]] }, { w: 4, h: 1, rows: [[1, 1]] },
    { w: 4, h: 1, rows: [[0, 5]] }, { w: 4, h: 1, rows: [[-1, 2]] }, { w: 4, h: 1, rows: [[0, 2.5]] },
    { w: 4, h: 1, rows: [[2, 3, 0, 1]] }, { w: 4, h: 1, rows: ['0,2'] }, { w: 2, h: 1, rows: [[0, 1, 1, 2, 2, 2]] },
  ]) assert.equal(parseMascotShape(bad), null, JSON.stringify(bad));
});

test('with no padding the region is the character, cell for cell', () => {
  const cw = 5;
  const ch = 5;
  const boxes = rects(shapePath(FIGURE, FIGURE.w * cw, FIGURE.h * ch, 0));
  FIGURE.rows.forEach((runs, row) => {
    for (let cell = 0; cell < FIGURE.w; cell += 1) {
      const on = runs.some((_, i) => i % 2 === 0 && cell >= runs[i] && cell < runs[i + 1]);
      assert.equal(inside(boxes, cell * cw + cw / 2, row * ch + ch / 2), on, `cell ${cell},${row}`);
    }
  });
});

test('padding forgives every aim within reach and reaches no further than a row past it', () => {
  for (const [cw, ch, pad] of [[5, 5, 3], [5, 5, 8], [3.125, 3.125, 3], [1.25, 1.25, 8], [4, 6, 3]]) {
    const width = FIGURE.w * cw;
    const height = FIGURE.h * ch;
    const boxes = rects(shapePath(FIGURE, width, height, pad));
    for (let y = 0.5; y < height; y += 1) {
      for (let x = 0.5; x < width; x += 1) {
        const d = distance(FIGURE, cw, ch, x, y);
        const hit = inside(boxes, x, y);
        /* A row is the vertical grain, and edges land on whole pixels. */
        if (d <= pad - 1) assert.ok(hit, `missed ${x},${y} at ${d.toFixed(2)}px (cell ${cw}x${ch}, pad ${pad})`);
        if (hit) assert.ok(d <= pad + ch + 3, `stray ${x},${y} at ${d.toFixed(2)}px (cell ${cw}x${ch}, pad ${pad})`);
      }
    }
  }
});

test('the gap between the legs stays the page’s under a mouse', () => {
  const cw = 12.5;
  const boxes = rects(shapePath(FIGURE, FIGURE.w * cw, FIGURE.h * cw, 3));
  /* Columns 7–10 of rows 11–14 are empty between two legs a cell wide. */
  assert.equal(inside(boxes, 8.5 * cw, 13 * cw), false);
  assert.equal(inside(boxes, 0.5 * cw, 12 * cw), false);
  assert.equal(inside(boxes, 20 * cw, 14 * cw), false);
});

test('rows that agree make one rectangle, and a slanting edge cannot drift a band wider', () => {
  const bar = drawn(['.##.', '.##.', '.##.', '.##.']);
  assert.equal(rects(shapePath(bar, 40, 40, 0)).length, 1);
  const slant = drawn(Array.from({ length: 12 }, (_, row) => '.'.repeat(row) + '#'.repeat(8) + '.'.repeat(12 - row)));
  const boxes = rects(shapePath(slant, 20, 12, 0));
  /* A cell a pixel wide: a band takes rows within a pixel of its first, so no rectangle is wider
     than a row plus that pixel. */
  for (const [x0, , x1] of boxes) assert.ok(x1 - x0 <= 9, `band ${x0}–${x1}`);
});

test('the head is the top of the silhouette, its middle the middle of its top tenth', () => {
  const head = shapeHead(FIGURE);
  /* The top tenth of a 14-row figure is one row, row 1: cells 17 and 18. */
  assert.deepEqual(head, { x: 18 / FIGURE.w, top: 1 / FIGURE.h });
  const ears = drawn(['.#..#.', '.#..#.', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######', '######']);
  assert.equal(shapeHead(ears).x, 3 / 6, 'two ears point between them');
  assert.equal(shapeHead(drawn(['...', '...'])), null);
});

test('a box near the head rises just clear of it, and one clear already stays put', () => {
  const cw = 5;
  const width = FIGURE.w * cw;
  const height = FIGURE.h * cw;
  /* The collapse control at the top-right corner: row 1's two cells (85–95px) are within 4px of it. */
  const corner = { left: width + 6 - 32, right: width + 6, top: -6, bottom: 26 };
  assert.equal(shapeLift(FIGURE, width, height, corner, 4), 26 + 4 - 5);
  /* Under the body's left end only from row 6 down, 30px — the box already ends 4px above. */
  assert.equal(shapeLift(FIGURE, width, height, { left: 0, right: 20, top: -6, bottom: 26 }, 4), 0);
  assert.equal(shapeLift(FIGURE, width, height, { left: 0, right: 20, top: -6, bottom: 27 }, 4), 1);
  assert.equal(shapeLift(drawn(['....', '....']), 40, 20, { left: 0, right: 40, top: 0, bottom: 20 }, 4), 0);
  /* Wherever it starts, the risen box keeps its distance from every cell it is beside. */
  for (let left = -20; left < width; left += 7) {
    for (let bottom = 0; bottom < height; bottom += 9) {
      const box = { left, right: left + 32, top: bottom - 32, bottom };
      const lift = shapeLift(FIGURE, width, height, box, 4);
      assert.ok(lift >= 0);
      FIGURE.rows.forEach((runs, row) => {
        for (let i = 0; i < runs.length; i += 2) {
          if (runs[i + 1] * cw <= box.left - 4 || runs[i] * cw >= box.right + 4) continue;
          assert.ok(row * cw >= box.bottom - lift + 4 - 1e-9, `box ${left},${bottom} lifted ${lift} meets row ${row}`);
        }
      });
    }
  }
});

/* ---- The route ---- */

const SRC = 'https://picpony.top/uploads/mascots/pony.png';
const call = (src) => GET({ nextUrl: new URL(`http://localhost/mascot-shape${src === undefined ? '' : `?src=${encodeURIComponent(src)}`}`) });

async function png(width, height, paint) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (paint(x, y)) raw.writeUInt32BE(0xe06c9fff, (y * width + x) * 4);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test('the route reads nothing that is not an image on the asset host', async () => {
  let reads = 0;
  globalThis.fetch = async () => { reads += 1; throw new Error('no upstream in this test'); };
  for (const src of [
    undefined, '', 'not a url', 'http://picpony.top/a.png', 'https://picpony.top.evil.example/a.png',
    'https://evil.example/a.png', 'https://picpony.top:8443/a.png', 'https://user:pass@picpony.top/a.png',
    'https://picpony.top/a.png?x=1', 'https://picpony.top/a.png#x', 'https://picpony.top/api.php',
    'https://picpony.top/a.svg', 'https://picpony.top/', `https://picpony.top/${'a'.repeat(520)}.png`,
  ]) {
    const response = await call(src);
    assert.equal(response.status, 400, String(src));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
});

test('the route answers the runs of the artwork’s alpha, read once, never redirected', async () => {
  /* At the grid's own size, so no resampling blurs the edges the runs are checked against. */
  const bytes = await png(MASCOT_SHAPE_GRID, MASCOT_SHAPE_GRID / 2, (x, y) => x >= 24 && x < 72 && y >= 12);
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([String(url), init.redirect, init.cache]);
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
  };
  const [first, second] = await Promise.all([call(SRC), call(SRC)]);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /max-age=86400/);
  const shape = await first.json();
  assert.deepEqual(await second.json(), shape);
  assert.deepEqual(seen, [[SRC, 'error', 'no-store']], 'two callers, one read');
  assert.equal(shape.w, MASCOT_SHAPE_GRID);
  assert.equal(shape.h, MASCOT_SHAPE_GRID / 2);
  assert.deepEqual(parseMascotShape(shape), shape);
  assert.deepEqual(shape.rows[11], []);
  assert.deepEqual(shape.rows[12], [24, 72]);
  assert.deepEqual(shape.rows.at(-1), [24, 72]);
});

test('the route gives up on what is not a picture, or too much of one', async () => {
  const bytes = await png(8, 8, () => true);
  const cases = [
    ['https://picpony.top/u/html.png', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
    ['https://picpony.top/u/missing.png', () => new Response(bytes, { status: 404, headers: { 'content-type': 'image/png' } })],
    ['https://picpony.top/u/declared.png', () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(64 * 1024 * 1024) } })],
    ['https://picpony.top/u/streamed.png', () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    }), { headers: { 'content-type': 'image/png' } })],
    ['https://picpony.top/u/broken.png', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })],
    ['https://picpony.top/u/redirect.png', () => { throw new TypeError('fetch failed: redirect mode is set to error'); }],
  ];
  for (const [src, answer] of cases) {
    globalThis.fetch = async () => answer();
    const response = await call(src);
    assert.equal(response.status, 502, src);
    assert.equal(response.headers.get('cache-control'), 'no-store', src);
  }
});

test('a failure is not remembered: the next request reads again', async () => {
  const src = 'https://picpony.top/u/flaky.png';
  const bytes = await png(MASCOT_SHAPE_GRID, MASCOT_SHAPE_GRID, (x) => x < MASCOT_SHAPE_GRID / 2);
  let reads = 0;
  globalThis.fetch = async () => {
    reads += 1;
    if (reads === 1) throw new TypeError('fetch failed');
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  };
  assert.equal((await call(src)).status, 502);
  const retried = await call(src);
  assert.equal(retried.status, 200);
  assert.deepEqual((await retried.json()).rows[0], [0, MASCOT_SHAPE_GRID / 2]);
  assert.equal(reads, 2);
});

/* ---- Review P1-F8: only the configured artworks ---- */

test('P1-F8: with the configuration readable, only a configured mascot is read', async () => {
  const bytes = await png(MASCOT_SHAPE_GRID, MASCOT_SHAPE_GRID, () => true);
  configReads.length = 0;
  mascotConfig = {
    '': { success: true, id: 2, mascot_image: 'uploads/two.png', mascots: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    1: { success: true, id: 1, mascot_image: '/uploads/one.png' },
    3: { success: true, id: 3, mascot_image: 'https://picpony.top/uploads/three.png' },
  };
  const reads = [];
  globalThis.fetch = async (url) => {
    reads.push(String(url));
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  };
  for (const name of ['one', 'two', 'three']) {
    assert.equal((await call(`https://picpony.top/uploads/${name}.png`)).status, 200, name);
  }
  assert.deepEqual(configReads.sort(), ['', '1', '3'], 'the list, then each other mascot by id, read once');
  /* Any other picture on the asset host is refused before a byte is fetched — and a miss re-reads
     the configuration at most once a minute. */
  configReads.length = 0;
  const before = reads.length;
  assert.equal((await call('https://picpony.top/uploads/someone-else.png')).status, 400);
  assert.equal((await call('https://picpony.top/uploads/another.png')).status, 400);
  assert.equal(reads.length, before);
  assert.deepEqual(configReads.sort(), ['', '1', '3'], 'one forced re-read for the two misses');
});
