'use client';

import CheckGlyph from '@/components/CheckGlyph';
import type { FaceScheme, PaletteHues, PaletteTone } from '@/lib/appearance';
import { cn } from '@/lib/utils';

/**
 * Geometry per size. `tile` fills a 72 × 56 tile (the palette picker in /settings, and
 * 从图片取色's options); `compact` a 48 × 36 one (`ColorPicker`'s 副色相 tiles). The bar takes a
 * little under half the height at either size — the theme's identity is its bar, so it is the
 * largest area — and the page holds one row: the selection's pill at the leading edge, the
 * accent's dot at the trailing one.
 */
const SIZES = {
  tile: { bar: 'h-6', row: 'top-6 px-2', pick: 'h-2.5 w-8', accent: 'size-2.5' },
  compact: { bar: 'h-4', row: 'top-4 px-1.5', pick: 'h-2 w-5', accent: 'size-2' },
} as const;

/**
 * A theme in miniature: a band of its `primary` across the top — its app bar — over its own page,
 * and on the page what a selection wears there and, under 多色, a dot of the accent. A tile shows
 * *a theme*, where a disc is the shape of *a colour*: the chip this replaced quartered a disc to
 * fit a theme into it, and a pale second colour greyed the pie. Here each colour sits where the
 * theme puts it, at the size it has there — the selection a quiet pill, the accent a mark — so 单色
 * shows one hue and 多色 its two more without a word of explanation.
 *
 * **Borderless.** The page is the theme's `surface-container-lowest`, the one step that separates
 * by tone from every surface a tile is drawn on (numbers on `FACE_ROLES`, `lib/paletteRule.ts`;
 * ASSERTION 16) — this app separates by tone, and a keyline around a tile is an edge the tone
 * already draws. The caller's box gives the corner and clips; under forced colours the box draws
 * the system's edge itself, since these fills are flattened to the canvas.
 *
 * **The selected tile carries a check badge at its top-right**: a disc of the theme's `primary`
 * with its `on-primary` tick — the pair every theme clears. It sits on the bar, so in colour the
 * disc is the bar and the tick is what shows; the disc is there for forced colours, where it takes
 * the system's selection pair (Highlight under HighlightText) while the bar goes to the canvas. It is
 * concentric with the tile's 12dp corner: a 20dp disc 2dp inside it.
 *
 * Colours are inline for the reason `PalettePreview` gives: every token is the active theme's.
 * Every layer sits at a negative z-index, under the state layer's pseudo-element in the tile's own
 * stacking context, so a hover tints the whole miniature evenly — the badge included, or its disc
 * would surface out of a tinted bar.
 */
export default function PaletteTileFace({
  tone,
  face,
  hues,
  selected = false,
  size = 'tile',
}: {
  /** The theme's bar in the scheme in force. */
  tone: PaletteTone;
  /** Its face in the scheme in force. */
  face: FaceScheme;
  /** 配色方案 in force: which page and selection, and whether the accent is shown. */
  hues: PaletteHues;
  selected?: boolean;
  size?: keyof typeof SIZES;
}) {
  const multi = hues === 'multi';
  const geometry = SIZES[size];
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: multi ? face.page : face.monoPage }}
      />
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-0 top-0 -z-10', geometry.bar)}
        style={{ background: tone.primary }}
      />
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-0 bottom-0 -z-10 flex items-center justify-between', geometry.row)}
      >
        <span
          className={cn('rounded-full', geometry.pick)}
          style={{ background: multi ? face.pick : face.monoPick }}
        />
        {multi && <span className={cn('rounded-full', geometry.accent)} style={{ background: face.accent }} />}
      </span>
      {selected && (
        <span
          aria-hidden="true"
          className="forced-selected absolute top-0.5 right-0.5 -z-10 grid size-5 place-items-center rounded-full"
          style={{ background: tone.primary, color: tone.onPrimary }}
        >
          <CheckGlyph className="size-3.5" />
        </span>
      )}
    </>
  );
}
