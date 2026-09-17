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
 * Neither is anything /settings needs until a button is pressed: between them they
 * carry a gamut-aware grid, a hue rail, a live preview and Monet's quantiser.
 * **`loading` is not optional here**: `dynamic()` without it renders a component
 * that suspends, and the nearest boundary is the *route's* — the first press of
 * 选择颜色 then replaced the whole page with its skeleton until the chunk landed.
 * With a `loading` of `null` the boundary is the dialog's own.
 *
 * Neither takes `ssr: false` — they render nothing until `isOpen`, and the latches
 * below keep the chunks from being fetched at mount.
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
 * A screen-level component, not a design primitive — one call site, and no
 * primitive can hold it: `SelectOption` has nowhere to put a swatch, and a colour
 * you choose from a list of names is a colour you cannot see until you have
 * picked it.
 *
 * **The swatches cannot read the tokens.** Every colour token is the *active*
 * theme's, and ten of the eleven chips have to show a theme that is not active —
 * so the hexes come from `lib/generated/themeColors.ts`, which `scripts/palette.mjs`
 * writes from the same run that writes the CSS. The eleventh reads the four hexes
 * `applyCustomPalette` parks on `<html>` — the same rule, not an exception to it.
 *
 * **The chip is the colour and nothing else** (AOSP's own theme picker): a 40dp
 * disc filled with the theme's `primary`, `data-ripple` + `state-layer` for press
 * and hover, `focus-ring` for the keyboard, and a tick in that theme's own
 * `on-primary` when selected. See `components/PaletteChipFace.tsx`.
 *
 * `role="radiogroup"` with a roving tab stop, because that is what a single
 * choice among eleven is.
 *
 * ---------------------------------------------------------------------------
 * The eleventh chip, and the two controls under it
 *
 * The chip and the controls are **separate objects with separate jobs**. The chip
 * answers *"use my colour"* — a radio like the other ten. The row answers *"what
 * is my colour"*, in two ways because they are two different questions: 选择颜色
 * opens `ColorPicker` (name a colour), 从图片取色 opens `ImagePalettePicker` (find
 * one). **Two triggers, two dialogs.** Two triggers into one dialog made it carry
 * two models at once and left its confirm button ambiguous. All routes lead to the
 * app's own dialogs rather than the OS picker, which carries none of this app's
 * tokens, speaks RGB/HSV where the system speaks HCT, and shows a colour where a
 * *theme* is being chosen.
 *
 * **The chip is disabled until a colour exists** — until then there is no
 * eleventh palette to select. Disabled rather than hidden (a control that
 * vanishes is a control the user has to go looking for); the arrow keys skip it,
 * so the roving cursor never lands on a stop that does nothing.
 */
export default function PaletteSwatches({ className }: { className?: string }) {
  const active = usePalette();
  const scheme = useScheme();
  const customSeed = useCustomSeed();
  /* The eleventh chip's own colour, which cannot come from the tokens: those are
     always the *active* theme's. `applyCustomPalette` parks the four hexes on
     `<html>` and leaves them there when you switch away — same trap the generated
     file keeps the other ten out of. */
  const customTone = unpackCustomTones(useCustomTonesRaw())?.[scheme] ?? null;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  /* One counter per dialog, two jobs. Non-zero is the **latch**: each dialog is
     rendered with `isOpen={false}` rather than conditionally, so `dynamic()` alone
     would fetch the chunk at mount — the latch mounts it only once it has ever
     been opened, keeping the exit animation and sparing a user who only names
     colours the quantiser. The value is also handed down as `key`, so each open
     **remounts** the dialog: remounting *is* the reset, where the alternative is
     an effect writing several pieces of state synchronously (a cascading render,
     which the React Compiler's lint rejects). Per dialog, or opening either would
     remount the other and cut short its exit. */
  const [picker, setPicker] = useState<{ open: PickerId | null; opens: Record<PickerId, number> }>({
    open: null,
    opens: { hex: 0, image: 0 },
  });
  const openPicker = (id: PickerId) =>
    setPicker((p) => ({ open: id, opens: { ...p.opens, [id]: p.opens[id] + 1 } }));
  const closePicker = () => setPicker((p) => ({ ...p, open: null }));

  const count = PALETTES.length + 1;
  /* A radiogroup with every stop at −1 is one the tab key cannot reach, which is
     what the per-chip tabIndex alone produces when nothing matches; this keeps
     the roving stop from depending on the id normalisation. */
  const activeExists = active === CUSTOM_PALETTE || PALETTES.some((p) => p.id === active);
  const customActive = active === CUSTOM_PALETTE;

  /* The recipe is ~7 KB of HCT behind a dynamic import. Warming it on mount keeps
     the resolve's `await` off the interaction's path — /settings is the only
     screen that can reach it. */
  useEffect(warmPalette, []);

  const originOf = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
  };

  /**
   * Install a hex as the custom palette. Both dialogs end here — one rule, two
   * doors. `resolveCustomPalette` returns null only for a non-hex string, which
   * neither dialog can produce; the branch honours the function's contract.
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
            /* The caption is a sibling of the control rather than a child, so the
               control is exactly the disc (`data-ripple` clips the wave to its own
               box). The name reaches the accessibility tree through `aria-label`,
               which is why the visible copy is hidden to AT. */
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
                   `overflow: hidden`, which would clip a hit-area pseudo-element
                   out of hit-testing with it. So the floor is the box — 40dp under
                   a pointer, 48 under a finger. */
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
              /* With no colour chosen there is nothing to show, so the chip takes
                 the tone step every unselected filter control in the app takes
                 rather than inventing a placeholder colour. */
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

      {/* The control, as a row: name at the leading edge, control at the trailing
          edge. The rule above it is structural — it separates the ten colours that
          are given from the one you set — so it is drawn in every state. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-outline-variant pt-4">
        <div className="min-w-0 flex-auto">
          <p className="text-label-l text-on-surface mb-0.5">自定义颜色</p>
          <p className="text-body-m-emphasized text-on-surface">{customSeed ?? '未设置'}</p>
        </div>
        {/* Two ways in, side by side, because they are two different questions:
            name a colour, or find one in a picture. Each opens its own dialog;
            both end at `applyCustom`. */}
        <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
          <Button
            variant="text"
            icon={<MdImage />}
            onClick={() => openPicker('image')}
          >
            从图片取色
          </Button>
          <Button
            ref={trigger}
            variant="tonal"
            icon={<MdColorize />}
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
