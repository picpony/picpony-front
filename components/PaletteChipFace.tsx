'use client';

import CheckGlyph from '@/components/CheckGlyph';
import type { PaletteTone } from '@/lib/appearance';

/**
 * A theme's face: its `primary` fill, and a tick when it is the one in force.
 * One flat colour, deliberately — the theme's harmony is derived from the fill
 * by one rule, so extra quadrants add nothing.
 *
 * **The keyline is what makes it a disc**: five of the eleven fills are pale
 * coats measuring barely 1:1 against a near-white page, and without an edge the
 * chips dissolve into the card. Its own element rather than a ring utility, so
 * it cannot fight the focus ring over one property.
 *
 * The fill sits at a negative z-index so it goes behind the state layer's
 * pseudo-element inside the chip's own stacking context.
 */
export default function PaletteChipFace({
  tone,
  selected,
}: {
  tone: PaletteTone;
  selected: boolean;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: tone.primary }}
      />
      <span
        aria-hidden="true"
        className="border-outline-variant pointer-events-none absolute inset-0 rounded-full border"
      />
      {selected && (
        <span className="absolute inset-0 grid place-items-center">
          {/* 20dp in a 40dp disc — the glyph step a control takes; centred in a
              solid disc there is no reason to shrink it. */}
          <CheckGlyph className="size-5" />
        </span>
      )}
    </>
  );
}
