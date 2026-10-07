/**
 * The mascot's silhouette: where in its artwork the character actually is. The server reads it
 * from the artwork's alpha (`app/mascot-shape/route.ts`); the figure turns it into its hit region,
 * where its speech bubble points and where its collapse control can stand clear of it
 * (`components/mascot/Mascot.tsx`). Plain and import-free, so both sides — and the Node tests —
 * share one copy.
 */

/** Cells along the artwork's longer side: about 3px at the largest figure (300px), finer than any
    pointer needs, and a kilobyte on the wire. */
export const MASCOT_SHAPE_GRID = 96;

/** A cell is the character from this alpha up, of 255: its soft outer glow counts, a faint haze
    does not. */
export const MASCOT_SHAPE_ALPHA = 48;

export interface MascotShape {
  /** The grid, in cells; its aspect is the artwork's. */
  w: number;
  h: number;
  /** Per row, the runs of character cells as `[start, end, start, end, …]`, each `end` exclusive. */
  rows: number[][];
}

/** The runs of a `w` × `h` alpha grid, row by row. */
export function shapeRows(alpha: ArrayLike<number>, w: number, h: number, min = MASCOT_SHAPE_ALPHA): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < h; y += 1) {
    const runs: number[] = [];
    let start = -1;
    for (let x = 0; x <= w; x += 1) {
      const on = x < w && alpha[y * w + x] >= min;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        runs.push(start, x);
        start = -1;
      }
    }
    rows.push(runs);
  }
  return rows;
}

/** A shape as the server sent it, or null: every number a whole cell inside the grid, ascending. */
export function parseMascotShape(value: unknown): MascotShape | null {
  if (!value || typeof value !== 'object') return null;
  const { w, h, rows } = value as Record<string, unknown>;
  const cells = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 256;
  if (!cells(w) || !cells(h) || !Array.isArray(rows) || rows.length !== h) return null;
  for (const runs of rows) {
    if (!Array.isArray(runs) || runs.length % 2 !== 0 || runs.length > w + 1) return null;
    let last = -1;
    for (let i = 0; i < runs.length; i += 1) {
      const x = runs[i];
      if (!Number.isInteger(x) || x < 0 || x > w || x < last || (i % 2 === 1 && x === runs[i - 1])) return null;
      last = x;
    }
  }
  return { w, h, rows: rows as number[][] };
}

/**
 * The silhouette as an SVG path in the figure's own pixels, for `clip-path: path()` — which clips
 * hit-testing as well as paint, so only the character answers a pointer. One rectangle per run,
 * grown by `pad` px all round (a disc, so a tip grows round rather than square) to forgive an aim
 * at a thin hoof or a wing's edge, with consecutive rows that agree to a pixel merged into one.
 * Rectangles all drawn the same way round union under the default fill rule.
 */
export function shapePath(shape: MascotShape, width: number, height: number, pad: number): string {
  const cw = width / shape.w;
  const ch = height / shape.h;
  const reach = Math.ceil(pad / ch) + 1;
  let path = '';
  /* The band being built: the union of its rows, and the row that opened it — a row joins only
     within a pixel of that first one, so a slanting edge cannot drift a band wider row by row. */
  let open: number[] = [];
  let anchor: number[] = [];
  let top = 0;
  const flush = (bottom: number) => {
    if (bottom <= top) return;
    for (let i = 0; i < open.length; i += 2) path += `M${open[i]} ${top}H${open[i + 1]}V${bottom}H${open[i]}Z`;
  };
  for (let y = 0; y < shape.h; y += 1) {
    const spans: [number, number][] = [];
    for (let dy = -reach; dy <= reach; dy += 1) {
      const runs = shape.rows[y + dy];
      if (!runs?.length) continue;
      /* The gap between the two rows' bands: none for this row and its neighbours. Another row is
         reached only by a pad that crosses its gap — with none, the region is the character's own
         cells. */
      const gap = Math.max(0, Math.abs(dy) - 1) * ch;
      if (dy !== 0 && gap >= pad) continue;
      const grow = Math.sqrt(pad * pad - gap * gap);
      for (let i = 0; i < runs.length; i += 2) spans.push([runs[i] * cw - grow, runs[i + 1] * cw + grow]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const row: number[] = [];
    for (const [a, b] of spans) {
      const start = Math.max(0, Math.floor(a));
      const end = Math.min(width, Math.ceil(b));
      if (end <= start) continue;
      if (row.length && start <= row[row.length - 1] + 1) row[row.length - 1] = Math.max(row[row.length - 1], end);
      else row.push(start, end);
    }
    const y0 = Math.round(y * ch);
    if (row.length === anchor.length && row.every((x, i) => Math.abs(x - anchor[i]) <= 1)) {
      for (let i = 0; i < row.length; i += 2) {
        open[i] = Math.min(open[i], row[i]);
        open[i + 1] = Math.max(open[i + 1], row[i + 1]);
      }
      continue;
    }
    flush(y0);
    open = row;
    anchor = [...row];
    top = y0;
  }
  flush(Math.round(height));
  return path;
}

/** A box over or beside the artwork, in the figure's pixels; `top` is negative above it. */
export interface ShapeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far `box` has to rise to keep `clear` px off the character — 0 where it already does. The
 * first row the box comes near decides it: the box has to stand above that row, whatever is below.
 */
export function shapeLift(shape: MascotShape, width: number, height: number, box: ShapeBox, clear: number): number {
  const cw = width / shape.w;
  const ch = height / shape.h;
  for (let y = 0; y < shape.h; y += 1) {
    const top = y * ch;
    if (top >= box.bottom + clear) return 0;
    const runs = shape.rows[y];
    for (let i = 0; i < runs.length; i += 2) {
      if (runs[i + 1] * cw > box.left - clear && runs[i] * cw < box.right + clear) return box.bottom + clear - top;
    }
  }
  return 0;
}

/**
 * Where the character's head is, as fractions of the artwork: the top of the silhouette, and the
 * middle of what is in its top tenth — the ears and the crown on a pony, whatever an artwork puts
 * highest otherwise. The speech bubble's tail points there.
 */
export function shapeHead(shape: MascotShape): { x: number; top: number } | null {
  const first = shape.rows.findIndex((runs) => runs.length > 0);
  if (first < 0) return null;
  let last = first;
  for (let y = shape.h - 1; y > first; y -= 1) {
    if (shape.rows[y].length) {
      last = y;
      break;
    }
  }
  const band = Math.max(1, Math.round((last - first + 1) * 0.1));
  let sum = 0;
  let count = 0;
  for (let y = first; y < first + band; y += 1) {
    const runs = shape.rows[y];
    for (let i = 0; i < runs.length; i += 2) {
      const cells = runs[i + 1] - runs[i];
      sum += ((runs[i] + runs[i + 1]) / 2) * cells;
      count += cells;
    }
  }
  return { x: sum / count / shape.w, top: first / shape.h };
}
