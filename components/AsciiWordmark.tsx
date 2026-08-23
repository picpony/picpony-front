'use client';

/**
 * The /about plate: the site's wordmark, drawn in characters, on a drifting paper.
 *
 * **Form is the mark; texture is the noise.** Four earlier versions had that the other way round
 * — a procedural field was the subject and the mark was absent — and each was rejected for the
 * same reason from a different angle: a noise field has nothing to read. So the shape comes from
 * `lib/ascii/markRaster.ts`, which measures the artwork into one six-component shape vector per
 * cell, and the field survives only as the ground the mark sits on, at about a quarter of the
 * weight. `lib/ascii/shapeVectors.ts` picks the glyph nearest the combined vector, which is why
 * a stem comes out as `|` and a bowl as `(` rather than as grey of the right density.
 *
 * **It is a deliberate echo of the wordmark in front of it, not a duplicate.** `TraceHeader`
 * renders the Lottie mark at 192/256px in the middle of the same `Card`; this fills the box at
 * roughly three times that, concentric with it. Two things keep that reading as editorial rather
 * than as a mistake, and both are load-bearing: at rest the character mark is only a faint
 * structure, low on the tone ladder; and the pointer lens raises the *mark's own weight* as well
 * as the density, so a stroke resolves under the cursor and there is only ever one subject.
 *
 * Six `<pre>` layers, one per tone, each holding a single string. Not a `<span>` per character:
 * on a 130x20 grid that is 2600 elements rebuilt every frame the pointer moves. Nothing is
 * created after mount.
 */

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { getMarkField } from '@/lib/ascii/markRaster';
import {
  enhance,
  getGlyphTable,
  matchGlyph,
  sampleOffsets,
  SHAPE_DIMENSIONS,
  type GlyphTable,
} from '@/lib/ascii/shapeVectors';

/* ------------------------------------------------------------------------- */
/* The paper                                                                 */
/* ------------------------------------------------------------------------- */

/** Ground frequencies, in radians per cell, and phase speeds in radians per second. */
const FX = 0.055;
const FY = 0.075;
const FD = 0.031;
const SPEED_X = 0.35;
const SPEED_Y = -0.24;
const SPEED_D = 0.41;
/** Term weights. The first is the ridge, the other two break it up. */
const W_Y = 0.7;
const W_D = 0.6;

/**
 * Contour folding on the ground, kept from the version where the field *was* the subject.
 *
 * A smooth field's six sub-cell samples differ by almost nothing — measured, a mean spread of
 * 0.013 over a 130x20 grid — so shape matching degenerates to one glyph for the whole plate. The
 * triangle fold turns the field into stacked contour bands and brings the spread to 0.333 mean /
 * 0.758 max, which is what gives the paper its own grain. Fewer bands than the subject version
 * used, because the ground only has to be *not flat*.
 */
const GROUND_BANDS = 9;

/**
 * How the mark and the paper are mixed. Both are coverage in [0, 1], and the mix is **ink over
 * paper**, not ink plus paper.
 *
 * Summing them was wrong in a way that showed on the artwork rather than in the numbers. The paper
 * adds density everywhere, including inside a counter and across the gap between a bowl and its
 * stem — so the hole in the first `P` filled in, and a curve and a bowl joined, whenever the ground
 * happened to be bright there.
 *
 * `W_MARK` is the answer to the other half of it, which is that the mark read as a slab. Good
 * character rendering of line art is *line work*: directional glyphs at middling weight, with the
 * dense end of the set held back for the few cells a stroke actually fills. Thinning the source's
 * stroke to about one cell — see `MARK_STROKE_WIDTH` — is what buys that, and it also drops the ink
 * a cell holds, so this has to be 1 rather than the 0.58 that read well against the fat stroke.
 * Probed in a browser at 0.58: only 8% of the plate reached a coloured step, because a 1.3-cell
 * stroke averages ~0.35 coverage and 0.35 × 0.58 lands below the ring's threshold. At 1 the same
 * cell lands on step 3 and a filled one saturates at 9, so the mark spans the ladder instead of
 * hugging its bottom. The clamp that saturation runs into is legitimate: ink does not stack.
 *
 * 1.6 rather than 1, and the extra is what makes a stroke *continuous*. A 1.3-cell stroke grazes
 * the cells along its edge at ~0.18 coverage, and at 1 those fell under the ring's threshold and
 * dropped back to the neutral ground — so every letter came out dotted. Saturating them instead
 * costs nothing now that the glyph cannot follow the density up; see `GLYPH_PEAK_MAX`.
 */
const W_MARK = 1.6;
const W_GROUND = 0.22;

/**
 * The pointer's swell: reach in cells of width, and how much it develops the mark and the paper.
 *
 * Both are *multipliers*, and there is deliberately no additive lift. A flat lift raises all six
 * components of a cell equally, which is precisely the operation that destroys the contrast a
 * counter depends on — it was the second half of the filled-in-`P` problem.
 */
const REACH = 26;
const LENS_MARK = 0.35;
const LENS_GROUND = 1.4;

const ENHANCE_EXPONENT = 2;

/**
 * The decode. Single-quoted rather than a template literal on purpose: in a template the `\|`
 * collapses and the set silently loses its backslash, which is one of the few glyphs that reads
 * as a stroke in transit.
 */
const CHURN = '/\\|_-=+*<>[]{}()#%$&~^:;01';
const CHURN_MS = 260;
const SPREAD_MS = 620;

/** Idle cadence. The ground's periods are 18s, 26s and 15s, so nothing needs more. */
const FRAME_MS_IDLE = 70;

/** Pointer response, in ms. The lens is the one thing that has to track the finger. */
const FOLLOW_TAU_MS = 80;
const LENS_ON_MS = 140;
const LENS_OFF_MS = 320;

const FALLBACK_CELL = { w: 6.85, h: 16 };
const PROBE_LEN = 40;
const PROBE = '0'.repeat(PROBE_LEN);

/* ------------------------------------------------------------------------- */
/* Tone                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Three neutrals for the paper and the mark's edges, then the logo's six-hue ring for its cores.
 *
 * `outline-variant` carries the woven ground — this is the one place it belongs on a glyph, because
 * 1.3:1 against `surface-container-highest` is exactly what a ground lattice wants. `outline` takes
 * the faint edge where a stroke is only partly in a cell, and `on-surface-variant` is the neutral
 * seam between two bands of the ring. Everything denser than that is the artwork, and the artwork
 * gets the artwork's colours — see the block that defines them in globals.css.
 */
const TONES = [
  'text-outline-variant',
  'text-outline',
  'text-on-surface-variant',
  'text-plate-1',
  'text-plate-2',
  'text-plate-3',
  'text-plate-4',
  'text-plate-5',
  'text-plate-6',
];
/** Index of the first ring tone in `TONES`, and how many there are. */
const RING_FIRST = 3;
const RING_COUNT = 6;

/**
 * Density step (0-9) to neutral tone, and the *ground steps stay neutral in every band*.
 *
 * That last part is the whole reason this is a table rather than a scale: a lattice that changes
 * colour with the band reads as a stain rather than as the material underneath. Steps 0-2 are the
 * paper, 3 is the faint edge where a stroke only partly fills a cell, and 4 up is the artwork —
 * which is where the ring takes over.
 */
const TONE_MAP = [0, 0, 0, 1, 1, 2, 2, 2, 2, 2];
const RING_STEP = 3;

/**
 * The glyph set's ceiling, and the whole of how this plate avoids reading as blobs.
 *
 * `matchGlyph` picks by absolute distance, so the vector's *level* decides which end of the set it
 * can reach. Two probes in a browser bracket the problem: at a low level the plate was five glyphs
 * — `'`, `.`, `,`, a backquote and `;` were 70% of it — and once the level was raised enough for
 * the mark's density to trigger a colour, its strokes came out of the `@ % & $` end and read as
 * solid fill. Neither is line art.
 *
 * So the vector is **rescaled to a target peak** before matching, and the peak is capped. Nothing
 * on the plate can reach the dense end of the set; weight is carried by the tone instead, which is
 * read from the density *before* this. Glyph is shape, tone is weight, and the ceiling is what
 * keeps a saturated stroke drawn as a stroke.
 */
const GLYPH_PEAK_MIN = 0.22;
const GLYPH_PEAK_MAX = 0.5;
/** Coverage at which the ceiling is fully in force; below it the paper keeps its own level. */
const GLYPH_CAP_INK = 0.2;

/**
 * The wordmark's own letters, typed along the mark under the pointer.
 *
 * At rest the plate is shape matching; under the lens the inked cells stop describing the artwork
 * and start spelling it. **Indexed by column, not by a running count along each row** — that is the
 * difference between typography and noise. A per-row counter desynchronises the rows, so the word
 * restarts at a different offset on every line and the result reads as scattered fragments; keyed
 * to the column, every row agrees on which letter belongs at which column, the letters stack into
 * vertical files, and reading across any row gives the word in register. The ink is the mask, so it
 * appears *inside* the letterforms while staying on one global grid.
 */
const WORDMARK = 'PicPony';
/** Lens strength at which a cell switches over, and the coverage it needs to qualify. */
const WORD_AT = 0.45;
const WORD_INK = 0.22;

/**
 * The ring is read by **angle about the plate's centre**, slowly rotating.
 *
 * A linear gradient would have done, and this is better for one reason: the hues come from the `o`
 * of the wordmark, which is a ring, so arranging them as a ring is a citation rather than a
 * decoration. `atan2` is only reached for cells that have earned a colour — roughly a tenth of the
 * plate — so it costs a few hundred calls a frame rather than a few thousand.
 */
const RING_TURNS_PER_SECOND = 0.012;
/** Fraction of each band's width given to a neutral seam, so the ring reads as composed. */
const RING_SEAM = 0.12;

type Grid = { cols: number; rows: number };
const EMPTY: Grid = { cols: 0, rows: 0 };

/** xxHash-style avalanche, for the decode's per-cell delay and its churn glyphs. */
function hash(a: number, b: number, c: number) {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export default function AsciiWordmark({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const layerRefs = useRef<(HTMLPreElement | null)[]>([]);
  const cellRef = useRef(FALLBACK_CELL);
  const pointerRef = useRef<{ col: number; row: number } | null>(null);
  const tableRef = useRef<GlyphTable | null>(null);
  /**
   * The decode's start, held outside the draw effect. As a local it replayed the whole
   * develop-in on any resize that crossed a cell boundary, and on toggling the motion
   * preference — neither of which is a new arrival.
   */
  const decodeRef = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const [grid, setGrid] = useState<Grid>(EMPTY);

  /* Measure the cell from a real run of glyphs rather than from the type scale, because the
     advance includes `--text-label-s--letter-spacing` and the line box is the one the browser
     actually built. The probe's `absolute` is load-bearing: it blockifies the inline span, which
     is what makes `rect.height` the 16px line box instead of the font's inline box. */
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
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const { cols, rows } = grid;
    if (!host || cols === 0 || rows === 0) return;

    /* Measured from the DOM rather than shipped as a constant: the vectors are a property of the
       *rendered* face, and this app's mono stack can resolve to Geist Mono or to a fallback. */
    if (!tableRef.current) {
      const style = getComputedStyle(host);
      tableRef.current = getGlyphTable(`${style.fontSize} ${style.fontFamily}`);
    }
    const table = tableRef.current;
    if (!table) return;

    let live = true;
    let raf = 0;
    let detach: (() => void) | null = null;

    void (async () => {
      const field = await getMarkField(cols, rows, cellRef.current.h / cellRef.current.w);
      if (!live) return;
      const layers = layerRefs.current;
      if (layers.length < TONES.length || layers.some((layer) => !layer)) return;

      const cells = cols * rows;
      const aspect = cellRef.current.h / cellRef.current.w;
      decodeRef.current ??= performance.now();
      const decodeStart = decodeRef.current;
      const settled = SPREAD_MS + CHURN_MS;
      const mark = field?.vectors ?? null;

      const delay = new Float32Array(cells);
      for (let i = 0; i < cells; i += 1) {
        delay[i] = hash(i % cols, (i / cols) | 0, 5501) * SPREAD_MS;
      }

      /* The ground is separable — `sin(u + v) = sin u cos v + cos u sin v` — so each sample costs
         four multiplies once the per-column and per-row terms are built. The x offsets collapse
         to two distinct values; the y offsets do **not** collapse (the sampling grid is staggered
         vertically on purpose, so all six are distinct), which is worth stating because the
         obvious assumption is that they mirror the x axis. */
      const offsets = sampleOffsets();
      const xs = [...new Set(offsets.map(([x]) => x))];
      const ys = [...new Set(offsets.map(([, y]) => y))];
      const xi = offsets.map(([x]) => xs.indexOf(x));
      const yi = offsets.map(([, y]) => ys.indexOf(y));

      const sinX = xs.map(() => new Float32Array(cols));
      const sinD = xs.map(() => new Float32Array(cols));
      const cosD = xs.map(() => new Float32Array(cols));
      const sinY = new Float32Array(ys.length);
      const sinDy = new Float32Array(ys.length);
      const cosDy = new Float32Array(ys.length);
      const vector = new Float32Array(SHAPE_DIMENSIONS);
      /** One string per layer: every cell, plus a newline between rows. */
      const span = cells + rows - 1;
      const buf = Array.from({ length: TONES.length }, () => new Array<string>(span));
      const lens = { col: 0, row: 0, on: 0 };
      const centreCol = cols / 2;
      const centreRow = rows / 2;

      const buildColumns = (t: number) => {
        for (let k = 0; k < xs.length; k += 1) {
          const px = xs[k];
          for (let col = 0; col < cols; col += 1) {
            const x = col + px;
            sinX[k][col] = Math.sin(x * FX + t * SPEED_X);
            sinD[k][col] = Math.sin(x * FD);
            cosD[k][col] = Math.cos(x * FD);
          }
        }
      };

      const paint = (since: number) => {
        const t = reduced ? 0 : since / 1000;
        buildColumns(t);
        const churning = since < settled;
        const churnFrame = (since / FRAME_MS_IDLE) | 0;
        const lit = lens.on > 0.02;
        const ringPhase = t * RING_TURNS_PER_SECOND;
        let at = 0;

        for (let row = 0; row < rows; row += 1) {
          for (let k = 0; k < ys.length; k += 1) {
            const y = (row + ys[k]) * aspect;
            sinY[k] = Math.sin(y * FY + t * SPEED_Y);
            const d = y * FD + t * SPEED_D;
            sinDy[k] = Math.sin(d);
            cosDy[k] = Math.cos(d);
          }
          const dyRing = (row - centreRow) * aspect;

          for (let col = 0; col < cols; col += 1) {
            const cell = row * cols + col;
            let swell = 0;
            if (lit) {
              const dx = col - lens.col;
              const dy = (row - lens.row) * aspect;
              const d2 = dx * dx + dy * dy;
              if (d2 < REACH * REACH) {
                const near = 1 - Math.sqrt(d2) / REACH;
                swell = near * near * lens.on;
              }
            }
            /* The lens is two multipliers, never an addend: it develops the stroke and lights the
               paper, and it must not put any density into a counter. */
            const markWeight = W_MARK * (1 + LENS_MARK * swell);
            const groundWeight = W_GROUND * (1 + LENS_GROUND * swell);
            const base = cell * SHAPE_DIMENSIONS;
            let mean = 0;
            let peakInk = 0;

            for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
              const kx = xi[s];
              const ky = yi[s];
              const h =
                sinX[kx][col] +
                W_Y * sinY[ky] +
                W_D * (sinD[kx][col] * cosDy[ky] + cosD[kx][col] * sinDy[ky]);
              const lifted = (h + 2.3) / 4.6; // the three terms span [-2.3, 2.3]
              const folded = lifted * GROUND_BANDS;
              const ground = Math.abs(2 * (folded - Math.floor(folded)) - 1);
              const ink = mark ? mark[base + s] : 0;
              if (ink > peakInk) peakInk = ink;
              /* The paper is *behind* the ink and stops where the ink becomes opaque. Letting it
                 through everywhere is what made the tittle of the `i` and the top of the `c` flicker
                 between one row and two: a drifting field under a mark only one or two cells thick
                 moves the density step under it every few frames. Above half coverage the artwork
                 alone decides, so those cells are stable. */
              const paper = ink >= 0.5 ? 0 : ground * groundWeight * (1 - ink * 2);
              const v = ink * markWeight + paper;
              const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
              vector[s] = clamped;
              mean += clamped;
            }
            mean /= SHAPE_DIMENSIONS;

            /* Tone is the density as it stands; the glyph comes from the same vector with its peak
               pulled toward a ceiling — but only where there is ink. The paper keeps its own low
               level, which is what makes it read as a quiet lattice; capping it too lifted the whole
               plate to 99% covered and the wordmark vanished into its own background. */
            let peak = 0;
            for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
              if (vector[s] > peak) peak = vector[s];
            }
            const capping = Math.min(1, peakInk / GLYPH_CAP_INK);
            if (peak > 0 && capping > 0) {
              const ceiling = GLYPH_PEAK_MIN + (GLYPH_PEAK_MAX - GLYPH_PEAK_MIN) * mean;
              const scale = (peak + (ceiling - peak) * capping) / peak;
              for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) vector[s] *= scale;
            }
            enhance(vector, ENHANCE_EXPONENT);
            let ch = table.glyphs[matchGlyph(table, vector)];
            const step = Math.min(9, Math.max(0, Math.round(mean * 9)));
            let tone = TONE_MAP[step];
            if (step >= RING_STEP) {
              const dx = col - centreCol;
              /* [0, 1) around the plate's centre. The seam keeps the neutral in `TONE_MAP` for a
                 sliver of each band, so the ring reads as six marks rather than as a smear. */
              const turn = Math.atan2(dyRing, dx) / (Math.PI * 2) + 0.5 + ringPhase;
              const scaled = (turn - Math.floor(turn)) * RING_COUNT;
              const withinBand = scaled - Math.floor(scaled);
              if (withinBand > RING_SEAM) tone = RING_FIRST + (Math.floor(scaled) % RING_COUNT);
            }

            /* Under the lens the mark stops describing itself and spells itself. */
            if (swell > WORD_AT && peakInk > WORD_INK) {
              ch = WORDMARK[col % WORDMARK.length];
            }

            if (churning) {
              const start = delay[cell];
              if (since < start) {
                ch = ' ';
              } else if (since < start + CHURN_MS) {
                ch = CHURN[(hash(cell, churnFrame, 73) * CHURN.length) | 0];
                /* Neutral, not the warm zone tone. Every cell churns at once, so tinting the
                   churn made the plate open as one flat wash of the warm colour before any of
                   the artwork had resolved — the develop-in should be grey becoming colour. */
                tone = 1;
              }
            }

            for (let i = 0; i < TONES.length; i += 1) buf[i][at] = i === tone ? ch : ' ';
            at += 1;
          }
          if (row < rows - 1) {
            for (const layer of buf) layer[at] = '\n';
            at += 1;
          }
        }
        for (let i = 0; i < TONES.length; i += 1) layers[i]!.textContent = buf[i].join('');
      };

      /**
       * Under `prefers-reduced-motion` it draws the settled plate and stops. No decode, no drift,
       * no pointer — the early return is before the listeners are attached, so the lens is absent
       * rather than damped, deliberately. The preference asks for less movement, not for an empty
       * box, and this is the container's only texture. The `await` above is why this branch is
       * inside the async body: painting before the raster resolves would draw nothing at all.
       */
      if (reduced) {
        paint(settled);
        return;
      }

      let visible = true;
      let last = 0;
      const tick = (now: number) => {
        raf = 0;
        if (!live || !visible) return;
        const pointer = pointerRef.current;
        const active = pointer !== null || lens.on > 0.02;
        const elapsed = last ? now - last : FRAME_MS_IDLE;
        /* Full rAF cadence while the lens is alive, because a lens at 14fps reads as stuck rather
           than as following; the idle gate is for the drift, whose slowest period is 26s. */
        if (!active && last && elapsed < FRAME_MS_IDLE) {
          raf = requestAnimationFrame(tick);
          return;
        }
        /* Wall-clock delta, capped: the phase used to be counted in frames, so a variable frame
           interval changed the drift speed with it. The cap is for a backgrounded tab. */
        const delta = Math.min(elapsed, 200);
        last = now;
        if (pointer) {
          const follow = 1 - Math.exp(-delta / FOLLOW_TAU_MS);
          lens.col += (pointer.col - lens.col) * follow;
          lens.row += (pointer.row - lens.row) * follow;
          lens.on = Math.min(1, lens.on + delta / LENS_ON_MS);
        } else if (lens.on > 0) {
          lens.on = Math.max(0, lens.on - delta / LENS_OFF_MS);
        }
        paint(now - decodeStart);
        raf = requestAnimationFrame(tick);
      };
      const wake = () => {
        if (!raf && live && visible) raf = requestAnimationFrame(tick);
      };

      /* The listener goes on the `Card`, not on the plate: the plate is `pointer-events-none` and
         the wordmark in front of it counts its own ten clicks. */
      const surface = host.parentElement ?? host;
      const onMove = (event: PointerEvent) => {
        const box = host.getBoundingClientRect();
        const { w, h } = cellRef.current;
        pointerRef.current = {
          col: (event.clientX - box.left) / w,
          row: (event.clientY - box.top) / h,
        };
        wake();
      };
      const onLeave = () => {
        pointerRef.current = null;
      };
      surface.addEventListener('pointermove', onMove);
      surface.addEventListener('pointerleave', onLeave);

      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        /* Reset the frame clock on re-entry, or a long occlusion arrives as one huge delta. */
        if (visible) {
          last = 0;
          wake();
        }
      });
      io.observe(host);

      detach = () => {
        surface.removeEventListener('pointermove', onMove);
        surface.removeEventListener('pointerleave', onLeave);
        io.disconnect();
        pointerRef.current = null;
      };
      wake();
    })();

    return () => {
      live = false;
      if (raf) cancelAnimationFrame(raf);
      detach?.();
    };
  }, [grid, reduced]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden font-mono text-label-s select-none',
        className,
      )}
    >
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
