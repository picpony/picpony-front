'use client';

/**
 * Shape vectors for a monospace glyph set, and the nearest-glyph lookup that uses them.
 *
 * **This is the correction to how the /about plate used to work, and it is a correction of
 * kind rather than of degree.** Four versions of that plate mapped one scalar per cell onto a
 * density ramp — `· : + * o # % @` — which is the 1990s image-to-ASCII pipeline, and its defect
 * is structural: a ramp treats each cell as a *pixel* and throws the glyph's shape away. Alex
 * Harri puts it exactly (https://alexharri.com/blog/ascii-rendering): the blurriness "happens
 * because the ASCII characters are being treated like pixels — their shape is ignored", and no
 * amount of supersampling fixes it, because every sample collapses into one number. The output
 * is a low-resolution image scaled back up, which is why it reads as a smudge rather than as a
 * drawing.
 *
 * The method here is his. Every glyph gets a **shape vector**: the fraction of each of six
 * sub-regions of the cell that the glyph's ink covers. The source is sampled at the same six
 * places, and the glyph whose shape is nearest in that space wins. So `T` is picked where the
 * ink is top-heavy, `L` where it is bottom-left, `"` where light sits above dark — the
 * characters land as *marks that match the local structure*, and edges come out crisp because a
 * glyph with an edge in the right place is a better match than a grey one.
 *
 * Six components in a 3x2 arrangement, **staggered vertically** — left column lowered, right
 * column raised. A plain grid of circles leaves gaps between them that a `.` can fall into; the
 * stagger plus a slight overlap covers the cell. Two components are not enough (`-` scores near
 * nothing in both, and `p` and `q` are indistinguishable without a left/right axis).
 *
 * Two things from the article are deliberately left out, and both are stated rather than
 * quietly dropped. **Directional contrast enhancement** — ten more sampling circles reaching
 * into the neighbouring cells, each feeding a subset of the six components — is what removes
 * staircasing along a diagonal boundary; the global enhancement below keeps that artefact. And
 * the k-d tree is unnecessary here: the quantised cache is the same optimisation the article
 * lands on, and at this glyph count a cache miss is a linear scan of a few dozen vectors.
 */

/**
 * The glyph set, chosen for the *variety of shapes* it offers rather than for a range of ink
 * density — which is the whole point. ASCII only: `--font-mono` falls back to a CJK face for
 * anything outside it, and a fallback with a different advance width breaks a grid built out of
 * stacked `<pre>` layers.
 *
 * Deduplicated, which is worth stating because the duplicates were invisible: `n`, `J` and `Y`
 * each appeared twice, so three glyphs were measured twice and `matchGlyph` scanned 73 entries
 * for 70 distinct shapes. A repeat cannot change a pick — the second copy's distance ties the
 * first's and loses the `<` — so this is cost, not behaviour.
 */
const GLYPHS =
  ` .,'"\`^~:;!|/\\_-=+*<>()[]{}oOxXvVwWyYzZtTfFlLiIjJrncsueaCUPbdqpkh#%@&$`.split('');

/**
 * Circle centres in cell space, x and y in [0, 1], and one shared radius.
 *
 * `SAMPLE_R` is exported because the *source* has to be sampled at the same places with the
 * same footprint as the glyphs were measured at, or the two vector spaces are not comparable
 * and the nearest-glyph lookup is answering a different question from the one it was asked.
 * `lib/ascii/markRaster.ts` is the other reader.
 */
export const SAMPLE_R = 0.3;
const SAMPLES: readonly (readonly [number, number])[] = [
  [0.27, 0.24],
  [0.73, 0.16],
  [0.27, 0.5],
  [0.73, 0.42],
  [0.27, 0.76],
  [0.73, 0.68],
];
export const SHAPE_DIMENSIONS = SAMPLES.length;

/**
 * Raster resolution the glyphs are measured at. Higher than the cell, so coverage is smooth.
 *
 * 24x56 is 2.33:1 against the shipped cell's 2.29 (7.0 x 16 CSS px after the device-pixel snap),
 * and the scale that matters is the vertical one — `MEASURE_H / cell.h` = 3.5 — because that is
 * what the glyph is drawn at. The 2% of horizontal slack it leaves puts the advance box at 24.5px
 * in a 24px raster; the sampling circles are inset by 0.27 and 0.73 of the width with a 0.3
 * radius, so nothing reads past 24.
 */
const MEASURE_W = 24;
const MEASURE_H = 56;

export type GlyphTable = {
  glyphs: string[];
  /** `glyphs.length * SHAPE_DIMENSIONS`, row-major, each component normalised to [0, 1]. */
  vectors: Float32Array;
};

/** One table per (weight, spec, cell) — see `getGlyphTable`'s key. */
const tables = new Map<string, GlyphTable>();

/**
 * Measure every glyph once, in the font that actually loaded.
 *
 * Done from the DOM rather than shipped as a constant on purpose: the vectors are a property of
 * the *rendered* face, and this app's mono stack can resolve to Geist Mono or to a fallback. A
 * table baked at build time would describe a font the visitor may not have.
 *
 * **The glyph has to be drawn at the cell's scale, and for a long time it was not.** The raster
 * is `MEASURE_W x MEASURE_H` because the six sampling circles need pixels to average over — it
 * is the *cell*, enlarged. So the glyph must be enlarged with it. It was drawn at the computed
 * `font-size` (11px) into a 24x56 box, i.e. at about a third of the size the box represents,
 * while the baseline *was* scaled — so it sat in the lower-left corner of a raster the circles
 * covered the whole of. Measured in a browser on the real face: four of the six components came
 * out **exactly 0 for all 69 glyphs** (the right column fell outside the circles on x, the top
 * one on y), 136 of 414 entries non-zero — 69 and 414 rather than the set's 70 and 420 because the
 * leading blank's six components are zero by construction and are not part of the question. The per-component normalisation below then divides
 * those by a zero maximum and emits zero, and `matchGlyph`'s distance term for a component that
 * is zero in every glyph is identical across glyphs and cannot affect the argmin. So the lookup
 * was choosing on **two** left-column samples: a two-point density ramp, which is precisely the
 * "treat the character as a pixel" pipeline the block at the top of this file says it replaced.
 * At the correct scale all six carry signal and 387 of 414 entries are non-zero.
 *
 * `cell` is therefore required, and the two derived numbers matter as much as the size: x starts
 * at 0, because a monospace advance times the scale is `MEASURE_W` to within 2% and any nudge is a
 * percentage of the cell rather than a pixel; and the baseline comes from the face's own ascent
 * plus the line box's half-leading, rather than the 0.78 that was hard-coded for one size.
 */
export function getGlyphTable(
  fontSpec: string,
  cell: { w: number; h: number },
  weight = '',
): GlyphTable | null {
  /* Keyed, because none of the three inputs is a constant: the cell is snapped to whole device
     pixels and the weight steps with the ratio, so a window moved between a Retina and a 1x
     display asks for a different table. The single unkeyed slot this had meant the first ratio
     seen won for the session. */
  const key = `${weight}|${fontSpec}|${cell.w}x${cell.h}`;
  const cached = tables.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = MEASURE_W;
  canvas.height = MEASURE_H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const scale = MEASURE_H / cell.h;
  const size = parseFloat(fontSpec) || 0;
  if (!(size > 0) || !(scale > 0)) return null;
  const family = fontSpec.slice(fontSpec.indexOf(' ') + 1);
  /* The weight is a separate argument rather than part of `fontSpec`, and that is not fussiness:
     `size` above is `parseFloat` of the spec, so a leading `560` would be read as the font size.
     It has to be *in* the shorthand though — the CSS `font` shorthand resets every subproperty it
     omits, so a spec without it measures the face at 400 while `.ascii-plate` paints 400/500/560
     by device ratio, i.e. the vectors would describe a face up to 160 units lighter than the one
     on screen. */
  const scaled = `${weight} ${size * scale}px ${family}`.trim();

  /* Where the baseline sits in the line box, measured rather than assumed: half the leading
     the line box adds, plus the face's own ascent. `fontBoundingBox*` is the face's metrics,
     not the drawn glyph's, so it is the same for every character. */
  context.font = scaled;
  const metrics = context.measureText('0');
  const ascent = metrics.fontBoundingBoxAscent || size * scale * 0.98;
  const descent = metrics.fontBoundingBoxDescent || size * scale * 0.24;
  const baseline = Math.max(0, (MEASURE_H - (ascent + descent)) / 2) + ascent;

  const vectors = new Float32Array(GLYPHS.length * SHAPE_DIMENSIONS);
  const radius = SAMPLE_R * MEASURE_W;
  const radius2 = radius * radius;

  for (let g = 0; g < GLYPHS.length; g += 1) {
    context.clearRect(0, 0, MEASURE_W, MEASURE_H);
    context.font = scaled;
    context.fillStyle = '#fff';
    context.textBaseline = 'alphabetic';
    context.fillText(GLYPHS[g], 0, baseline);
    const pixels = context.getImageData(0, 0, MEASURE_W, MEASURE_H).data;

    for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
      const cx = SAMPLES[s][0] * MEASURE_W;
      const cy = SAMPLES[s][1] * MEASURE_H;
      let inside = 0;
      let covered = 0;
      for (let y = 0; y < MEASURE_H; y += 1) {
        const dy = y + 0.5 - cy;
        for (let x = 0; x < MEASURE_W; x += 1) {
          const dx = x + 0.5 - cx;
          /* Circles rather than rectangles, and scaled on y by the cell's own aspect so a
             "circle" in cell space is an ellipse in raster space. */
          if (dx * dx + (dy * dy * MEASURE_W * MEASURE_W) / (MEASURE_H * MEASURE_H) > radius2) {
            continue;
          }
          inside += 1;
          covered += pixels[(y * MEASURE_W + x) * 4 + 3];
        }
      }
      vectors[g * SHAPE_DIMENSIONS + s] = inside ? covered / (inside * 255) : 0;
    }
  }

  /* **Normalisation is mandatory, not cosmetic.** Raw glyph coverage never approaches 1, so
     without it every shape vector sits in one corner of the space while the source's vectors
     span the whole range — and the lookup then only ever reaches the handful of glyphs on the
     edge of that cluster. Per component, against the maximum any glyph reaches. */
  const max = new Float32Array(SHAPE_DIMENSIONS);
  for (let g = 0; g < GLYPHS.length; g += 1) {
    for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
      const value = vectors[g * SHAPE_DIMENSIONS + s];
      if (value > max[s]) max[s] = value;
    }
  }
  for (let g = 0; g < GLYPHS.length; g += 1) {
    for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
      const at = g * SHAPE_DIMENSIONS + s;
      vectors[at] = max[s] > 0 ? vectors[at] / max[s] : 0;
    }
  }

  const built = { glyphs: GLYPHS, vectors };
  tables.set(key, built);
  return built;
}

/**
 * The quantised cache, which is the optimisation that makes this affordable rather than the
 * tree the article tries first.
 *
 * Six components at `CACHE_BITS` levels each, packed into one integer key. The article's own
 * table puts 6 levels at 46,656 possible keys and 10 at a million; it picks 10 for photographic
 * input. This plate's source is a smooth analytic field, so its vectors cluster hard and 8
 * levels (262,144 possible, populated lazily and in practice a few thousand) keeps the picks
 * indistinguishable while the map stays small. Below about 5 the quantisation starts choosing
 * visibly worse glyphs.
 */
const CACHE_BITS = 3;
const CACHE_RANGE = 1 << CACHE_BITS;
const cache = new Map<number, number>();

function cacheKey(vector: Float32Array) {
  let key = 0;
  for (let i = 0; i < SHAPE_DIMENSIONS; i += 1) {
    // The clamp is what stops an input of exactly 1 overflowing into the next component.
    const level = Math.min(CACHE_RANGE - 1, (vector[i] * CACHE_RANGE) | 0);
    key = (key << CACHE_BITS) | level;
  }
  return key;
}

/**
 * Nearest glyph by squared Euclidean distance — the square root is dropped because only the
 * ordering matters, which is the one thing about this that is not the article's.
 */
export function matchGlyph(table: GlyphTable, vector: Float32Array): number {
  const key = cacheKey(vector);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let best = 0;
  let bestDistance = Infinity;
  const { vectors } = table;
  for (let g = 0; g < table.glyphs.length; g += 1) {
    let sum = 0;
    const base = g * SHAPE_DIMENSIONS;
    for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
      const d = vectors[base + s] - vector[s];
      sum += d * d;
    }
    if (sum < bestDistance) {
      bestDistance = sum;
      best = g;
    }
  }
  cache.set(key, best);
  return best;
}

/**
 * Global contrast enhancement — the article's "cel shading" step, and the reason interior
 * boundaries read as edges rather than as two mid-greys blending.
 *
 * Raising each component to a power pulls small values toward zero much harder than large ones,
 * so a vector that was a mushy `T` becomes a `"` — a glyph that states the light-above/dark-below
 * split. Normalising by the vector's own maximum first and scaling back after is what keeps it
 * from darkening everything, and it also makes the step a near no-op on near-uniform vectors, so
 * smooth gradients are not chopped into bands.
 */
export function enhance(vector: Float32Array, exponent: number) {
  let max = 0;
  for (let i = 0; i < SHAPE_DIMENSIONS; i += 1) if (vector[i] > max) max = vector[i];
  if (!(max > 0)) return;
  /* The square is spelled out rather than left to `Math.pow`, because this runs six times per
     cell on every frame and the exponent the plate uses is 2. Measured against `pow` on a
     130x20 grid it is the difference between ~16k library calls a frame and none. */
  if (exponent === 2) {
    for (let i = 0; i < SHAPE_DIMENSIONS; i += 1) {
      const unit = vector[i] / max;
      vector[i] = unit * unit * max;
    }
    return;
  }
  for (let i = 0; i < SHAPE_DIMENSIONS; i += 1) {
    vector[i] = Math.pow(vector[i] / max, exponent) * max;
  }
}

/** Where inside the cell each component samples, for whoever is building the source vector. */
export function sampleOffsets() {
  return SAMPLES;
}
