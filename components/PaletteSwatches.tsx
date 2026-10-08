'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { MdColorize, MdImage, MdPalette } from 'react-icons/md';

import Button from '@/components/Button';
import PaletteTileFace from '@/components/PaletteTileFace';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import {
  CUSTOM_PALETTE,
  PALETTES,
  unpackCustomTones,
  useCustomAccent,
  useCustomSeed,
  useCustomTonesRaw,
  usePalette,
  usePaletteHues,
  useScheme,
  type AccentChoice,
  type CustomPaletteInstall,
  type CustomSpec,
  type PaletteHues,
  type PaletteId,
} from '@/lib/appearance';
import { BRAND_SEED } from '@/lib/paletteSpec';
import { THEME_FACES } from '@/lib/generated/themeFaces';
import { ICON } from '@/lib/icons';
import { changeCustomPalette, changePalette, changePaletteHues } from '@/lib/motionLazy';
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

/**
 * The same two chunks, fetched on intent — a pointer arriving on, pressing, or focus
 * reaching the button that opens one — so the first press finds its dialog resident
 * instead of waiting a round trip with nothing on screen. On intent rather than on
 * mount: a user who only ever names a colour still never pays for the quantiser.
 */
const DIALOG_CHUNKS = {
  hex: () => import('@/components/ColorPicker'),
  image: () => import('@/components/ImagePalettePicker'),
} as const;
const warmedDialogs = new Set<keyof typeof DIALOG_CHUNKS>();

function warmDialog(id: keyof typeof DIALOG_CHUNKS) {
  if (warmedDialogs.has(id)) return;
  warmedDialogs.add(id);
  DIALOG_CHUNKS[id]().catch(() => warmedDialogs.delete(id));
}

/** What the picker opens on before anything has been chosen: the brand's own light fill, 自动. */
const UNSET: CustomSpec = { seed: BRAND_SEED, accent: null };

/** The two doors into the eleventh palette. */
type PickerId = 'hex' | 'image';

/** How a 副色相 reads in the custom row, with no recipe needed to say it. */
const ACCENT_NAMES: Record<Exclude<AccentChoice, number | null>, string> = {
  analogous: '邻近',
  triadic: '三分',
  complement: '互补',
};
const accentName = (accent: AccentChoice) =>
  accent === null ? '自动' : typeof accent === 'number' ? `${accent}°` : ACCENT_NAMES[accent];

/** The owner's own line for the choice, under its label. */
const HUES_DESCRIPTION = '多色在选中、收藏、等级等少数地方加入角色的第二色与点缀色；单色只用主色一种色相';

/**
 * A palette's tile: 72 × 56 at the card's corner, and no edge of its own — the miniature inside
 * separates from the row by tone (`PaletteTileFace`), and under forced colours the tile draws the
 * system's edge instead. Well past the touch floor at every density, so the box is the target.
 * `data-ripple` and the state layer give press and hover, the standard ring (following the corner)
 * gives the keyboard. Its ink — which the state layer and the ripple paint from — is set per tile:
 * one ink utility per element, since the class join resolves nothing.
 */
const TILE_CLASS =
  'state-layer focus-ring forced-boundary relative h-14 w-18 cursor-pointer overflow-hidden rounded-md focus-visible:outline-hidden focus-visible:ring-2 disabled:cursor-not-allowed disabled:disabled-content';

/** The label under a tile; the selected one takes the emphasized role, one role per branch. */
const labelClass = (selected: boolean) =>
  cn('text-center', selected ? 'text-label-s-emphasized text-on-surface' : 'text-label-s text-on-surface-variant');

/**
 * The theme colour picker: ten built-in palettes and the user's own, and the 配色方案 they are
 * shown in.
 *
 * A screen-level component, not a design primitive — one call site, and no
 * primitive can hold it: `SelectOption` has nowhere to put a swatch, and a colour
 * you choose from a list of names is a colour you cannot see until you have
 * picked it.
 *
 * **A tile is the theme in miniature** (`PaletteTileFace`): its bar over its own page, a
 * selection's pill and, under 多色, the accent's dot — the thing being chosen is a theme, which a
 * disc of one colour could only show by being cut into a pie. Selected, a check badge at its
 * top-right in that theme's own `on-primary`, and the label in the emphasized role; nothing rings
 * it, and the focus ring is the standard one.
 *
 * **The tiles cannot read the tokens.** Every colour token is the *active* theme's, and
 * ten of the eleven tiles have to show a theme that is not active — so the hexes come
 * from `lib/generated/themeColors.ts` (the bar) and `lib/generated/themeFaces.ts` (the
 * rest), which `scripts/palette.mjs` writes from the same run that writes the CSS. The
 * eleventh reads the fourteen hexes `applyCustomPalette` parks on `<html>` — the same
 * rule, not an exception to it.
 *
 * `role="radiogroup"` with a roving tab stop, because that is what a single choice
 * among eleven is: the arrows move the choice through the eleven in reading order,
 * Home and End jump to either end.
 *
 * ---------------------------------------------------------------------------
 * 配色方案, and the eleventh tile's two controls
 *
 * 配色方案 sits right under the tiles because it changes what they show — every tile's
 * selection pill and accent dot follow it — and it takes the same wipe a palette does.
 *
 * The eleventh tile and the controls under it are **separate objects with separate
 * jobs**. The tile answers *"use my colour"* — a radio like the other ten. The row
 * answers *"what is my colour"*, in two ways because they are two different questions:
 * 选择颜色 opens `ColorPicker` (name a colour and its 副色相), 从图片取色 opens
 * `ImagePalettePicker` (find a pair). **Two triggers, two dialogs.** Two triggers into
 * one dialog made it carry two models at once and left its confirm button ambiguous.
 * All routes lead to the app's own dialogs rather than the OS picker, which carries
 * none of this app's tokens, speaks RGB/HSV where the system speaks HCT, and shows a
 * colour where a *theme* is being chosen.
 *
 * **The tile is disabled until a colour exists** — until then there is no eleventh
 * palette to select, so it is a tonal placeholder with a palette glyph. Disabled rather
 * than hidden (a control that vanishes is a control the user has to go looking for); the
 * arrow keys skip it, so the roving cursor never lands on a stop that does nothing.
 */
export default function PaletteSwatches({ className }: { className?: string }) {
  const active = usePalette();
  const scheme = useScheme();
  const hues = usePaletteHues();
  const customSeed = useCustomSeed();
  const customAccent = useCustomAccent();
  /* The eleventh tile's own colours, which cannot come from the tokens: those are always
     the *active* theme's. `applyCustomPalette` parks the fourteen hexes on `<html>` and
     leaves them there when you switch away — same trap the generated files keep the
     other ten out of. The screen mounts once the session is known, never in hydration,
     so the scheme and 配色方案 hooks read the root on their first render. */
  const customTones = unpackCustomTones(useCustomTonesRaw());
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  /* The button each dialog was opened from: its wipe grows out of that one. */
  const triggers = useRef<Record<PickerId, HTMLButtonElement | null>>({ hex: null, image: null });
  /* A confirmed palette waiting for its dialog to finish leaving. The wipe snapshots the
     screen, so starting it at the confirm froze the leaving dialog and its scrim into the
     old theme's picture and dragged them away with it — two exits for one gesture. The
     recipe resolves while the dialog leaves, so nothing is waited for twice. */
  const pendingPick = useRef<{ install: Promise<CustomPaletteInstall | null>; from: PickerId } | null>(null);
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
     what the per-tile tabIndex alone produces when nothing matches; this keeps
     the roving stop from depending on the id normalisation. */
  const activeExists = active === CUSTOM_PALETTE || PALETTES.some((p) => p.id === active);
  const customActive = active === CUSTOM_PALETTE;

  /* The recipe is ~7 KB of HCT behind a dynamic import. Warming it on mount keeps
     the resolve's `await` off the interaction's path — /settings is the only
     screen that can reach it. */
  useEffect(warmPalette, []);

  /* Leaving the screen before the dialog finished leaving still applies the palette that
     was confirmed — without the wipe, whose origin is gone. */
  useEffect(
    () => () => {
      const pending = pendingPick.current;
      pendingPick.current = null;
      void pending?.install.then((install) => {
        if (install) changeCustomPalette(install);
      });
    },
    [],
  );

  const originOf = (element: HTMLElement | null) => {
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
  };

  /**
   * A dialog confirmed a palette. Both dialogs end here — one rule, two doors. The
   * install is resolved now and applied once the dialog has gone (`applyPending`).
   */
  const confirmCustom = (spec: CustomSpec, from: PickerId) => {
    pendingPick.current = { install: resolveCustomPalette(spec), from };
  };

  /**
   * The dialog has finished leaving: start the wipe, from the button that opened it.
   * `resolveCustomPalette` returns null only for a non-hex seed, which neither dialog
   * can produce; the branch honours the function's contract.
   */
  const applyPending = async () => {
    const pending = pendingPick.current;
    pendingPick.current = null;
    if (!pending) return;
    const install = await pending.install;
    if (!install) {
      showToast('颜色格式无法识别', 'error');
      return;
    }
    changeCustomPalette(install, originOf(triggers.current[pending.from]));
  };

  const pick = (id: PaletteId, element: HTMLElement | null) => {
    /* The wipe grows out of the tile that was pressed, the way the app bar's grows out of
       its glyph. `changePalette` is a no-op when the id is already active. */
    changePalette(id, originOf(element));
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    /* The eleventh tile is out of the cycle while it has nothing to select. */
    const reachable = customSeed ? count : PALETTES.length;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + reachable) % reachable;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = reachable - 1;
    if (next === null) return;
    event.preventDefault();
    const button = refs.current[next];
    button?.focus();
    pick(next === PALETTES.length ? CUSTOM_PALETTE : PALETTES[next]!.id, button);
  };

  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      {/* At most six tiles to a row (six 72px cells and their 12px gaps), so eleven fall
          into two rows of six and five instead of ten and one left alone on the second;
          narrower, they wrap four or three to a row on their own. */}
      <div role="radiogroup" aria-label="主题配色" className="flex max-w-123 flex-wrap gap-3">
        {PALETTES.map((palette, index) => {
          const selected = palette.id === active;
          return (
            /* The caption is a sibling of the control rather than a child, so the
               control is exactly the tile (`data-ripple` clips the wave to its own
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
                /* One stop for the group: the selected tile, or the first if a stored id
                   ever fails to match. Arrow keys move within it. */
                tabIndex={selected || (!activeExists && index === 0) ? 0 : -1}
                onClick={(event) => pick(palette.id, event.currentTarget)}
                onKeyDown={(event) => onKeyDown(event, index)}
                data-ripple
                className={cn(TILE_CLASS, 'text-on-surface')}
              >
                <PaletteTileFace
                  tone={palette[scheme]}
                  face={THEME_FACES[palette.id][scheme]}
                  hues={hues}
                  selected={selected}
                />
              </button>
              <span aria-hidden="true" className={labelClass(selected)}>
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
              TILE_CLASS,
              /* With no colour chosen there is no theme to draw, so the tile takes the tone
                 step every unselected filter control in the app takes rather than inventing
                 a placeholder colour. */
              customTones ? 'text-on-surface' : 'bg-surface-container-high text-on-surface-variant',
            )}
          >
            {customTones ? (
              <PaletteTileFace
                tone={customTones[scheme]}
                face={customTones.face[scheme]}
                hues={hues}
                selected={customActive}
              />
            ) : (
              <span className="grid size-full place-items-center">
                <MdPalette size={ICON.standard} />
              </span>
            )}
          </button>
          <span aria-hidden="true" className={labelClass(customActive)}>
            自定义
          </span>
        </div>
      </div>

      {/* 配色方案, as a row: label and its line at the leading edge, the choice at the
          trailing edge. Under the tiles because it changes what they show. The rules on
          either side are structural — drawn in every state. */}
      <div className="border-outline-variant flex items-center gap-4 border-t pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-label-l text-on-surface">配色方案</p>
          <p className="text-body-s text-on-surface-variant mt-0.5">{HUES_DESCRIPTION}</p>
        </div>
        <Select
          size="sm"
          value={hues}
          aria-label="配色方案"
          onChange={(value) => changePaletteHues(value as PaletteHues)}
          options={[
            { value: 'multi', label: '多色' },
            { value: 'mono', label: '单色' },
          ]}
        />
      </div>

      {/* The control, as a row: name at the leading edge, control at the trailing
          edge. The rule above it separates the colours that are given from the one you
          set, and is drawn in every state. */}
      <div className="border-outline-variant flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t pt-4">
        <div className="min-w-0 flex-auto">
          <p className="text-label-l text-on-surface mb-0.5">自定义颜色</p>
          <p className="text-body-m-emphasized text-on-surface">
            {customSeed ?? '未设置'}
            {/* The 副色相 only means something under 多色, and only once a colour exists. */}
            {customSeed && (
              <span className="mono:hidden text-body-m text-on-surface-variant">
                {` · 副色相 ${accentName(customAccent)}`}
              </span>
            )}
          </p>
        </div>
        {/* Two ways in, side by side, because they are two different questions:
            name a colour, or find one in a picture. Each opens its own dialog;
            both end at `confirmCustom`. */}
        <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
          <Button
            ref={(node) => {
              triggers.current.image = node;
            }}
            variant="text"
            icon={<MdImage />}
            onPointerEnter={() => warmDialog('image')}
            onPointerDown={() => warmDialog('image')}
            onFocus={() => warmDialog('image')}
            onClick={() => openPicker('image')}
          >
            从图片取色
          </Button>
          <Button
            ref={(node) => {
              triggers.current.hex = node;
            }}
            variant="tonal"
            icon={<MdColorize />}
            onPointerEnter={() => warmDialog('hex')}
            onPointerDown={() => warmDialog('hex')}
            onFocus={() => warmDialog('hex')}
            onClick={() => openPicker('hex')}
          >
            选择颜色
          </Button>
        </div>
      </div>

      {picker.opens.hex > 0 && (
        <ColorPicker
          /* Namespaced: the two dialogs are siblings, and each count starts at 1. */
          key={`hex:${picker.opens.hex}`}
          isOpen={picker.open === 'hex'}
          onClose={closePicker}
          onExited={() => void applyPending()}
          initial={customSeed ? { seed: customSeed, accent: customAccent } : UNSET}
          hues={hues}
          onPick={(spec) => confirmCustom(spec, 'hex')}
        />
      )}
      {picker.opens.image > 0 && (
        <ImagePalettePicker
          key={`image:${picker.opens.image}`}
          isOpen={picker.open === 'image'}
          onClose={closePicker}
          onExited={() => void applyPending()}
          hues={hues}
          onPick={(spec) => confirmCustom(spec, 'image')}
        />
      )}
    </div>
  );
}
