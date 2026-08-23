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

/** Raster resolution the glyphs are measured at. Higher than the cell, so coverage is smooth. */
const MEASURE_W = 24;
const MEASURE_H = 56;

export type GlyphTable = {
  glyphs: string[];
  /** `glyphs.length * SHAPE_DIMENSIONS`, row-major, each component normalised to [0, 1]. */
  vectors: Float32Array;
};

let table: GlyphTable | null = null;

/**
 * Measure every glyph once, in the font that actually loaded.
 *
 * Done from the DOM rather than shipped as a constant on purpose: the vectors are a property of
 * the *rendered* face, and this app's mono stack can resolve to Geist Mono or to a fallback. A
 * table baked at build time would describe a font the visitor may not have.
 */
export function getGlyphTable(fontSpec: string): GlyphTable | null {
  if (table) return table;
  const canvas = document.createElement('canvas');
  canvas.width = MEASURE_W;
  canvas.height = MEASURE_H;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const vectors = new Float32Array(GLYPHS.length * SHAPE_DIMENSIONS);
  const radius = SAMPLE_R * MEASURE_W;
  const radius2 = radius * radius;

  for (let g = 0; g < GLYPHS.length; g += 1) {
    context.clearRect(0, 0, MEASURE_W, MEASURE_H);
    context.font = fontSpec;
    context.fillStyle = '#fff';
    context.textBaseline = 'alphabetic';
    // Baseline at 78% of the box, which is where a 16px line box puts an 11px face.
    context.fillText(GLYPHS[g], 1, MEASURE_H * 0.78);
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

  table = { glyphs: GLYPHS, vectors };
  return table;
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
