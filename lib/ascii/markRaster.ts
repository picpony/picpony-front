'use client';

/**
 * The wordmark, rasterised into one shape vector per character cell.
 *
 * **This is the half of the /about plate that the four previous versions got wrong, and the
 * mistake was not a tuning mistake.** Every one of them mapped one scalar per cell onto a
 * density ramp, which is the 1990s image-to-ASCII pipeline: it treats each cell as a *pixel* and
 * throws the glyph's shape away, so letterforms came out as a smudge. `./shapeVectors` is the
 * correction — see its own header for the method — and a **letterform is the ideal subject for
 * it**: a stem wants `|`, a bowl wants `(` and `)`, a terminal wants `"` or a backquote. The
 * marks land as marks that match the local structure rather than as grey of the right weight.
 *
 * Two things this module owes the matcher, and both are load-bearing rather than stylistic:
 *
 *   - It samples at `sampleOffsets()` with `SAMPLE_R`, averaging **alpha over the same ellipse**
 *     `getGlyphTable` measured each glyph with. Sample the source any other way and the two
 *     vector spaces are not comparable, so the nearest-glyph lookup answers a question nobody
 *     asked.
 *   - It keeps coverage **continuous**. Thresholding to ink/no-ink puts a hard edge on a
 *     6.85x16px cell, which is a staircase; antialiased coverage is what lets a stroke's edge
 *     resolve into the character set, which is what a halftone is.
 *
 * Everything here is measured from the artwork at runtime rather than written down, because the
 * artwork is generated (`picpony-g.svg` is the Lottie's final frame flattened to one colour) and
 * a constant would describe whichever revision happened to be on disk when it was taken.
 */

import { clamp } from '@/lib/utils';
import { SAMPLE_R, SHAPE_DIMENSIONS, sampleOffsets } from './shapeVectors';

/** Which lockup the plate is showing. `pic` is a monogram, not a crop — see `pickSubject`. */
export type MarkSubject = 'full' | 'pic';

export type MarkField = {
  subject: MarkSubject;
  cols: number;
  rows: number;
  /** `cols * rows * SHAPE_DIMENSIONS`, row-major, each component raw coverage in [0, 1]. */
  vectors: Float32Array;
};

const MARK_SRC = '/img/picpony-g.svg';

/**
 * The stroke width the artwork is rasterised at, replacing its own 14.
 *
 * **This is the difference between character rendering and a stencil, and it was measured.** At the
 * artwork's own width a vertical stroke lands ~3 cells wide on a desktop plate — cells are 2.34x
 * taller than they are wide, so the horizontal count is the one that blows up — and a cell entirely
 * inside a stroke has six equal samples, no structure, and therefore no shape for `matchGlyph` to
 * match. Probed in a browser: 16.4% of the whole plate came out as the single glyph `a`, because
 * that is what the matcher returns for a uniform mid-density cell.
 *
 * At 6 the same stroke is ~1.3 cells across, so **every cell holding ink is a partial cell** with an
 * edge running through it, which is what makes the matcher reach for `|` and `/` and `(` and `-`.
 * Good ASCII line art draws lines one character wide; this is that constraint, applied to the
 * source rather than to the output.
 *
 * It also thins the mark, which is the other half of "too heavy" — and it leaves the thirteen
 * *filled* ornament paths alone, since a solid in the artwork should read as a solid.
 */
const MARK_STROKE_WIDTH = 6;

/** Sub-cell raster resolution on x; y is derived so a sub-pixel comes out roughly square. */
const SS_X = 8;

/**
 * How much of the plate the mark may fill, per axis, and the two numbers differ on purpose.
 *
 * At the wide end both subjects are **width**-bound — the monogram's aspect is ~2.0 against a phone
 * plate's 1.34, the wordmark's is ~3.9 against a desktop plate's 2.8 — so `MARK_FIT_X` is the one
 * that normally decides, and it spends the scarce axis. `MARK_FIT_Y` only bites in the middle of the
 * range, where a plate has gone narrow enough to pick the monogram but is still 20 rows tall: there
 * the fit flips to height-bound and one shared number put the monogram at 17 of 20 rows, which is
 * the "it looks big and strange" case. 0.72 brings that to ~14 and leaves both ends untouched.
 */
const MARK_FIT_X = 0.86;
const MARK_FIT_Y = 0.72;

/**
 * How much of the vertical optical correction to apply, 0 for box-centred and 1 for centroid.
 *
 * Damped rather than full, because the centroid of a mark with a descender sits low enough that
 * aiming it at the middle lifts the whole thing further than the eye wants.
 */
const OPTICAL_MIX = 0.55;

/**
 * The legibility floor, in rows, below which the full wordmark is replaced by the monogram.
 *
 * Derived rather than chosen, and deliberately not a media query. Rasterised at
 * `MARK_STROKE_WIDTH`, a stroke is ~4.6% of the wordmark's ink height, so a mark H rows tall draws a
 * horizontal stroke 0.046*H rows thick and a vertical one about 0.11*H cells across. At 10 rows that
 * is 0.46 of a row and 1.1 of a cell — the point at which a stroke still resolves into characters
 * rather than into a dotted line.
 *
 * It was 12, which put the switch at a ~865px plate: wide enough that an ordinary desktop window
 * showed the *monogram*, which is not what the two subjects are for. 10 puts it at ~720px, so the
 * full wordmark appears wherever there is room to read it and the monogram is reserved for a phone,
 * where the full mark would be 4.9 rows. Neither number is a breakpoint; both follow the stroke.
 */
const MIN_MARK_ROWS = 10;

/** Resolution of the one-off profile pass that finds the ink box and the centroid. */
const PROFILE_W = 256;

/**
 * Where `Pic` ends, as a fraction of the ink box's width. **Measured, and it has to be a constant.**
 *
 * Two earlier attempts tried to *find* the boundary rather than state it, and both shipped wrong.
 * The letterforms are ten **continuous** strokes rather than glyphs — one path's box runs from 676 to
 * 1608 in viewBox units, crossing the `i` and the `c` and into the second `P` — so the group
 * structure has no letter boundary in it. Nor does the ink: probed in a browser, the widest run of
 * near-empty columns anywhere in the left 60% is **three columns at 0.18 of the ink width**, the gap
 * after the first `P`, and it is the only run there is. A "widest gap" search therefore returns `P`
 * alone, at aspect 0.80, which then fits by height and fills the plate.
 *
 * So it is read off a rendered silhouette once. `c`'s bowl closes at 0.32 and the second `P`'s stem
 * begins at 0.41. Anything between is a *connecting* stroke — this is a script face, and the `c`
 * ligatures onward — so some of it is cut whatever the number is. **0.34 is where the cut leaves the
 * two arms exiting as near-horizontal terminals rather than as hooks curling back**, which is what
 * 0.38-0.40 produced and what read as a stray curve above the `c`. Aspect comes out 1.70.
 */
const PIC_CUT = 0.34;

type MarkGeometry = {
  image: HTMLImageElement;
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** The profile pass's alpha plane, kept so each subject can be measured on its own. */
  alpha: Uint8Array;
  profileWidth: number;
  profileHeight: number;
  /** Right edge of the `Pic` monogram, in profile columns. */
  picCutColumn: number;
};

/** A subject's own ink box and its coverage centroid, both in viewBox units. */
type SubjectMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
  centroidX: number;
  centroidY: number;
};

let geometryPromise: Promise<MarkGeometry | null> | null = null;
const fields = new Map<string, MarkField>();
const metrics = new Map<MarkSubject, SubjectMetrics | null>();

/**
 * Decode the SVG at a size it does not declare.
 *
 * `picpony-g.svg` carries a `viewBox` and **no `width`/`height`**, which is the one case
 * `drawImage` cannot be trusted with — an image with no intrinsic size draws at whatever the
 * implementation feels like. Injecting the viewBox's dimensions gives it one. `preserveAspectRatio`
 * is forced to `none` at the same time, on purpose: the sub-pixel grid is non-square (`SS_X` per
 * cell width against a derived count per cell height), so the correct fit needs a slightly
 * different scale per axis, and `meet` would letterbox inside the destination box instead of
 * honouring it. Every scale this module passes is computed from the ink box, so `none` is exact
 * by construction rather than a licence to stretch.
 *
 * The file is self-contained — no `use`, `image`, `style` or external reference — so the canvas
 * is never tainted and `getImageData` works.
 */
async function decodeMark(): Promise<{ image: HTMLImageElement; width: number; height: number } | null> {
  const response = await fetch(MARK_SRC);
  if (!response.ok) return null;
  const source = await response.text();
  const viewBox = source.match(/viewBox="([^"]+)"/);
  if (!viewBox) return null;
  const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , width, height] = parts;
  if (!(width > 0) || !(height > 0)) return null;

  const sized = source
    .replace(/\spreserveAspectRatio="[^"]*"/, '')
    .replace(/stroke-width="[\d.]+"/g, `stroke-width="${MARK_STROKE_WIDTH}"`)
    .replace('<svg', `<svg width="${width}" height="${height}" preserveAspectRatio="none"`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { image, width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function context2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently: true });
}

/**
 * One cheap pass that keeps the alpha plane, because **each subject has to be measured on its
 * own** and the full ink box is the wrong box for the monogram twice over.
 *
 * Horizontally it is obvious: `Pic` ends where the profile's gap is. Vertically it is not, and
 * getting it wrong is exactly what made the monogram sit high and right. The full box's bottom
 * edge is set by the `y` of "Pony" (~880) while `Pic` bottoms out around 748, so reusing it left
 * ~110 units of empty box under the letters; and its top is set by the first `P`, which is also
 * the tallest thing in the whole mark, so nothing balanced that out.
 *
 * The ink box is also not the viewBox: measured, the ink fills 90.8% of the width but only
 * **69.7% of the height**, leaving ~176 units of air above and ~127 below.
 */
function measureGeometry(
  image: HTMLImageElement,
  viewBoxWidth: number,
  viewBoxHeight: number,
): MarkGeometry | null {
  const width = PROFILE_W;
  const height = Math.max(1, Math.round((PROFILE_W * viewBoxHeight) / viewBoxWidth));
  const context = context2d(width, height);
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height).data;

  const alpha = new Uint8Array(width * height);
  let minX = width;
  let maxX = -1;
  for (let i = 0; i < alpha.length; i += 1) {
    const a = source[i * 4 + 3];
    if (a === 0) continue;
    alpha[i] = a;
    const x = i % width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (maxX < 0) return null;

  return {
    image,
    viewBoxWidth,
    viewBoxHeight,
    alpha,
    profileWidth: width,
    profileHeight: height,
    picCutColumn: minX + (maxX + 1 - minX) * PIC_CUT,
  };
}

/**
 * A subject's own ink box **and its coverage centroid**, in viewBox units.
 *
 * The centroid is what the plate centres on, not the box's middle. Every letterform has more mass
 * at x-height than at its extremes, and this mark has a descender at one end and the tallest
 * ascender in the set at the other — so box-centring puts the visible weight high, which is
 * exactly how it read. Weighting by coverage is optical centring with no fudge factor in it.
 */
function subjectMetrics(geometry: MarkGeometry, subject: MarkSubject): SubjectMetrics | null {
  const cached = metrics.get(subject);
  if (cached !== undefined) return cached;

  const { alpha, profileWidth: width, profileHeight: height } = geometry;
  const lastColumn = subject === 'pic' ? Math.ceil(geometry.picCutColumn) - 1 : width - 1;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let mass = 0;
  let momentX = 0;
  let momentY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x <= lastColumn; x += 1) {
      const a = alpha[y * width + x];
      if (a === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      mass += a;
      momentX += a * (x + 0.5);
      momentY += a * (y + 0.5);
    }
  }
  if (maxX < 0 || !(mass > 0)) {
    metrics.set(subject, null);
    return null;
  }

  const perX = geometry.viewBoxWidth / width;
  const perY = geometry.viewBoxHeight / height;
  const value: SubjectMetrics = {
    x: minX * perX,
    y: minY * perY,
    width: (maxX + 1 - minX) * perX,
    height: (maxY + 1 - minY) * perY,
    centroidX: (momentX / mass) * perX,
    centroidY: (momentY / mass) * perY,
  };
  metrics.set(subject, value);
  return value;
}

async function getGeometry(): Promise<MarkGeometry | null> {
  geometryPromise ??= (async () => {
    const decoded = await decodeMark();
    if (!decoded) return null;
    return measureGeometry(decoded.image, decoded.width, decoded.height);
  })();
  return geometryPromise;
}

/**
 * Full wordmark where it can be read, monogram where it cannot.
 *
 * Both branches are a complete lockup at their own size, which is the difference between this and
 * the arbitrary crop the first version of the plate used. Measured: on a ~130x20 desktop plate the
 * full mark fits at 13.5 rows; on a ~50x16 phone plate it fits at 5.2, which is well under
 * `MIN_MARK_ROWS`, and the monogram fits at ~13.
 */
function pickSubject(geometry: MarkGeometry, cols: number, rows: number, cellAspect: number) {
  const full = fitCells(geometry, 'full', cols, rows, cellAspect);
  return full && full.height >= MIN_MARK_ROWS ? 'full' : 'pic';
}

/** Contain-fit of a subject's own ink box into the plate, in **cell** units. */
function fitCells(
  geometry: MarkGeometry,
  subject: MarkSubject,
  cols: number,
  rows: number,
  cellAspect: number,
) {
  const box = subjectMetrics(geometry, subject);
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  /* The ink's aspect is a *pixel* ratio; cells are ~2.34x taller than wide, so it has to be
     restated in cell units before it can be compared with `cols / rows`. */
  const aspect = (box.width / box.height) * cellAspect;
  const width = Math.min(cols * MARK_FIT_X, rows * MARK_FIT_Y * aspect);
  return { width, height: width / aspect, box, aspect };
}

/**
 * One shape vector per cell for the plate at this grid, memoised.
 *
 * The precomputation is the whole reason this is a module rather than a few lines in the
 * component. Each of the six components averages ~43 sub-pixels, so a cell costs ~258 reads and
 * a 130x20 plate ~670k — impossible per frame, unremarkable per grid (~3ms). The mark is static,
 * so the frame loop gets six array reads per cell and spends its budget on the ground field and
 * the pointer lens instead.
 */
export async function getMarkField(
  cols: number,
  rows: number,
  cellAspect: number,
): Promise<MarkField | null> {
  if (!(cols > 0) || !(rows > 0) || !(cellAspect > 0)) return null;
  const geometry = await getGeometry();
  if (!geometry) return null;

  const subject = pickSubject(geometry, cols, rows, cellAspect);
  const ssY = Math.max(1, Math.round(SS_X * cellAspect));
  const key = `${cols}x${rows}x${ssY}x${subject}`;
  const cached = fields.get(key);
  if (cached) return cached;

  const width = cols * SS_X;
  const height = rows * ssY;
  const context = context2d(width, height);
  if (!context) return null;

  const fit = fitCells(geometry, subject, cols, rows, cellAspect);
  if (!fit) return null;
  const targetWidth = fit.width * SS_X;
  const targetHeight = fit.height * ssY;
  const scaleX = targetWidth / fit.box.width;
  const scaleY = targetHeight / fit.box.height;

  /* Horizontally the **box** is centred, vertically the **coverage centroid** is — and the split is
     not an inconsistency. A word is set by its bounding box: `Pic` is left-heavy (a `P` against an
     `i` and a `c`), so aiming its centroid at the middle drives it right until the clamp pins it
     flush against the edge, which is exactly how it read. The vertical adjustment is the one type
     actually makes: this mark has a descender at one end and the tallest ascender in the set at the
     other, so box-centring puts the visible weight off the middle. It is damped, because the full
     correction over-lifts a mark whose mass sits low. */
  const slackX = width - targetWidth;
  const slackY = height - targetHeight;
  const centred = slackY / 2;
  const optical = height / 2 - (fit.box.centroidY - fit.box.y) * scaleY;
  const offsetX = slackX / 2;
  const offsetY = clamp(centred + OPTICAL_MIX * (optical - centred), 0, slackY);

  /* **Clipped to the subject's box, which is what makes `pic` a monogram rather than a crop.**
     `drawImage` paints the whole artwork; only the *metrics* were restricted to the columns left of
     the cut. So the monogram was positioned and scaled by the `Pic` box while "Pony" carried on off
     the right edge — and wherever the monogram came out height-bound, and therefore large, what
     spilled was most of a second `P`. That is the "only Picp shows, and it is pushed right" report,
     and no amount of placement arithmetic fixes it because the extra ink is real. */
  context.save();
  context.beginPath();
  context.rect(offsetX, offsetY, targetWidth, targetHeight);
  context.clip();
  /* The destination rect is the whole viewBox scaled, shifted so the *ink box* lands where the
     placement put it. */
  context.drawImage(
    geometry.image,
    offsetX - fit.box.x * scaleX,
    offsetY - fit.box.y * scaleY,
    geometry.viewBoxWidth * scaleX,
    geometry.viewBoxHeight * scaleY,
  );
  context.restore();

  const field: MarkField = {
    subject,
    cols,
    rows,
    vectors: sampleCells(context, width, height, cols, rows, ssY),
  };
  fields.set(key, field);
  return field;
}

/**
 * Average alpha over each cell's six sampling ellipses.
 *
 * The ellipse is `SAMPLE_R` of a cell in both axes, which in this raster is `SAMPLE_R * SS_X`
 * across and `SAMPLE_R * ssY` down — the same footprint, in the same cell-space units, that
 * `getGlyphTable` measured the glyphs with. Coverage is left raw in [0, 1]: the glyph table is
 * normalised per component against the strongest glyph precisely so that a source spanning the
 * full range reaches the whole set, and ink coverage does span it.
 */
function sampleCells(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cols: number,
  rows: number,
  ssY: number,
): Float32Array {
  const alpha = context.getImageData(0, 0, width, height).data;
  const offsets = sampleOffsets();
  const radiusX = SAMPLE_R * SS_X;
  const radiusY = SAMPLE_R * ssY;
  const spanX = Math.ceil(radiusX);
  const spanY = Math.ceil(radiusY);
  const vectors = new Float32Array(cols * rows * SHAPE_DIMENSIONS);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const base = (row * cols + col) * SHAPE_DIMENSIONS;
      for (let s = 0; s < SHAPE_DIMENSIONS; s += 1) {
        const cx = (col + offsets[s][0]) * SS_X;
        const cy = (row + offsets[s][1]) * ssY;
        let inside = 0;
        let covered = 0;
        const y0 = Math.max(0, Math.floor(cy - spanY));
        const y1 = Math.min(height - 1, Math.ceil(cy + spanY));
        const x0 = Math.max(0, Math.floor(cx - spanX));
        const x1 = Math.min(width - 1, Math.ceil(cx + spanX));
        for (let y = y0; y <= y1; y += 1) {
          const dy = (y + 0.5 - cy) / radiusY;
          const dy2 = dy * dy;
          if (dy2 > 1) continue;
          for (let x = x0; x <= x1; x += 1) {
            const dx = (x + 0.5 - cx) / radiusX;
            if (dx * dx + dy2 > 1) continue;
            inside += 1;
            covered += alpha[(y * width + x) * 4 + 3];
          }
        }
        vectors[base + s] = inside ? covered / (inside * 255) : 0;
      }
    }
  }
  return vectors;
}
