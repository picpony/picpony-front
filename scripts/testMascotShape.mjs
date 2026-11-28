/** The mascot's silhouette: the runs read off its artwork, the hit region drawn from them, where its
    bubble points, and the route that reads them — with the upstream stubbed, never a live read. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, afterEach } from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import ts from 'typescript';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testMascotShape');

const {
  shapeRows,
  parseMascotShape,
  shapePath,
  shapeHead,
  shapeLift,
  MASCOT_SHAPE_GRID,
  MASCOT_SHAPE_ALPHA,
} = await import('../lib/mascot/shapeModel.ts');
const { GET } = await import('../app/mascot-shape/route.ts');
const { getMascotConfig } = await import('../lib/api/mascot.ts');

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/* The route also reads the public mascot list, `GET /api/v1/mascots` (review P1-F8). Those reads
   are answered here, never by the network and never by a test's image stub: `mascotConfig` is the
   backend's answer, and `null` is an unreachable backend. Every assignment to `globalThis.fetch`
   below sets the image stub behind this. */
let mascotConfig = null;
const configReads = [];
let imageFetch = originalFetch;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  get: () => async (url, init) => {
    const address = new URL(String(url), 'https://app.invalid');
    if (address.pathname === '/api/v1/mascots') {
      configReads.push(address.pathname);
      return mascotConfig ? Response.json(mascotConfig) : new Response('down', { status: 503 });
    }
    return imageFetch(url, init);
  },
  set: (fn) => {
    imageFetch = fn;
  },
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

const inside = (boxes, x, y) =>
  boxes.some(([x0, top, x1, bottom]) => x >= x0 && x < x1 && y >= top && y < bottom);

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
  const alpha = [
    0,
    MASCOT_SHAPE_ALPHA - 1,
    MASCOT_SHAPE_ALPHA,
    255,
    0,
    /* row 2 */ 255,
    0,
    0,
    255,
    255,
  ];
  assert.deepEqual(shapeRows(alpha, w, 2), [
    [2, 4],
    [0, 1, 3, 5],
  ]);
  assert.deepEqual(shapeRows(new Uint8Array(6), 3, 2), [[], []]);
});

test('a shape from the wire is taken only whole, ascending and inside its grid', () => {
  const good = {
    w: 4,
    h: 2,
    rows: [
      [0, 2],
      [1, 3],
    ],
  };
  assert.deepEqual(parseMascotShape(good), good);
  assert.deepEqual(parseMascotShape({ w: 3, h: 1, rows: [[0, 1, 2, 3]] }), {
    w: 3,
    h: 1,
    rows: [[0, 1, 2, 3]],
  });
  for (const bad of [
    null,
    'shape',
    [],
    { w: 4, h: 2 },
    { w: 0, h: 1, rows: [[]] },
    { w: 257, h: 1, rows: [[]] },
    { w: 4.5, h: 1, rows: [[]] },
    { w: 4, h: 2, rows: [[0, 2]] },
    { w: 4, h: 1, rows: [[0]] },
    { w: 4, h: 1, rows: [[2, 1]] },
    { w: 4, h: 1, rows: [[1, 1]] },
    { w: 4, h: 1, rows: [[0, 5]] },
    { w: 4, h: 1, rows: [[-1, 2]] },
    { w: 4, h: 1, rows: [[0, 2.5]] },
    { w: 4, h: 1, rows: [[2, 3, 0, 1]] },
    { w: 4, h: 1, rows: ['0,2'] },
    { w: 2, h: 1, rows: [[0, 1, 1, 2, 2, 2]] },
  ])
    assert.equal(parseMascotShape(bad), null, JSON.stringify(bad));
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
  for (const [cw, ch, pad] of [
    [5, 5, 3],
    [5, 5, 8],
    [3.125, 3.125, 3],
    [1.25, 1.25, 8],
    [4, 6, 3],
  ]) {
    const width = FIGURE.w * cw;
    const height = FIGURE.h * ch;
    const boxes = rects(shapePath(FIGURE, width, height, pad));
    for (let y = 0.5; y < height; y += 1) {
      for (let x = 0.5; x < width; x += 1) {
        const d = distance(FIGURE, cw, ch, x, y);
        const hit = inside(boxes, x, y);
        /* A row is the vertical grain, and edges land on whole pixels. */
        if (d <= pad - 1)
          assert.ok(hit, `missed ${x},${y} at ${d.toFixed(2)}px (cell ${cw}x${ch}, pad ${pad})`);
        if (hit)
          assert.ok(
            d <= pad + ch + 3,
            `stray ${x},${y} at ${d.toFixed(2)}px (cell ${cw}x${ch}, pad ${pad})`,
          );
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
  const slant = drawn(
    Array.from({ length: 12 }, (_, row) => '.'.repeat(row) + '#'.repeat(8) + '.'.repeat(12 - row)),
  );
  const boxes = rects(shapePath(slant, 20, 12, 0));
  /* A cell a pixel wide: a band takes rows within a pixel of its first, so no rectangle is wider
     than a row plus that pixel. */
  for (const [x0, , x1] of boxes) assert.ok(x1 - x0 <= 9, `band ${x0}–${x1}`);
});

test('the head is the top of the silhouette, its middle the middle of its top tenth', () => {
  const head = shapeHead(FIGURE);
  /* The top tenth of a 14-row figure is one row, row 1: cells 17 and 18. */
  assert.deepEqual(head, { x: 18 / FIGURE.w, top: 1 / FIGURE.h });
  const ears = drawn([
    '.#..#.',
    '.#..#.',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
    '######',
  ]);
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
  assert.equal(
    shapeLift(drawn(['....', '....']), 40, 20, { left: 0, right: 40, top: 0, bottom: 20 }, 4),
    0,
  );
  /* Wherever it starts, the risen box keeps its distance from every cell it is beside. */
  for (let left = -20; left < width; left += 7) {
    for (let bottom = 0; bottom < height; bottom += 9) {
      const box = { left, right: left + 32, top: bottom - 32, bottom };
      const lift = shapeLift(FIGURE, width, height, box, 4);
      assert.ok(lift >= 0);
      FIGURE.rows.forEach((runs, row) => {
        for (let i = 0; i < runs.length; i += 2) {
          if (runs[i + 1] * cw <= box.left - 4 || runs[i] * cw >= box.right + 4) continue;
          assert.ok(
            row * cw >= box.bottom - lift + 4 - 1e-9,
            `box ${left},${bottom} lifted ${lift} meets row ${row}`,
          );
        }
      });
    }
  }
});

/* ---- The route ---- */

const SRC = 'https://picpony.top/uploads/mascots/pony.png';
const call = (src) =>
  GET({
    nextUrl: new URL(
      `http://localhost/mascot-shape${src === undefined ? '' : `?src=${encodeURIComponent(src)}`}`,
    ),
  });

async function png(width, height, paint) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (paint(x, y)) raw.writeUInt32BE(0xe06c9fff, (y * width + x) * 4);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

test('the route reads nothing that is not an image on the asset host', async () => {
  let reads = 0;
  globalThis.fetch = async () => {
    reads += 1;
    throw new Error('no upstream in this test');
  };
  for (const src of [
    undefined,
    '',
    'not a url',
    'http://picpony.top/a.png',
    'https://picpony.top.evil.example/a.png',
    'https://evil.example/a.png',
    'https://picpony.top:8443/a.png',
    'https://user:pass@picpony.top/a.png',
    'https://picpony.top/a.png?x=1',
    'https://picpony.top/a.png#x',
    'https://picpony.top/api.php',
    'https://picpony.top/a.svg',
    'https://picpony.top/',
    `https://picpony.top/${'a'.repeat(520)}.png`,
  ]) {
    const response = await call(src);
    assert.equal(response.status, 400, String(src));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
});

test('the route answers the runs of the artwork’s alpha, read once, never redirected', async () => {
  /* At the grid's own size, so no resampling blurs the edges the runs are checked against. */
  const bytes = await png(
    MASCOT_SHAPE_GRID,
    MASCOT_SHAPE_GRID / 2,
    (x, y) => x >= 24 && x < 72 && y >= 12,
  );
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([String(url), init.redirect, init.cache]);
    return new Response(bytes, {
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
    });
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
    [
      'https://picpony.top/u/html.png',
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    ],
    [
      'https://picpony.top/u/missing.png',
      () => new Response(bytes, { status: 404, headers: { 'content-type': 'image/png' } }),
    ],
    [
      'https://picpony.top/u/declared.png',
      () =>
        new Response(bytes, {
          headers: { 'content-type': 'image/png', 'content-length': String(64 * 1024 * 1024) },
        }),
    ],
    [
      'https://picpony.top/u/streamed.png',
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    ],
    [
      'https://picpony.top/u/broken.png',
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    ],
    [
      'https://picpony.top/u/redirect.png',
      () => {
        throw new TypeError('fetch failed: redirect mode is set to error');
      },
    ],
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
    enabled: true,
    revision: 1,
    tips: [],
    mascots: [
      { id: 1, name: 'one', image_url: '/uploads/one.png', tips: '' },
      { id: 2, name: 'two', image_url: 'uploads/two.png', tips: '' },
      { id: 3, name: 'three', image_url: 'https://picpony.top/uploads/three.png', tips: '' },
      { id: 4, name: 'upload', image_url: `/api/v1/mascots/images/${'a'.repeat(64)}`, tips: '' },
    ],
  };
  const reads = [];
  globalThis.fetch = async (url) => {
    reads.push(String(url));
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  };
  for (const name of ['one', 'two', 'three']) {
    assert.equal((await call(`https://picpony.top/uploads/${name}.png`)).status, 200, name);
  }
  /* A backend upload has no extension and is read from the backend at the same path. */
  assert.equal(
    (await call(`https://picpony.top/api/v1/mascots/images/${'a'.repeat(64)}`)).status,
    200,
    'upload',
  );
  assert.match(reads.at(-1), new RegExp(`/api/v1/mascots/images/${'a'.repeat(64)}$`));
  assert.deepEqual(configReads, ['/api/v1/mascots'], 'the list, read once');
  /* Any other picture on the asset host is refused before a byte is fetched — and a miss re-reads
     the configuration at most once a minute. */
  configReads.length = 0;
  const before = reads.length;
  assert.equal((await call('https://picpony.top/uploads/someone-else.png')).status, 400);
  assert.equal((await call('https://picpony.top/uploads/another.png')).status, 400);
  assert.equal(reads.length, before);
  assert.deepEqual(configReads, ['/api/v1/mascots'], 'one forced re-read for the two misses');
});

/* ---- Precomputed backend shape vs /mascot-shape fallback ---- */

test('getMascotConfig parses valid embedded shape and rejects malformed or absent shapes', async () => {
  const validShape = {
    w: 4,
    h: 2,
    rows: [
      [0, 2],
      [1, 4],
    ],
  };
  mascotConfig = {
    enabled: true,
    revision: 2,
    tips: ['默认提示'],
    mascots: [
      {
        id: 10,
        name: '有轮廓',
        image_url: `/api/v1/mascots/images/${'b'.repeat(64)}`,
        tips: '你好',
        shape: validShape,
      },
      {
        id: 11,
        name: '外链无预计算轮廓',
        image_url: 'https://picpony.top/uploads/external.png',
        tips: '',
      },
      {
        id: 12,
        name: '非法轮廓',
        image_url: `/api/v1/mascots/images/${'c'.repeat(64)}`,
        tips: '',
        shape: { w: 4, h: 1, rows: [[3, 1]] },
      },
    ],
  };
  const originalWindow = globalThis.window;
  globalThis.window = { __picponyRoutePolicy: { api: 'direct', image: 'direct' } };
  try {
    const withShape = await getMascotConfig('10');
    assert.deepEqual(withShape.shape, validShape);
    assert.equal(withShape.image, `/api/v1/mascots/images/${'b'.repeat(64)}`);

    const withoutShape = await getMascotConfig('11');
    assert.equal(withoutShape.shape, null);
    assert.equal(withoutShape.image, 'https://picpony.top/uploads/external.png');

    const malformedShape = await getMascotConfig('12');
    assert.equal(malformedShape.shape, null);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Mascot skips /mascot-shape when config carries a valid shape and falls back when absent', () => {
  const SKIP = Symbol('SKIP');
  const mascotConfigToken = { name: 'mascot-config' };
  const mascotShapeToken = { name: 'mascot-shape' };
  const shapeArgs = [];
  let currentConfig = null;
  let fallbackShape = null;

  const jsx = (type, props) => ({ type, props });
  const source = ts.transpileModule(
    readFileSync(new URL('../components/mascot/Mascot.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;

  const states = [];
  let stateCursor = 0;
  const react = {
    useState(initial) {
      const i = stateCursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [
        states[i],
        (next) => {
          states[i] = typeof next === 'function' ? next(states[i]) : next;
        },
      ];
    },
    useRef(initial) {
      return { current: initial };
    },
    useEffect() {},
    useLayoutEffect() {},
  };

  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require(name) {
      switch (name) {
        case 'react':
          return react;
        case 'react/jsx-runtime':
          return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        case 'react-icons/md':
          return { MdClose: 'MdClose', MdExpandMore: 'MdExpandMore' };
        case '@/components/IconButton':
          return { default: 'IconButton' };
        case '@/components/ScrollArea':
          return { default: 'ScrollArea' };
        case '@/lib/settingsSync':
          return { useSyncedSetting: (k) => (k === 'mascotId' ? '10' : 'medium') };
        case '@/lib/hooks':
          return { useMediaQuery: () => false, useStoredBoolean: () => false };
        case '@/lib/constants':
          return {
            MEDIA: {
              md: '(min-width:768px)',
              pointerCoarse: '(pointer:coarse)',
              pointerFine: '(pointer:fine)',
            },
          };
        case '@/lib/mascot/settings':
          return {
            MASCOT_KEYS: { collapsed: 'c' },
            MASCOT_PIXELS: { desktop: { medium: 160 }, mobile: { medium: 120 } },
            writeStored() {},
          };
        case '@/lib/resource':
          return {
            SKIP,
            useResource(res, args) {
              if (res === mascotConfigToken) return { data: currentConfig };
              if (res === mascotShapeToken) {
                shapeArgs.push(args);
                return { data: args === SKIP ? undefined : fallbackShape };
              }
              return { data: undefined };
            },
          };
        case '@/lib/mascot/queries':
          return { mascotConfig: mascotConfigToken, mascotShape: mascotShapeToken };
        case '@/lib/mascot/shapeModel':
          return { shapeHead, shapeLift, shapePath };
        case '@/lib/appearance':
          return {
            MOTION_SPEED_SCALE: { slow: 1.5 },
            entranceMotion: () => false,
            motionTier: () => 'standard',
            scaledMs: (ms) => ms,
          };
        case '@/lib/appScroller':
          return { getAppScroller: () => null };
        case '@/lib/ripple':
          return { TOUCH_PRESS_DELAY_MS: 80, TOUCH_SLOP_PX: 10 };
        case '@/lib/spring':
          return { SPRING_MS: { fastEffects: 150, defaultSpatial: 500 } };
        case '@/lib/springTiming':
          return { springTiming: () => ({ duration: 200, easing: 'linear' }) };
        case '@/lib/utils':
          return {
            clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
            cn: (...xs) => xs.filter(Boolean).join(' '),
          };
        case './Mascot.module.css':
          return { default: new Proxy({}, { get: (_t, prop) => String(prop) }) };
        default:
          throw new Error(`Unexpected import: ${name}`);
      }
    },
  });

  const Mascot = exports.default;
  const findByClass = (node, cls) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findByClass(child, cls);
        if (hit) return hit;
      }
      return null;
    }
    if (node.props?.className === cls) return node;
    return findByClass(node.props?.children, cls);
  };

  // Case 1: Backend provides valid precomputed shape -> /mascot-shape is SKIPped and clip-path renders immediately.
  const embedded = {
    w: 4,
    h: 4,
    rows: [
      [1, 3],
      [1, 3],
      [1, 3],
      [1, 3],
    ],
  };
  const imgUrl = `/api/v1/mascots/images/${'d'.repeat(64)}`;
  currentConfig = {
    enabled: true,
    id: '10',
    name: '云宝',
    image: imgUrl,
    shape: embedded,
    tips: [],
    mascots: [],
  };
  states[0] = { src: imgUrl, w: 120, h: 120 };
  stateCursor = 0;
  const treeWithShape = Mascot({ onChat() {} });
  assert.equal(shapeArgs.at(-1), SKIP, 'embedded shape must skip /mascot-shape fetch');
  const hitWithShape = findByClass(treeWithShape, 'hit');
  assert.match(String(hitWithShape?.props?.style?.clipPath ?? ''), /^path\('M/);

  // Case 2: Config omits shape (external asset-host URL) -> falls back to querying mascotShape resource.
  const externalUrl = 'https://picpony.top/uploads/external.png';
  currentConfig = {
    enabled: true,
    id: '11',
    name: '外链图',
    image: externalUrl,
    shape: null,
    tips: [],
    mascots: [],
  };
  fallbackShape = embedded;
  states[0] = { src: externalUrl, w: 120, h: 120 };
  stateCursor = 0;
  const treeFallback = Mascot({ onChat() {} });
  assert.equal(
    shapeArgs.at(-1)?.src,
    externalUrl,
    'absent shape must query /mascot-shape fallback',
  );
  const hitFallback = findByClass(treeFallback, 'hit');
  assert.match(String(hitFallback?.props?.style?.clipPath ?? ''), /^path\('M/);
});
