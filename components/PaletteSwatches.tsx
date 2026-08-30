'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { MdColorize, MdImage } from 'react-icons/md';

import Button from '@/components/Button';
import PaletteChipFace from '@/components/PaletteChipFace';
import { showToast } from '@/components/Toast';
import {
  CUSTOM_PALETTE,
  PALETTES,
  unpackCustomTones,
  useCustomSeed,
  useCustomTonesRaw,
  usePalette,
  useScheme,
  type PaletteId,
} from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import { changeCustomPalette, changePalette } from '@/lib/motionLazy';
import { resolveCustomPalette, warmPalette } from '@/lib/paletteLazy';
import { cn } from '@/lib/utils';

/**
 * The two dialogs, each behind its own `dynamic()`.
 *
 * Neither is anything /settings needs until a button is pressed: between them they carry a
 * gamut-aware 32-cell grid, a hue rail, a live preview and Monet's quantiser. **`loading` is
 * not optional here**, and its absence was a visible bug: `dynamic()` without it renders a
 * component that suspends, and the nearest boundary is the *route's* — so the first press of
 * 选择颜色 replaced the whole of /settings with its loading skeleton for as long as the chunk
 * took, then put it back. That is the "设置页面会突然没一下" report. With a `loading` of `null`
 * the boundary is the dialog's own, the page never re-suspends, and the dialog's own skeleton
 * covers the gap.
 *
 * Neither takes `ssr: false` — they render nothing until `isOpen`, and the latches below keep
 * the chunks from being fetched at mount.
 */
const ColorPicker = dynamic(() => import('@/components/ColorPicker'), { loading: () => null });
const ImagePalettePicker = dynamic(() => import('@/components/ImagePalettePicker'), {
  loading: () => null,
});

/** What the picker opens on before anything has been chosen: the brand's own light fill. */
const UNSET_SEED = '#e06c9f';

/** The two doors into the eleventh palette. */
type PickerId = 'hex' | 'image';

/**
 * The theme colour picker: ten built-in palettes and the user's own.
 *
 * A screen-level component, not a design primitive — it has one call site and it exists
 * because none of the primitives can hold it. `Select` would have been the consistent
 * choice for a /settings row and is the wrong control for a colour: `SelectOption` carries
 * `{value, label, hint}` with nowhere to put a swatch, and a colour you choose from a list
 * of names is a colour you cannot see until you have picked it.
 *
 * **The swatches cannot read the tokens.** Every `--md-sys-color-*` is the *active*
 * theme's, and ten of the eleven chips have to show a theme that is not active — so the
 * hexes come from `lib/generated/themeColors.ts`, which `scripts/palette.mjs` writes from
 * the same run that writes the CSS. That is the whole reason those two values per scheme
 * are generated rather than picked: a hand-copied swatch is a swatch that goes stale the
 * first time a fill moves. The eleventh has nothing to generate, so it reads the four hexes
 * `applyCustomPalette` parks on `<html>` — the same rule, not an exception to it: its first
 * draft read the tokens and turned 露娜's blue the moment you selected 露娜.
 *
 * **The chip is the colour and nothing else**, which is AOSP's own theme picker and took a
 * rewrite to arrive at, and then a second one to come back to. It was a 48dp `surface` ground
 * with a 28dp `primary` circle inside it, an `outline-variant` keyline around that, and a
 * second `on-surface` outline when selected — four concentric rings for a control whose entire
 * job is to show one colour. Then it was AOSP's four quadrants, the fill over
 * `secondary`/`tertiary`, which is a chip that says what a theme *is* rather than what its
 * loudest colour is — and which is worth nothing here, because this system derives the whole
 * harmony from the fill by one rule, so the two extra quarters showed no information the fill
 * did not already carry. Now: a 40dp disc filled with the theme's `primary`, `data-ripple` and
 * `state-layer` for the press and the hover, `focus-ring` for the keyboard, and a tick in that
 * theme's own `on-primary` when it is the one in force. The tick is the selected state — three
 * signals for it was two too many. See `components/PaletteChipFace.tsx`.
 *
 * The row wraps, and that is why the chips are the colour rather than a colour in a box: at
 * eleven themes, eleven 72px columns and ten 12px gaps come to 912px, which takes two lines
 * of the `4xl` settings column. A `Select` of names would have fitted on one line and shown
 * nothing.
 *
 * `role="radiogroup"` with a roving tab stop, because that is what a single choice among
 * eleven is. A row of eleven buttons would announce itself as eleven unrelated controls and
 * put eleven stops in the tab order.
 *
 * ---------------------------------------------------------------------------
 * The eleventh chip, and the two controls under it
 *
 * The chip and the controls are **separate objects with separate jobs**, and that arrangement
 * took three tries. The chip answers *"use my colour"* — a radio like the other ten, carrying
 * the tick, inside the group. The row below answers *"what is my colour"*, and it asks that in
 * two ways, because they are two different questions: 选择颜色 opens
 * `components/ColorPicker.tsx`, where a colour is named; 从图片取色 opens
 * `components/ImagePalettePicker.tsx`, where one is found. **Two triggers, two dialogs.** For a
 * pass they were two triggers into *one* dialog, the second opening it scrolled to an image
 * section at the bottom — which made that dialog carry two models at once and its confirm
 * button ambiguous about which it was sending.
 *
 * What the naming dialog replaced, in order: a chip that opened the OS dialog on its *second*
 * tap with the input visually hidden inside it; then that plus a hex field for testing; then a
 * visible `ColorSwatch`. All three ended at the browser's own colour dialog, which carries none
 * of this app's tokens, speaks RGB or HSV where the whole system speaks HCT, and shows a colour
 * where the thing being chosen is a *theme*. Both dialogs are the app's own now — their headers
 * carry the argument.
 *
 * **The chip is disabled until a colour exists**, because until then there is no eleventh
 * palette to select. Disabled rather than hidden, which is /settings' own rule — a control
 * that vanishes is a control the user has to go looking for. The arrow keys skip it in that
 * state, so the roving cursor never lands on a stop that does nothing.
 */
export default function PaletteSwatches({ className }: { className?: string }) {
  const active = usePalette();
  const scheme = useScheme();
  const customSeed = useCustomSeed();
  /* The eleventh chip's own colour, which cannot come from the tokens: those are always the
     *active* theme's, so reading `--md-sys-color-primary` here painted the chip 露娜's blue
     the moment you switched to 露娜. `applyCustomPalette` parks the four hexes on `<html>`
     and leaves them there when you switch away, which is what makes the chip keep showing
     your colour. Same trap `lib/generated/themeColors.ts` keeps the other ten out of. */
  const customTone = unpackCustomTones(useCustomTonesRaw())?.[scheme] ?? null;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  /* One counter per dialog, doing two jobs at once. Non-zero is the **latch**: `dynamic()`
     alone would fetch the chunk at mount, because each dialog is rendered with
     `isOpen={false}` rather than conditionally, so it is mounted only once it has ever been
     opened — which keeps the exit animation that conditional rendering on `isOpen` would take
     away, and keeps a user who only ever names a colour from paying for the quantiser. And the
     value is handed down as `key`, so each open **remounts** that dialog's body: remounting
     *is* the reset, where the alternative is an effect writing several pieces of state
     synchronously, which is a cascading render and what the React Compiler's lint rejects.

     Per dialog rather than one shared counter, or opening either one would remount the other
     and cut short its exit. */
  const [picker, setPicker] = useState<{ open: PickerId | null; opens: Record<PickerId, number> }>({
    open: null,
    opens: { hex: 0, image: 0 },
  });
  const openPicker = (id: PickerId) =>
    setPicker((p) => ({ open: id, opens: { ...p.opens, [id]: p.opens[id] + 1 } }));
  const closePicker = () => setPicker((p) => ({ ...p, open: null }));

  const count = PALETTES.length + 1;
  /* A radiogroup with every stop at −1 is a radiogroup the tab key cannot reach, which is
     what `selected ? 0 : -1` alone produces when nothing matches. `currentPalette()`
     normalises through `isPaletteId`, so today it always matches; this is what keeps the
     roving stop from depending on that. */
  const activeExists = active === CUSTOM_PALETTE || PALETTES.some((p) => p.id === active);
  const customActive = active === CUSTOM_PALETTE;

  /* The recipe is ~7 KB of HCT behind a dynamic import. Warming it on mount rather than on
     the gesture is what keeps `resolveCustomPalette`'s `await` off the interaction's path —
     /settings is the only screen that can reach it, so nothing else pays for this. */
  useEffect(warmPalette, []);

  const originOf = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
  };

  /**
   * Install a hex as the custom palette. Both dialogs end here — one rule, two doors.
   *
   * `resolveCustomPalette` returns null only for a string that is not a six-digit hex, which
   * neither dialog can produce: one emits `hexFromHct` output and the other `hexFromArgb`.
   * The branch is here because the function's contract allows it, not because a user can
   * reach it.
   */
  const applyCustom = async (hex: string) => {
    const install = await resolveCustomPalette(hex);
    if (!install) {
      showToast('颜色格式无法识别', 'error');
      return;
    }
    changeCustomPalette(install, originOf(trigger.current));
  };

  const pick = (id: PaletteId, element: HTMLElement | null) => {
    /* The wipe grows out of the chip that was pressed, the way the app bar's grows out of
       its glyph. `changePalette` is a no-op when the id is already active. */
    changePalette(id, originOf(element));
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
    /* The eleventh chip is out of the cycle while it has nothing to select. */
    const reachable = customSeed ? count : PALETTES.length;
    const next = (index + step + reachable) % reachable;
    const button = refs.current[next];
    button?.focus();
    pick(next === PALETTES.length ? CUSTOM_PALETTE : PALETTES[next]!.id, button);
  };

  const chipClass =
    'state-layer focus-ring touch-size relative size-10 cursor-pointer overflow-hidden rounded-full outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:disabled-content';

  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      <div role="radiogroup" aria-label="主题配色" className="flex flex-wrap gap-3">
        {PALETTES.map((palette, index) => {
          const selected = palette.id === active;
          const tone = palette[scheme];
          return (
            /* The caption is a sibling of the control rather than a child of it, so the
               control is exactly the disc: `data-ripple` clips the wave to its own box, and
               a wave that filled a 72px column with a word in it would not be this chip's
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
                /* One stop for the group: the selected chip, or the first if a stored id
                   ever fails to match. Arrow keys move within it. */
                tabIndex={selected || (!activeExists && index === 0) ? 0 : -1}
                onClick={(event) => pick(palette.id, event.currentTarget)}
                onKeyDown={(event) => onKeyDown(event, index)}
                data-ripple
                /* `touch-size` rather than `touch-target`: `data-ripple` sets
                   `overflow: hidden` to clip the wave, which would clip a hit-area
                   pseudo-element out of hit-testing with it. So the floor is the box — 40dp
                   under a pointer, 48 under a finger. */
                className={chipClass}
                /* The ink is the theme's own, so `state-layer` (which paints from
                   `currentColor`) tints with that theme's ink rather than the active one's. */
                style={{ color: tone.onPrimary }}
              >
                <PaletteChipFace tone={tone} selected={selected} />
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

        <div className="flex w-18 flex-col items-center gap-1.5">
          <button
            ref={(node) => {
              refs.current[PALETTES.length] = node;
            }}
            type="button"
            role="radio"
            aria-checked={customActive}
            aria-label={customSeed ? `自定义 ${customSeed}` : '自定义，尚未选择颜色'}
            disabled={!customSeed}
            tabIndex={customActive ? 0 : -1}
            onClick={(event) => pick(CUSTOM_PALETTE, event.currentTarget)}
            onKeyDown={(event) => onKeyDown(event, PALETTES.length)}
            data-ripple
            className={cn(
              chipClass,
              /* With no colour chosen there is nothing to show, so the chip takes the tone
                 step every unselected filter control in the app takes rather than inventing
                 a placeholder colour. */
              !customTone && 'bg-surface-container-high text-on-surface-variant',
            )}
            style={
              customTone
                ? { color: customTone.onPrimary }
                : undefined
            }
          >
            {customTone ? (
              <PaletteChipFace tone={customTone} selected={customActive} />
            ) : (
              <span className="grid size-full place-items-center">
                <MdColorize size={ICON.control} />
              </span>
            )}
          </button>
          <span
            aria-hidden="true"
            className={cn(
              'text-label-s text-center',
              customActive ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            自定义
          </span>
        </div>
      </div>

      {/* The control, as a row: name at the leading edge, control at the trailing edge. The
          rule above it is structural — it separates the ten colours that are given from the
          one you set — so it is drawn in every state rather than appearing with a value. */}
      <div className="flex items-center justify-between gap-4 border-t border-outline-variant pt-4">
        <div className="min-w-0">
          <p className="text-label-l text-on-surface mb-0.5">自定义颜色</p>
          <p className="text-body-m-emphasized text-on-surface">{customSeed ?? '未设置'}</p>
        </div>
        {/* Two ways in, side by side, because they are two different questions: name a colour,
            or find one in a picture. Each opens its own dialog; both end at `applyCustom`. */}
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            variant="text"
            icon={<MdImage size={ICON.control} />}
            onClick={() => openPicker('image')}
          >
            从图片取色
          </Button>
          <Button
            ref={trigger}
            variant="tonal"
            icon={<MdColorize size={ICON.control} />}
            onClick={() => openPicker('hex')}
          >
            选择颜色
          </Button>
        </div>
      </div>

      {picker.opens.hex > 0 && (
        <ColorPicker
          key={picker.opens.hex}
          isOpen={picker.open === 'hex'}
          onClose={closePicker}
          initial={customSeed ?? UNSET_SEED}
          onPick={(hex) => void applyCustom(hex)}
        />
      )}
      {picker.opens.image > 0 && (
        <ImagePalettePicker
          key={picker.opens.image}
          isOpen={picker.open === 'image'}
          onClose={closePicker}
          onPick={(hex) => void applyCustom(hex)}
        />
      )}
    </div>
  );
}
