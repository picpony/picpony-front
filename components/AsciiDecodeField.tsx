'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { cn, clamp } from '@/lib/utils';

/**
 * The ink ramp, lightest to heaviest.
 *
 * Round and solid *shapes* rather than the classic `.:-=+*#%@` dot-and-dash ramp,
 * and that is the difference between reading as a halftone and reading as ASCII
 * art. A ramp built from punctuation reads as punctuation — the eye looks for
 * syntax in it. A ramp built from a dot, a star, a letter and a filled mass reads
 * as ink density, which is what a screen is.
 *
 * `P` sits mid-ramp on purpose: it is the site's own initial, sprinkled through the
 * middle bands rather than given a step of its own, so the texture is partly made
 * of the thing it belongs to.
 */
const RAMP = ['·', '·', ':', '+', '*', 'o', 'P', '#', '%', '@'];
/**
 * Tone per ramp step, as an index into the five layers below.
 *
 * It follows the ramp loosely rather than in lockstep: five tones stepping with ten
 * glyphs reads as a gradient, and this style is flat zones.
 */
const TONE = [0, 0, 0, 1, 1, 2, 2, 3, 3, 3];
/** What a cell shows while it is still resolving. Punctuation only, never letters. */
const CHURN = '/\\|_-=+*<>[]{}()#%$&~^:;01';

/**
 * Cell metrics in px — a *fallback*, used only for the first layout pass. The probe
 * measures the real ones, because they come from whichever font actually loaded and
 * a wrong advance width shows up as a plate that stops short of the right edge.
 */
const FALLBACK_CELL = { w: 6.85, h: 16 };
const PROBE_LEN = 40;
const PROBE = '0'.repeat(PROBE_LEN);

/** ~14fps. A character animation gains nothing from 60 and costs six strings a frame. */
const FRAME_MS = 70;
/** The decode: how long a cell churns, and how far apart the earliest and latest start. */
const CHURN_MS = 260;
const SPREAD_MS = 620;
/** One turn of the body, in seconds. Slow — it is the plate's one deliberate motion. */
const SPIN_SECONDS = 30;
/** The body's tilt. A vertical axis reads as a wheel rather than as a world. */
const TILT = 0.41;
/** How far the pointer reaches, in cells of width. */
const REACH = 15;

/**
 * A deterministic hash of three integers, in [0, 1).
 *
 * An avalanche mixer rather than the usual `sin(seed * 12.9898)` one-liner, because
 * the seeds here are *adjacent* — lattice corner, the corner next to it, the same
 * cell one frame later — and that one-liner correlates badly across small linear
 * steps, which shows up as noise that ripples instead of scattering.
 */
function hash(a: number, b: number, c: number): number {
  let x =
    (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>>
    0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  x = Math.imul(x, 0x9e3779b1);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Value noise with a smoothstep between lattice points. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Three octaves, normalised to [0, 1]. Three rather than five: at twenty rows the
 *  higher octaves land below one cell and only add grain. */
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 131);
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum / 0.875;
}
type Grid = { cols: number; rows: number };
const EMPTY: Grid = { cols: 0, rows: 0 };

/**
 * A de-coding texture: the whole box filled with characters, every cell of it, with
 * an organic field deciding which mark and which tone each one takes. Decoration
 * behind the wordmark on /about.
 *
 * **Every cell carries a mark, and that is the one thing that makes it a texture.**
 * Four earlier versions left most cells empty and every one of them read as dirt
 * rather than as material — sparse glyphs on a surface are specks, and no amount of
 * composition fixes that. A woven ground at the faintest tone, with the field
 * substituting heavier marks into it, is what a character screen actually is.
 *
 * **The histogram is the design, not the field.** `fbm` clusters hard around 0.5, so
 * mapping it straight onto the ramp puts nearly every cell in the heavy half and the
 * plate comes out solid black. A window plus a gamma is what leaves most of the box
 * on the lightest mark and makes the heavy ones rare enough to read as form.
 *
 * **The accent is a zone, not the top of the ramp.** Spending a saturated tone on the
 * peaks scatters it as dust; one strong colour has to arrive as a region with an edge.
 * A second, much lower-frequency field draws two such regions — one warm, one cool —
 * and inside them the mid and heavy marks change tone while the glyphs do not. That
 * split is why the plate reads as composed: the *form* comes from one field and the
 * *colour* from another, so neither is a recolouring of the other.
 *
 * **Three earlier compositions are worth recording as dead ends**, because each looked
 * reasonable while being the wrong kind of thing. A phrase resolving out of sparse
 * noise reads as a marquee. A full wall of vocabulary reads as a word list. And a
 * plate of drawn diagrams — a disc, a bar, a block of labelled copy — reads as an
 * infographic about a site rather than as the site's own material; the copy was the
 * worst of it, because a list of facts in a decoration is a list either way.
 *
 * **One body turns.** A sphere on the right, bleeding off the edge, whose texture is
 * sampled in *its own* surface coordinates rather than the plate's — so the same
 * material wraps it and turns with it, once every thirty seconds. It has no rim and no
 * graticule: its density falls off toward the limb, which is all a ball needs. It is
 * the one thing here that says the fandom this site belongs to is not local.
 *
 * **Three clocks, deliberately.** The decode is one-shot: each cell churns for 260ms,
 * starting on a noise-ordered delay so the plate *develops* rather than wipes. The
 * field then drifts for ever, slowly enough that a still frame looks static and a
 * glance away and back does not. The pointer is a third source in the same field, so
 * it swells the marks under it rather than painting a disc on top, and it follows with
 * a lag, which is what makes it read as mass rather than as a cursor.
 *
 * **The grid is measured, not assumed.** A hidden probe reports the cell's real advance
 * width and line height, and re-measures on `document.fonts.ready` as well as on
 * resize, since a font swap changes the cell without changing the box and so never
 * trips the `ResizeObserver`.
 *
 * **Six layers, one string each.** Colouring per cell would mean a `<span>` per
 * character: on a 130×20 grid that is 2,600 elements rebuilt fourteen times a second,
 * a layout cost with nothing to show for it. Six `<pre>` blocks on the same grid cost
 * six strings a frame and create no element after mount.
 *
 * **The plate takes no pointer events at all**, and the pointer is tracked on its
 * parent. The first reason is a defect avoided: this is `absolute inset-0` under a
 * wordmark that counts its own clicks — ten of them open the developer guide — and an
 * absolutely-positioned sibling that accepted events would swallow them. The second is
 * that the response belongs to the whole surface rather than to the strip the mark
 * happens not to cover.
 *
 * **Under `prefers-reduced-motion` it draws the settled plate and stops.** No decode,
 * no drift, no spin, no pointer. The preference asks for less movement, not for an
 * empty box, and this is the container's only texture. Reactive rather than a one-shot
 * read, because this is a page a reader may be sitting on when they change the setting.
 */
export default function AsciiDecodeField({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const layerRefs = useRef<(HTMLPreElement | null)[]>([]);
  const cellRef = useRef(FALLBACK_CELL);
  const pointerRef = useRef<{ col: number; row: number } | null>(null);
  const reduced = useReducedMotion();
  const [grid, setGrid] = useState<Grid>(EMPTY);

  /* The grid follows the box. `ResizeObserver` rather than a viewport listener: this
     sits in a `max-w-4xl` column whose width changes with the sidebar, not only with
     the window. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const probe = probeRef.current;
      if (probe) {
        const rect = probe.getBoundingClientRect();
        if (rect.width > 0) cellRef.current = { w: rect.width / PROBE_LEN, h: rect.height };
      }
      const box = host.getBoundingClientRect();
      const { w, h } = cellRef.current;
      if (box.width <= 0 || box.height <= 0) return;
      const next = {
        cols: Math.max(1, Math.floor(box.width / w)),
        rows: Math.max(1, Math.floor(box.height / h)),
      };
      setGrid((prev) => (prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    const layers = layerRefs.current;
    const { cols, rows } = grid;
    if (!host || layers.length < 6 || layers.some((l) => !l) || !cols || !rows) return;

    const aspect = cellRef.current.h / cellRef.current.w;
    /* The sphere. Off to the right and larger than the box is tall, so it bleeds off
       three edges — a form sitting wholly inside the frame reads as an illustration
       pasted on, which is the opposite of a texture. */
    const sc = cols - 16;
    const sr = rows / 2;
    const sRows = rows * 0.62;
    const sCols = sRows * aspect;
    /* Cell delays for the decode, drawn from the same noise so the plate develops in
       coherent patches instead of dissolving cell by cell. */
    const delay = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        delay[row * cols + col] = fbm(col / 9, (row * aspect) / 9, 5501) * SPREAD_MS;
      }
    }

    const lens = { col: 0, row: 0, on: 0 };
    const buf: string[][] = [[], [], [], [], [], []];
    let elapsed = 0;

    const draw = () => {
      const t = elapsed / 1000;
      const drift = t * 0.035;
      const spin = (t / SPIN_SECONDS) * Math.PI * 2;
      const ct = Math.cos(TILT);
      const st = Math.sin(TILT);
      for (const layer of buf) layer.length = 0;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = row * cols + col;
          /* Sample coordinates. Inside the body they are its surface point, so the
             material wraps and turns with it; outside they are the plate's own plane,
             drifting. */
          let sx: number;
          let sy: number;
          let depth = 0;
          const nx = (col + 0.5 - sc) / sCols;
          const ny = ((row + 0.5 - sr) * aspect) / sCols;
          const d2 = nx * nx + ny * ny;
          if (d2 <= 1) {
            depth = Math.sqrt(1 - d2);
            const wy = ny * ct - depth * st;
            const wz = ny * st + depth * ct;
            sx = (Math.atan2(nx, wz) + spin) * 1.9;
            sy = Math.asin(clamp(-wy, -1, 1)) * 2.6;
          } else {
            sx = col / 52 + drift;
            sy = (row * aspect) / 52 - drift * 0.5;
          }
          /* Two fields. The low-frequency one draws the colour regions; the warped one
             draws the form. Neither is derived from the other, which is what keeps the
             colour from being a recolouring of the shape. */
          const zone = fbm(sx * 0.34, sy * 0.34, 3301);
          const warp = fbm(sx * 0.6, sy * 0.6, 907);
          let raw = fbm(sx + warp * 0.9, sy + warp * 0.8, 11);
          /* A slight bias down the box, so the plate has a top and a bottom instead of
             being uniformly busy. */
          raw += 0.04 - 0.08 * (row / rows);
          /* The body reads as a ball because its density falls off toward the limb. No
             rim is drawn and none is needed. */
          raw += 0.1 * depth;
          if (lens.on > 0.02) {
            const d = Math.hypot(col - lens.col, (row - lens.row) * aspect);
            const near = clamp(1 - d / REACH, 0, 1) * lens.on;
            raw += 0.34 * near * near;
          }

          const v = Math.pow(clamp((raw - 0.42) / 0.42, 0, 1), 1.7);
          const step = clamp(Math.round(v * (RAMP.length - 1)), 0, RAMP.length - 1);
          let ch = RAMP[step];
          let tone = TONE[step];
          /* Three colour regions, sized so each holds roughly a third of the ink: two
             low-chroma zones and a neutral one that keeps the tone ladder. The ground
             steps stay neutral in all three — a lattice that changes colour with the
             region reads as a stain rather than as the material underneath. */
          if (step >= 3) {
            if (zone > 0.545) tone = 4;
            else if (zone < 0.455) tone = 5;
          }
          /* The site's own initial, sprinkled through the middle bands. */
          if (step >= 5 && step <= 6 && hash(col, row, 5) < 0.3) ch = 'P';

          if (elapsed < SPREAD_MS + CHURN_MS) {
            const start = delay[cell];
            if (elapsed < start) {
              ch = ' ';
            } else if (elapsed < start + CHURN_MS) {
              ch = CHURN[Math.floor(hash(cell, Math.floor(elapsed / FRAME_MS), 71) * CHURN.length)];
              tone = 4;
            }
          }

          for (let i = 0; i < 6; i++) buf[i].push(i === tone ? ch : ' ');
        }
        if (row < rows - 1) for (const layer of buf) layer.push('\n');
      }
      for (let i = 0; i < 6; i++) layers[i]!.textContent = buf[i].join('');
    };
    if (reduced) {
      elapsed = SPREAD_MS + CHURN_MS;
      draw();
      return;
    }

    let raf = 0;
    let last = 0;
    let visible = true;
    const tick = (now: number) => {
      if (!visible) {
        raf = 0;
        return;
      }
      if (now - last < FRAME_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      const pointer = pointerRef.current;
      if (pointer) {
        lens.col += (pointer.col - lens.col) * 0.16;
        lens.row += (pointer.row - lens.row) * 0.16;
        lens.on = Math.min(1, lens.on + 0.09);
      } else if (lens.on > 0) {
        lens.on = Math.max(0, lens.on - 0.06);
      }
      draw();
      elapsed += FRAME_MS;
      /* The body never stops, so unlike the rest of the plate this loop does not cancel
         itself — the observer below is what keeps a turning world off the CPU while
         nobody is looking at it. */
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const surface = host.parentElement ?? host;
    const onMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      const { w, h } = cellRef.current;
      pointerRef.current = {
        col: (event.clientX - box.left) / w,
        row: (event.clientY - box.top) / h,
      };
    };
    const onLeave = () => {
      pointerRef.current = null;
    };
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerleave', onLeave);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
    });
    io.observe(host);

    wake();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerleave', onLeave);
      pointerRef.current = null;
    };
  }, [grid, reduced]);
  /* The six tones, lightest first, and all six are roles rather than weights of one
     colour. `outline-variant` carries the woven ground — this is the one place it
     belongs on a glyph, because 1.3:1 against `surface-container-highest` is exactly
     what a ground lattice wants; `outline` and `secondary` carry the middles;
     `on-surface-variant` the heavy marks; and the last two are the plate's own low-chroma
     pair, warm and cool, which exist so the texture has two colour regions instead of
     one wash. See the block that defines them in globals.css for why they are a
     signed-off divergence rather than a stray hue. */
  const TONES = [
    'text-outline-variant',
    'text-outline',
    'text-secondary',
    'text-on-surface-variant',
    'text-plate-warm',
    'text-plate-cool',
  ];

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      /* `text-label-s` is chosen for its *cell* rather than for its voice: 11px over a
         16px line box is the densest step on the scale that still resolves a punctuation
         glyph. `font-mono` is the app's own mono stack — the plate only lines up because
         every advance width is equal. */
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden font-mono text-label-s select-none',
        className,
      )}
    >
      {/* Not `hidden`: this has to be laid out to be measurable. */}
      <span ref={probeRef} className="invisible absolute top-0 left-0 whitespace-pre">
        {PROBE}
      </span>
      {TONES.map((tone, i) => (
        <pre
          key={tone}
          ref={(el) => {
            layerRefs.current[i] = el;
          }}
          className={cn('absolute inset-0 m-0', tone)}
        />
      ))}
    </div>
  );




}


