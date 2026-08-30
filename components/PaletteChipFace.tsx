'use client';

import CheckGlyph from '@/components/CheckGlyph';
import type { PaletteTone } from '@/lib/appearance';

/**
 * A theme's face: its `primary`, and a tick when it is the one in force.
 *
 * One flat colour. It was AOSP's four-quadrant chip for a pass — the fill across the top half
 * and `secondary`/`tertiary` splitting the bottom, which is `ColorOptionIconView.bindColor`
 * with its top two quadrants given the same value — and that came out with the style axis it
 * belonged to. The argument for it was that a chip should say what a theme *is* rather than
 * what its loudest colour is; the argument against is that here a theme's harmony is
 * *derived from the fill by one rule*, so the two extra quarters carried no information the
 * fill did not already imply, and three colours in a 40dp disc read as a busy chip rather
 * than as a swatch.
 *
 * **The keyline is what makes it a disc**, and it survived the revert for its own reason:
 * five of the eleven fills are a pale coat, and 小蝶's `#faf5ab` measures **1.07:1** against
 * its own near-white page (天琴 1.15:1). Without an edge those chips dissolve into the card.
 * `ColorSwatch` carries one for the same reason, and AOSP rings its own chip
 * (`floating_sheet_color_option_stroke_width`, 3dp). Its own element rather than a `ring-*`
 * utility, so it cannot fight the focus ring over one property.
 *
 * `-z-10` puts the fill behind `state-layer`'s `::before`, which sits at `z-index: -1` inside
 * the chip's own `isolation: isolate`. As an ordinary child it would cover the hover and
 * press tint completely.
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
          {/* 20dp in a 40dp disc — `ICON.control`'s step, which is what a glyph inside a
              control takes. It was 16 while the face was AOSP's four quadrants and the tick
              had to fit in the top half; centred in a solid disc there is no reason to
              shrink it. */}
          <CheckGlyph className="size-5" />
        </span>
      )}
    </>
  );
}
