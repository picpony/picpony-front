'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';

import Button from '@/components/Button';
import CheckGlyph from '@/components/CheckGlyph';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import PalettePreview from '@/components/PalettePreview';
import PaletteTileFace from '@/components/PaletteTileFace';
import Skeleton from '@/components/Skeleton';
import { useScheme, type AccentChoice, type CustomSpec, type PaletteHues } from '@/lib/appearance';
import { usePaletteTools, type PaletteTools } from '@/lib/paletteLazy';
import type { AccentPreset } from '@/lib/paletteSpec';
import { cn } from '@/lib/utils';

/**
 * The custom theme colour, named in the app's own vocabulary.
 *
 * The app's own dialog rather than the OS colour picker, which carries none of
 * this app's tokens, speaks RGB/HSV where this system speaks HCT, and shows a
 * colour where a *theme* is being chosen — `PalettePreview` is the answer to
 * that, and the reason this was built.
 *
 * **Every cell is a real colour, not a gradient.** sRGB's gamut in HCT is an
 * irregular solid; a gradient offers values the browser then clips, so a user can
 * aim at a colour and land on another one. Each swatch is a separate `Hct.from()`
 * result — what is offered is exactly what gets installed.
 *
 * **Two axes at once because the gamut couples them.** Chroma is offered as a
 * *fraction of what is available at that hue and tone*, not an absolute that would
 * be a lie at half the cells. Tone stops span the range the ten built-in fills
 * occupy.
 *
 * **A grey is a legitimate answer.** `rampChroma` tapers its floor as the fill
 * runs out of hue, so a grey lands on a near-monochrome scheme; the hard chroma
 * bar survives only for the ten built-in fills, where `scripts/palette.mjs`
 * asserts it.
 *
 * **This dialog names one colour and, under 多色, its 副色相 — one hue the second
 * colour and the accent share.** 自动 is the right-angle rule, with its guards; the
 * three presets are the same idea at other turns; 自选 opens a rail and takes the hue
 * at its word. Under 单色 the group is not shown and the stored choice is kept, since
 * nothing on screen would answer to it. Image extraction is `ImagePalettePicker`'s job
 * — a second entry point into this dialog made it carry two models at once. Both end
 * at the same `resolveCustomPalette`.
 *
 * **One piece of state, and the coordinates are the authoritative half of it.**
 * The hex provably cannot carry the hue or the cell (a grey has no hue; on the
 * palest row the gamut holds so little chroma that adjacent columns are closer
 * than `Hct`'s own rounding), so `Pick` carries all three and one setter per
 * gesture writes the whole object — no synchronising effect for the React
 * Compiler's lint to reject.
 *
 * **Two single choices, so two radio groups** — one tab stop each, arrows move the
 * choice (the rail by one stop, or a row with ↑/↓; the grid by a column with ←/→ and a
 * tone with ↑/↓). As toggle buttons they were 64 tab stops announced as switches. The
 * choice is marked by its tick alone: a ring beside it drew on the property the focus
 * ring uses, and its offset was painted in the page colour rather than the dialog's.
 */

/** Tone stops, spanning what the ten built-in fills occupy (20–95). */
const TONES = [95, 88, 80, 70, 60, 48, 36, 24] as const;
/**
 * Chroma as a fraction of what the gamut holds at that hue and tone. The last
 * stop is **0** — a pure grey at that tone whatever the hue, which is how a
 * monochrome theme gets picked.
 */
const CHROMAS = [1, 0.72, 0.48, 0.28, 0] as const;
/** 24 hues at 15°, the same gap `ASSERTION 5` holds two built-in themes apart by. */
const HUE_STOPS = Array.from({ length: 24 }, (_, i) => i * 15);

const HEX = /^#[0-9a-f]{6}$/i;
/** The hue rail's swatches are drawn at one tone, so the rail reads as a spectrum. */
const RAIL_TONE = 60;
/** Stops per row of the rail where it is laid out in two rows; ↑/↓ move by one row. */
const RAIL_ROW = 12;
/* The tick's ink on a swatch: a swatch shows a colour that is not the theme in force, so its
   ink cannot be a token either. Black on the light half of the tone range, white below. */
const inkOn = (tone: number) => (tone > 55 ? '#000' : '#fff');

/**
 * The rail: six to a row by default and under a finger (with the touch floor between
 * them), twelve to a row — two even rows — where a pointer has the room. It was a
 * wrapping row that left two stops alone on a third line.
 */
const RAIL_CLASS =
  'grid grid-cols-6 place-items-center gap-y-2 p-1 sm:pointer-fine:grid-cols-12 pointer-coarse:gap-y-4 pointer-coarse:p-2';
/**
 * The tone × chroma board fills the dialog's width: a fixed label column, then five
 * columns sharing the rest (never under 40px, and the board scrolls sideways before it
 * gets narrower than that). At fixed widths it stood 232px wide in a 464px body, the
 * right half of the dialog empty beside it.
 */
const BOARD_COLUMNS = `2rem repeat(${CHROMAS.length}, minmax(2.5rem, 1fr))`;

/**
 * The ways to choose a 副色相, in the order they are offered. `custom` is 自选, whose hue
 * comes from the rail below the tiles.
 */
type AccentMode = 'auto' | AccentPreset | 'custom';
const ACCENT_MODES: readonly { mode: AccentMode; label: string; caption: string }[] = [
  { mode: 'auto', label: '自动', caption: '直角' },
  { mode: 'analogous', label: '邻近', caption: '30°' },
  { mode: 'triadic', label: '三分', caption: '120°' },
  { mode: 'complement', label: '互补', caption: '180°' },
  { mode: 'custom', label: '自选', caption: '色相轨' },
];

const modeOf = (accent: AccentChoice): AccentMode =>
  accent === null ? 'auto' : typeof accent === 'number' ? 'custom' : accent;

/**
 * The preview's dock: sticky at the top of the dialog's scroller, on the dialog's own container
 * tone so what scrolls beneath it is covered. Sticky offsets count from the scroller's *content*
 * edge, 4px inside its top padding, so the dock sticks 4px above that and pads the band it now
 * covers — measured, content showed through it otherwise. The same 4px margin back keeps the
 * preview where it always sat at rest.
 */
const PREVIEW_DOCK = 'sticky -top-1 z-10 -mt-1 bg-surface-container-high pt-1 pb-1';

/** The tiles: five across where there is room; two across, in three rows, where there is not. */
const MODES_CLASS = 'grid grid-cols-2 gap-2 p-1 sm:grid-cols-5';
/**
 * A 副色相 tile's height: the theme's miniature (36), its label (20) and caption (16), two 4px
 * gaps and 8px of padding above and below — so the skeleton stands in at the same size.
 */
const MODE_TILE_HEIGHT = 'min-h-24';

export interface ColorPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The palette to open on. The brand's own fill and 自动 when nothing has been chosen yet. */
  initial: CustomSpec;
  /** 配色方案 in force: under 单色 the 副色相 group has nothing to show. */
  hues: PaletteHues;
  /** Called on confirm. The seed **is** `primary`; the accent is the 副色相 chosen here. */
  onPick: (spec: CustomSpec) => void;
  /** The dialog has finished leaving — where the theme wipe may start. */
  onExited?: () => void;
}

export default function ColorPicker({ isOpen, onClose, initial, hues, onPick, onExited }: ColorPickerProps) {
  const tools = usePaletteTools(isOpen);
  return (
    <PickerDialog
      tools={tools}
      isOpen={isOpen}
      initial={initial}
      hues={hues}
      onPick={onPick}
      onClose={onClose}
      onExited={onExited}
    />
  );
}

/**
 * The dialog's own placeholder, in the shape of the thing it is waiting for —
 * not a `Spinner`, which is for an action in flight, while a destination whose
 * shape is known loads as that shape. The shape is known to the pixel: the chunk
 * decides the *colours*, not the layout.
 */
function PickerSkeleton({ caption, hues }: { caption: string; hues: PaletteHues }) {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <div className={PREVIEW_DOCK}>
        <PalettePreview caption={caption} hues={hues} />
      </div>
      <Group label="十六进制"><Skeleton className="h-10 w-40 rounded-sm" /></Group>
      <Group label="色相">
        <div className={RAIL_CLASS}>
          {HUE_STOPS.map((hue) => <Skeleton key={hue} className="size-8 rounded-full" />)}
        </div>
      </Group>
      <Group label="明度与彩度">
        <div className="popover-scrollbar overflow-x-auto">
          <div className="grid gap-1 p-1 pointer-coarse:gap-2" style={{ gridTemplateColumns: BOARD_COLUMNS }}>
            <span />
            {CHROMAS.map((x) => <span key={x} className="text-label-s text-center">{Math.round(x * 100)}%</span>)}
            {TONES.map((tone) => (
              <Row key={tone}>
                <span className="text-label-s self-center pr-2 text-right">{tone}</span>
                {CHROMAS.map((x) => <Skeleton key={x} className="h-10 rounded-xs" />)}
              </Row>
            ))}
          </div>
        </div>
      </Group>
      {hues === 'multi' && (
        <Group label="副色相">
          <div className={MODES_CLASS}>
            {ACCENT_MODES.map(({ mode }) => <Skeleton key={mode} className={cn(MODE_TILE_HEIGHT, 'rounded-md')} />)}
          </div>
        </Group>
      )}
    </div>
  );
}

/**
 * The keyed dialog owns both its draft and footer. It stays mounted while the
 * palette tools arrive, so loading cannot restart the overlay's entrance.
 */
function PickerDialog({
  tools,
  isOpen,
  initial,
  hues,
  onPick,
  onClose,
  onExited,
}: {
  tools: PaletteTools | null;
  isOpen: boolean;
  initial: CustomSpec;
  hues: PaletteHues;
  onPick: (spec: CustomSpec) => void;
  onClose: () => void;
  onExited?: () => void;
}) {
  const hueLabel = useId();
  const boardLabel = useId();
  const accentLabel = useId();
  /* The 副色相 tiles show their themes in the scheme on screen, as the palette picker does. */
  const scheme = useScheme();
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const boardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const accentRailRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialSeed = initial.seed.toLowerCase();
  const [pick, setPick] = useState<Pick | null>(null);
  const [draft, setDraft] = useState(() => initialSeed);
  const [error, setError] = useState<string | undefined>(undefined);
  /* The 副色相: how it is chosen, and — for 自选 — the hue. One piece of state, like `Pick`. */
  const [accent, setAccent] = useState<{ mode: AccentMode; hue: number | null }>(() => ({
    mode: modeOf(initial.accent),
    hue: typeof initial.accent === 'number' ? initial.accent : null,
  }));
  const { hex, hue, cell } = pick ?? (tools
    ? pickFrom(tools, initialSeed, 0)
    : { hex: initialSeed, hue: 0, cell: null });

  /** The stored form of a mode. 自选 before a hue is chosen starts where 自动 is. */
  const choiceFor = (mode: AccentMode, customHue: number | null): AccentChoice => {
    if (mode === 'auto') return null;
    if (mode !== 'custom') return mode;
    return customHue ?? (tools ? nearestStop(tools.relatedHue(tools.hctOf(hex).hue, 'auto')) : 0);
  };
  const choice = choiceFor(accent.mode, accent.hue);

  const chooseMode = (mode: AccentMode) =>
    setAccent((current) => ({
      mode,
      hue: mode === 'custom' && current.hue === null ? (choiceFor('custom', null) as number) : current.hue,
    }));

  const onModeKey = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + ACCENT_MODES.length) % ACCENT_MODES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ACCENT_MODES.length - 1;
    if (next === null) return;
    event.preventDefault();
    modeRefs.current[next]?.focus();
    chooseMode(ACCENT_MODES[next]!.mode);
  };

  const onAccentRailKey = (event: KeyboardEvent, index: number) => {
    const columns = event.currentTarget.parentElement
      ? getComputedStyle(event.currentTarget.parentElement).gridTemplateColumns.split(' ').length
      : RAIL_ROW;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + HUE_STOPS.length) % HUE_STOPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = HUE_STOPS.length - 1;
    if (next === null) return;
    event.preventDefault();
    accentRailRefs.current[next]?.focus();
    setAccent({ mode: 'custom', hue: HUE_STOPS[next]! });
  };

  /** Move the rail. The cell stays where it is, so only the hue changes. */
  const setHue = (nextHue: number) => {
    if (!tools) return;
    const at = cell ?? cellOf(tools, hex);
    setPick({ hex: cellHex(tools, nextHue, at), hue: nextHue, cell: at });
    setDraft(cellHex(tools, nextHue, at));
    setError(undefined);
  };

  /** Choose a cell. The hue stays where it is — which is the whole point for the 0% column. */
  const setCell = (at: Cell) => {
    if (!tools) return;
    const next = cellHex(tools, hue, at);
    setPick({ hex: next, hue, cell: at });
    setDraft(next);
    setError(undefined);
  };

  /** The rail's stop nearest the current hue — the group's one tab stop. */
  const railIndex = HUE_STOPS.findIndex((h) => Math.abs(((hue - h + 540) % 360) - 180) < 7.5);

  const onRailKey = (event: KeyboardEvent, index: number) => {
    const columns = event.currentTarget.parentElement
      ? getComputedStyle(event.currentTarget.parentElement).gridTemplateColumns.split(' ').length
      : RAIL_ROW;
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + HUE_STOPS.length) % HUE_STOPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = HUE_STOPS.length - 1;
    if (next === null) return;
    event.preventDefault();
    railRefs.current[next]?.focus();
    setHue(HUE_STOPS[next]!);
  };

  /** The board's one tab stop: the chosen cell, or the first cell when none is chosen. */
  const boardStop: Cell = cell ?? { tone: TONES[0], chroma: CHROMAS[0] };

  const onBoardKey = (event: KeyboardEvent, at: Cell) => {
    const row = TONES.indexOf(at.tone as (typeof TONES)[number]);
    const column = CHROMAS.indexOf(at.chroma as (typeof CHROMAS)[number]);
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    let target: [number, number] | null = null;
    if (move[event.key]) {
      const [dr, dc] = move[event.key]!;
      target = [(row + dr + TONES.length) % TONES.length, (column + dc + CHROMAS.length) % CHROMAS.length];
    } else if (event.key === 'Home') target = [row, 0];
    else if (event.key === 'End') target = [row, CHROMAS.length - 1];
    if (!target) return;
    event.preventDefault();
    const next = { tone: TONES[target[0]]!, chroma: CHROMAS[target[1]]! };
    boardRefs.current[`${next.tone}:${next.chroma}`]?.focus();
    setCell(next);
  };

  const commitHex = (raw: string) => {
    if (!tools) return;
    const value = raw.trim().toLowerCase();
    const withHash = value.startsWith('#') ? value : `#${value}`;
    if (!HEX.test(withHash)) {
      setError('需要六位十六进制，例如 #e06c9f');
      return;
    }
    setPick(pickFrom(tools, withHash, hue));
    setDraft(withHash);
    setError(undefined);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="自定义主题色"
      maxWidth="lg"
      onExited={onExited}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button
            variant="filled"
            disabled={!tools || Boolean(error)}
            onClick={() => {
              onPick({ seed: hex, accent: choice });
              onClose();
            }}
          >
            使用此颜色
          </Button>
        </>
      }
    >
      {tools ? (
        <div className="flex flex-col gap-5">
          {/* Docked while the controls under it scroll: the 副色相 tiles sit a whole board
              further down, and a choice made with its consequence out of view is a guess. */}
          <div className={PREVIEW_DOCK}>
            {/* Cached: the chosen 副色相 tile below derives the same spec. */}
            <PalettePreview derived={tools.deriveCustomThemeCached({ seed: hex, accent: choice })} hues={hues} caption={hex} />
          </div>

          {/* Straight under the preview it drives, where it is on screen without
              scrolling past the whole board first. */}
          <Group label="十六进制">
            <Input
              size="sm"
              aria-label="十六进制颜色值"
              placeholder="#e06c9f"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={7}
              value={draft}
              error={error}
              fieldClassName="max-w-40"
              onChange={(event) => {
                setError(undefined);
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitHex(draft);
                }
              }}
              onBlur={() => commitHex(draft)}
            />
          </Group>

          <Group label="色相" id={hueLabel}>
            {/* 4px of clearance on every side, so a stop's focus ring is not clipped
                by the row above it. */}
            <div role="radiogroup" aria-labelledby={hueLabel} className={RAIL_CLASS}>
              {HUE_STOPS.map((h, index) => {
                const on = index === railIndex;
                return (
                  <button
                    key={h}
                    ref={(node) => {
                      railRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`色相 ${h} 度`}
                    tabIndex={on || (railIndex < 0 && index === 0) ? 0 : -1}
                    onClick={() => setHue(h)}
                    onKeyDown={(event) => onRailKey(event, index)}
                    className="touch-target focus-ring grid size-8 cursor-pointer place-items-center rounded-full focus-visible:outline-hidden focus-visible:ring-2"
                    style={{
                      background: tools.hexFromHct(h, tools.maxChroma(h, RAIL_TONE), RAIL_TONE),
                      color: inkOn(RAIL_TONE),
                    }}
                  >
                    {on && <CheckGlyph className="size-4" />}
                  </button>
                );
              })}
            </div>
          </Group>

          <Group label="明度与彩度" id={boardLabel}>
            <div className="popover-scrollbar overflow-x-auto">
              <div
                role="radiogroup"
                aria-labelledby={boardLabel}
                className="grid gap-1 p-1 pointer-coarse:gap-2"
                style={{ gridTemplateColumns: BOARD_COLUMNS }}
              >
                <span />
                {CHROMAS.map((x) => (
                  <span key={x} className="text-label-s text-on-surface-variant text-center">
                    {Math.round(x * 100)}%
                  </span>
                ))}
                {TONES.map((t) => {
                  const ceiling = tools.maxChroma(hue, t);
                  return (
                    <Row key={t}>
                      <span className="text-label-s text-on-surface-variant self-center pr-2 text-right">
                        {t}
                      </span>
                      {CHROMAS.map((x) => {
                        const swatch = tools.hexFromHct(hue, x * ceiling, t);
                        /* The tick marks the cell that was *chosen*, read off `cell`
                           rather than reconstructed by measuring the hex — exactly one
                           cell can ever wear it, and a typed hex that is not on the
                           grid correctly wears none. There is no tolerance that fixes
                           both mis-ticks (nearest-stop, and multi-tick on the pale
                           rows where adjacent cells sit inside Hct's rounding); the
                           coordinates have to be state. */
                        const on = cell?.tone === t && cell?.chroma === x;
                        const stop = boardStop.tone === t && boardStop.chroma === x;
                        return (
                          <button
                            key={x}
                            ref={(node) => {
                              boardRefs.current[`${t}:${x}`] = node;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={`明度 ${t}，彩度 ${Math.round(x * 100)}%，${swatch}`}
                            tabIndex={stop ? 0 : -1}
                            onClick={() => setCell({ tone: t, chroma: x })}
                            onKeyDown={(event) => onBoardKey(event, { tone: t, chroma: x })}
                            className="touch-target focus-ring rounded-xs spring-fast-effects transition-[background-color] grid h-10 cursor-pointer place-items-center focus-visible:outline-hidden focus-visible:ring-2"
                            style={{ background: swatch, color: inkOn(t) }}
                          >
                            {on && <CheckGlyph className="size-4" />}
                          </button>
                        );
                      })}
                    </Row>
                  );
                })}
              </div>
            </div>
          </Group>

          {hues === 'multi' && (
            <Group label="副色相" id={accentLabel}>
              {/* Five ways, each a tile showing the theme it gives in miniature — the palette
                  picker's own tile, smaller — so the choice is made by looking, not by knowing
                  what 三分 means; and at the size the accent really takes, a mark, rather than
                  half of everything. */}
              <div role="radiogroup" aria-labelledby={accentLabel} className={MODES_CLASS}>
                {ACCENT_MODES.map(({ mode, label, caption }, index) => {
                  const on = accent.mode === mode;
                  const tones = tools.paletteTones(
                    tools.deriveCustomThemeCached({ seed: hex, accent: choiceFor(mode, accent.hue) }),
                  );
                  return (
                    <button
                      key={mode}
                      ref={(node) => {
                        modeRefs.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${label}，${caption}`}
                      tabIndex={on ? 0 : -1}
                      onClick={() => chooseMode(mode)}
                      onKeyDown={(event) => onModeKey(event, index)}
                      data-ripple
                      className={cn(
                        'state-layer focus-ring relative flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-md px-2 py-2 focus-visible:outline-hidden focus-visible:ring-2',
                        MODE_TILE_HEIGHT,
                        on
                          ? 'bg-secondary-container text-on-secondary-container forced-selected'
                          : 'bg-surface-container-highest text-on-surface forced-boundary',
                      )}
                    >
                      {/* Its own stacking context and clip, as the palette tile's box is; the
                          corner is the chip step, picked against a 36px box. */}
                      <span className="forced-boundary relative isolate h-9 w-12 shrink-0 overflow-hidden rounded-sm">
                        <PaletteTileFace size="compact" tone={tones[scheme]} face={tones.face[scheme]} hues="multi" />
                      </span>
                      <span className="text-label-l">{label}</span>
                      <span className={cn('text-label-s', on ? 'text-on-secondary-container' : 'text-on-surface-variant')}>
                        {caption}
                      </span>
                    </button>
                  );
                })}
              </div>
              {accent.mode === 'custom' && (
                <div role="radiogroup" aria-label="副色相的色相" className={RAIL_CLASS}>
                  {HUE_STOPS.map((h, index) => {
                    const on = choice === h;
                    const swatch = tools.accentSwatch(tools.customAccents(hex, h));
                    return (
                      <button
                        key={h}
                        ref={(node) => {
                          accentRailRefs.current[index] = node;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`副色相 ${h} 度`}
                        tabIndex={on || (typeof choice !== 'number' && index === 0) ? 0 : -1}
                        onClick={() => setAccent({ mode: 'custom', hue: h })}
                        onKeyDown={(event) => onAccentRailKey(event, index)}
                        className="touch-target focus-ring grid size-8 cursor-pointer place-items-center rounded-full focus-visible:outline-hidden focus-visible:ring-2"
                        style={{ background: swatch, color: inkOn(tools.hctOf(swatch).tone) }}
                      >
                        {on && <CheckGlyph className="size-4" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </Group>
          )}
        </div>
      ) : (
        <PickerSkeleton caption={initialSeed} hues={hues} />
      )}
    </Modal>
  );
}

/** The rail stop nearest a hue — where 自选 starts from 自动. */
const nearestStop = (h: number) => HUE_STOPS.reduce((best, s) =>
  Math.abs(((h - s + 540) % 360) - 180) < Math.abs(((h - best + 540) % 360) - 180) ? s : best);

/** A labelled block. Not `Input`'s `Field`, which wraps one control rather than a group. */
function Group({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p id={id} className="text-label-m text-on-surface-variant">{label}</p>
      {children}
    </div>
  );
}

/** A fragment, named so the grid's rows read as rows in the JSX. */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** A grid position: a tone stop, and a chroma as a fraction of the ceiling there. */
interface Cell {
  tone: number;
  chroma: number;
}

/**
 * The picker's whole model.
 *
 * `hue` is state rather than measured off `hex` — **a grey has no hue**: every
 * cell in the 0% column reads the same hue from `Hct` whatever it was built from,
 * so picking a grey out of an orange row threw the rail across the spectrum.
 *
 * `cell` is state for the same shape of reason: on the palest rows adjacent
 * columns sit closer together than any measurement can distinguish. It is null
 * for a typed hex that does not land on a stop — exactly when nothing should be
 * ticked.
 *
 * So the coordinates are authoritative and `hex` is derived. Still **one** piece
 * of state, written by one setter per gesture, so there is no synchronising
 * effect for the React Compiler's lint to reject.
 */
interface Pick {
  hex: string;
  hue: number;
  cell: Cell | null;
}

/** Below this, `Hct`'s hue is noise rather than a colour — see `Pick`. */
const ACHROMATIC_CHROMA = 2;

/** The colour a cell stands for. Clicking it installs exactly this string. */
function cellHex(tools: PaletteTools, hue: number, cell: Cell): string {
  return tools.hexFromHct(hue, cell.chroma * tools.maxChroma(hue, cell.tone), cell.tone);
}

/** The nearest grid position to a hex — where the rail leaves the other two axes. */
function cellOf(tools: PaletteTools, hex: string): Cell {
  const c = tools.hctOf(hex);
  const ceiling = tools.maxChroma(c.hue, c.tone);
  return {
    tone: nearest(TONES, c.tone),
    chroma: nearest(CHROMAS, ceiling > 0 ? c.chroma / ceiling : 0),
  };
}

/**
 * The model for a hex that arrived from outside the grid — `initial`, or the hex
 * field. `fallbackHue` is kept when the hex is achromatic, so typing a grey does
 * not throw away the rail's position. The cell is claimed only if it
 * **round-trips exactly**: a hex one code value off a stop is not that stop.
 */
function pickFrom(tools: PaletteTools, hex: string, fallbackHue: number): Pick {
  const c = tools.hctOf(hex);
  const hue = c.chroma < ACHROMATIC_CHROMA ? fallbackHue : c.hue;
  const cell = cellOf(tools, hex);
  return { hex, hue, cell: cellHex(tools, hue, cell) === hex ? cell : null };
}

/** The nearest member of a stop list — what lands an arbitrary hex on the grid. */
function nearest(stops: readonly number[], value: number): number {
  return stops.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best));
}
