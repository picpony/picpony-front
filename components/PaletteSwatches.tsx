'use client';

import { useRef } from 'react';

import CheckGlyph from '@/components/CheckGlyph';
import { PALETTES, usePalette, useScheme, type PaletteId } from '@/lib/appearance';
import { changePalette } from '@/lib/motionLazy';
import { cn } from '@/lib/utils';

/**
 * The ten-way theme colour picker.
 *
 * A screen-level component, not a design primitive — it has one call site and it exists
 * because none of the primitives can hold it. `Select` would have been the consistent
 * choice for a /settings row and is the wrong control for a colour: `SelectOption` carries
 * `{value, label, hint}` with nowhere to put a swatch, and a colour you choose from a list
 * of names is a colour you cannot see until you have picked it. `ColorSwatch` in
 * `Input.tsx` is a wrapper around `<input type="color">`, which is a free choice from 16
 * million rather than one of ten.
 *
 * **The swatches cannot read the tokens.** Every `--md-sys-color-*` is the *active*
 * theme's, and nine of the ten chips have to show a theme that is not active — so the
 * hexes come from `lib/generated/themeColors.ts`, which `scripts/palette.mjs` writes from
 * the same run that writes the CSS. That is the whole reason those two values per scheme
 * are generated rather than picked: a hand-copied swatch is a swatch that goes stale the
 * first time a seed moves.
 *
 * **The chip is the colour and nothing else**, which is AOSP's own theme picker and took a
 * rewrite to arrive at. It was a 48dp `surface` ground with a 28dp `primary` circle inside
 * it, an `outline-variant` keyline around that, and a second `on-surface` outline when
 * selected — four concentric rings for a control whose entire job is to show one colour,
 * and the only control in the app painting its own states by hand. Now: a 40dp disc filled
 * with the theme's `primary`, `data-ripple` and `state-layer` for the press and the hover,
 * `focus-ring` for the keyboard, and a tick in that theme's own `on-primary` when it is the
 * one in force. The tick is the selected state — three signals for it was two too many.
 *
 * The row wraps, and that is why the chips are the colour rather than a colour in a box: at
 * ten themes, ten 72px columns and nine 12px gaps come to 828px, which fits one line of the
 * `4xl` settings column on a desktop and takes two on anything narrower. A `Select` of names
 * would have fitted on one line and shown nothing.
 *
 * `role="radiogroup"` with a roving tab stop, because that is what a single choice among
 * ten is. A row of ten buttons would announce itself as ten unrelated controls and put ten
 * stops in the tab order.
 */
export default function PaletteSwatches({ className }: { className?: string }) {
  const active = usePalette();
  const scheme = useScheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  /* A radiogroup with every stop at −1 is a radiogroup the tab key cannot reach, which is
     what `selected ? 0 : -1` alone produces when nothing matches. `currentPalette()`
     normalises through `isPaletteId`, so today it always matches; this is what keeps the
     roving stop from depending on that. */
  const activeExists = PALETTES.some((palette) => palette.id === active);

  const pick = (id: PaletteId, element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    /* The wipe grows out of the chip that was pressed, the way the app bar's grows out of
       its glyph. `changePalette` is a no-op when the id is already active. */
    changePalette(
      id,
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
    );
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + PALETTES.length) % PALETTES.length;
    const button = refs.current[next];
    button?.focus();
    pick(PALETTES[next]!.id, button);
  };

  return (
    <div role="radiogroup" aria-label="主题配色" className={cn('flex flex-wrap gap-3', className)}>
      {PALETTES.map((palette, index) => {
        const selected = palette.id === active;
        const tone = palette[scheme];
        return (
          /* The caption is a sibling of the control rather than a child of it, so the
             control is exactly the disc: `data-ripple` clips the wave to its own box, and a
             wave that filled a 72px column with a word in it would not be this chip's
             press. The name reaches the accessibility tree through `aria-label` instead,
             which is why the visible copy is `aria-hidden`. */
          <div key={palette.id} className="flex w-18 flex-col items-center gap-1.5">
            <button
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={palette.label}
              /* One stop for the group: the selected chip, or the first if a stored id ever
                 fails to match. Arrow keys move within it. */
              tabIndex={selected || (!activeExists && index === 0) ? 0 : -1}
              onClick={(event) => pick(palette.id, event.currentTarget)}
              onKeyDown={(event) => onKeyDown(event, index)}
              data-ripple
              /* `touch-size` rather than `touch-target`: `data-ripple` sets
                 `overflow: hidden` to clip the wave, which would clip a hit-area
                 pseudo-element out of hit-testing with it. So the floor is the box — 40dp
                 under a pointer, 48 under a finger. */
              className="state-layer focus-ring touch-size grid size-10 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2"
              /* The two hexes are the theme's own, so `state-layer` (which paints from
                 `currentColor`) tints with that theme's ink rather than the active one's. */
              style={{ backgroundColor: tone.primary, color: tone.onPrimary }}
            >
              {selected && <CheckGlyph className="size-5" />}
            </button>
            <span
              aria-hidden="true"
              className={cn(
                'text-label-s text-center',
                selected ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              {palette.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
