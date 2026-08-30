'use client';

import { useState } from 'react';

import Button from '@/components/Button';
import CheckGlyph from '@/components/CheckGlyph';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import PalettePreview from '@/components/PalettePreview';
import { usePaletteTools, type PaletteTools } from '@/lib/paletteLazy';
import { cn } from '@/lib/utils';

/**
 * The custom theme colour, named in the app's own vocabulary.
 *
 * It replaced `<input type="color">`. That control is one line and it was wrong here for
 * three reasons, in ascending order of how much they matter:
 *
 *   - It is the operating system's dialog, so it carries none of this app's tokens, shape
 *     steps, motion or type. On Windows it is a grid of 48 fixed colours and a
 *     custom-colours tray that has not changed since 1995.
 *   - It speaks **RGB or HSV**, and this design system speaks **HCT**. Dragging an HSV
 *     "value" slider moves through a space where one step means a different amount of
 *     lightness at every hue, which is the whole reason M3 does not use it.
 *   - It shows a colour and not a **theme**. `PalettePreview` is the answer to that, and it
 *     is the reason for building this rather than the decoration on it.
 *
 * **Every cell is a real colour, not a gradient.** sRGB's gamut in HCT is an irregular
 * solid: at tone 92 the amber hue holds chroma 20 where the pink hue holds 45. A gradient
 * painted across two axes offers values the browser then clips, so a user can aim at a
 * colour and land on another one. Each swatch here is a separate `Hct.from()` result, so
 * what is offered is exactly what gets installed.
 *
 * **The grid is two axes at once because the gamut couples them.** "How light" and "how
 * colourful" cannot be chosen independently — at tone 95 a hue may hold a third of the
 * chroma it holds at 60 — so chroma is offered as a *fraction of what is available there*
 * rather than as an absolute that would be a lie at half the cells. The tone stops span
 * 24–95, which is the range the ten built-in fills actually occupy.
 *
 * **A grey is a legitimate answer.** The picker used to refuse a fill under chroma 15 and say
 * so; it does not, because the preview above already shows what a grey becomes and arguing
 * with a colour the user can see is not this dialog's job. `rampChroma` tapers its floor as
 * the fill runs out of hue, so a grey lands on a near-monochrome scheme instead of a grey bar
 * over a randomly-hued ramp. The hard bar survives for the ten built-in fills, where
 * `scripts/palette.mjs` still asserts it.
 *
 * **This dialog names one colour and nothing else.** It carried a 从图片取色 section for a
 * pass, reached by a second trigger that opened this same dialog scrolled down to it — two
 * entry points into one dialog, where each is a different question. Extracting from an image
 * is `components/ImagePalettePicker.tsx` now, and both end at the same `resolveCustomPalette`.
 *
 * **One piece of state, and the coordinates are the authoritative half of it.** `Pick` below
 * carries the hex *and* the hue *and* the grid cell, and the two extra fields are not
 * redundancy — they are information the hex provably cannot hold. A grey has no hue (every 0%
 * cell is `#c6c6c6`, which `Hct` reports as 209.5° whatever it was built from), and on the
 * tone-95 row the gamut holds so little chroma that two columns are 1.6 apart, so neither
 * "which hue" nor "which column" survives a round trip through the hex. Measuring them back out
 * was two visible bugs: the rail jumping to blue the moment you picked a grey, and two cells
 * ticked at once in the reds and oranges. One setter per gesture writes the whole object, so
 * there is still no synchronising effect for the React Compiler's lint to reject.
 */

/** Tone stops, spanning what the ten built-in fills occupy (20–95). */
const TONES = [95, 88, 80, 70, 60, 48, 36, 24] as const;
/**
 * Chroma as a fraction of what the gamut holds at that hue and tone.
 *
 * The last stop is **0**, which is a pure grey at that tone whatever the hue — so the last
 * column is the same ladder for every hue, and it is how a monochrome theme gets picked. It
 * is here because a grey is now a legitimate answer: `rampChroma` tapers its floor away as a
 * fill runs out of hue, so this column lands on a near-monochrome scheme rather than on a
 * grey bar over a randomly-hued ramp.
 */
const CHROMAS = [1, 0.72, 0.48, 0.28, 0] as const;
/** 24 hues at 15°, the same gap `ASSERTION 5` holds two built-in themes apart by. */
const HUE_STOPS = Array.from({ length: 24 }, (_, i) => i * 15);

const HEX = /^#[0-9a-f]{6}$/i;
/** The hue rail's swatches are drawn at one tone, so the rail reads as a spectrum. */
const RAIL_TONE = 60;

export interface ColorPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The colour to open on. The brand's own fill when nothing has been chosen yet. */
  initial: string;
  /** Called on confirm. The hex **is** `primary` — there is no second mode. */
  onPick: (hex: string) => void;
}

export default function ColorPicker({ isOpen, onClose, initial, onPick }: ColorPickerProps) {
  const tools = usePaletteTools(isOpen);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="自定义主题色" maxWidth="lg">
      {tools ? (
        <Body tools={tools} initial={initial} onPick={onPick} onClose={onClose} />
      ) : (
        <PickerSkeleton />
      )}
    </Modal>
  );
}

/**
 * The dialog's own placeholder, in the shape of the thing it is waiting for.
 *
 * A `Spinner` was here and it is the wrong primitive by this repo's own rule: a spinner is
 * for an action in flight, and a destination whose shape is known loads as that shape. The
 * shape is known to the pixel — a preview bar, a hue rail, eight grid rows — because the
 * chunk decides the *colours*, not the layout.
 */
function PickerSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-hidden="true">
      <div className="bg-surface-container-high h-[6.5rem] rounded-md" />
      <div className="bg-surface-container-high h-7 rounded-full" />
      <div className="bg-surface-container-high h-72 rounded-md" />
    </div>
  );
}

/**
 * Split out so the whole model can be `useState(initial)` with no syncing: the parent gives
 * it a fresh `key` on every open, so remounting *is* the reset.
 */
function Body({
  tools,
  initial,
  onPick,
  onClose,
}: {
  tools: PaletteTools;
  initial: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState(() => pickFrom(tools, initial.toLowerCase(), 0));
  const [draft, setDraft] = useState(() => initial.toLowerCase());
  const [error, setError] = useState<string | undefined>(undefined);
  const { hex, hue, cell } = pick;

  /** Move the rail. The cell stays where it is, so only the hue changes. */
  const setHue = (nextHue: number) => {
    const at = cell ?? cellOf(tools, hex);
    setPick({ hex: cellHex(tools, nextHue, at), hue: nextHue, cell: at });
    setDraft(cellHex(tools, nextHue, at));
    setError(undefined);
  };

  /** Choose a cell. The hue stays where it is — which is the whole point for the 0% column. */
  const setCell = (at: Cell) => {
    const next = cellHex(tools, hue, at);
    setPick({ hex: next, hue, cell: at });
    setDraft(next);
    setError(undefined);
  };

  const commitHex = (raw: string) => {
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
    <div className="flex flex-col gap-5">
      <PalettePreview derived={tools.deriveTheme(hex)} caption={hex} />

      <Group label="色相">
        {/* `gap-2` rather than the chips' 1.5: the selected stop wears a 2px ring at a 2px
            offset, which needs 4px of clearance on every side or it clips against the row
            above it once the rail wraps. */}
        <div className="flex flex-wrap gap-2">
          {HUE_STOPS.map((h) => {
            const on = Math.abs(((hue - h + 540) % 360) - 180) < 7.5;
            return (
              <button
                key={h}
                type="button"
                aria-label={`色相 ${h} 度`}
                aria-pressed={on}
                onClick={() => setHue(h)}
                className={cn(
                  'focus-ring transition-ui size-7 cursor-pointer rounded-full outline-none focus-visible:ring-2',
                  on && 'ring-primary-ink ring-offset-surface ring-2 ring-offset-2',
                )}
                style={{ background: tools.hexFromHct(h, tools.maxChroma(h, RAIL_TONE), RAIL_TONE) }}
              />
            );
          })}
        </div>
      </Group>

      <Group label="明度与彩度">
        <div className="overflow-x-auto">
          {/* `w-max`, not `min-w-max`. A grid is a block, so it fills the scroller and the
              `auto` label column absorbs every pixel of slack — which stranded the tone
              numbers at the far left with 200px of gap before the swatches. */}
          <div
            className="grid w-max gap-1"
            style={{ gridTemplateColumns: `2rem repeat(${CHROMAS.length}, 2.5rem)` }}
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
                  <span className="text-label-s text-on-surface-variant pr-2 text-right leading-9">
                    {t}
                  </span>
                  {CHROMAS.map((x) => {
                    const swatch = tools.hexFromHct(hue, x * ceiling, t);
                    /* The tick marks the cell that was *chosen*, read off `cell` rather than
                       reconstructed by measuring the hex — so exactly one cell can ever wear
                       it, and a typed hex that is not on the grid correctly wears none.

                       Measuring was two bugs. Marking the *nearest* stop pointed at a muted
                       teal while `#808080` was installed; marking every cell within a
                       tolerance ticked **two** cells at once on the tone-95 row, because the
                       gamut ceiling there is only 5.7–7.1 for the reds and oranges, which puts
                       the 100% and 72% cells 1.6–2.0 chroma apart — inside any tolerance loose
                       enough to survive `Hct.from`'s own rounding at the gamut edge. There is
                       no tolerance that fixes both; the coordinates have to be state. */
                    const on = cell?.tone === t && cell?.chroma === x;
                    return (
                      <button
                        key={x}
                        type="button"
                        aria-label={`明度 ${t}，彩度 ${Math.round(x * 100)}%，${swatch}`}
                        aria-pressed={on}
                        onClick={() => setCell({ tone: t, chroma: x })}
                        className={cn(
                          'focus-ring rounded-xs transition-ui grid h-9 cursor-pointer place-items-center outline-none focus-visible:ring-2',
                          on && 'ring-primary-ink ring-offset-surface ring-2 ring-offset-2',
                        )}
                        style={{ background: swatch, color: t > 55 ? '#000' : '#fff' }}
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

      <Group label="十六进制">
        <Input
          size="sm"
          aria-label="十六进制颜色值"
          placeholder="#e06c9f"
          spellCheck={false}
          autoComplete="off"
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

      {/* The action row is here rather than in `Modal`'s `footer`, because the buttons need
          `hex`, which is this component's state and not the parent's. */}
      <div className="flex flex-wrap justify-end gap-3 pt-1">
        <Button variant="text" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="filled"
          onClick={() => {
            onPick(hex);
            onClose();
          }}
        >
          使用此颜色
        </Button>
      </div>
    </div>
  );
}

/** A labelled block. Not `Input`'s `Field`, which wraps one control rather than a group. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label-m text-on-surface-variant">{label}</p>
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
 * `hue` is here rather than measured off `hex`, and that is the fix for a real bug rather than
 * redundancy: **a grey has no hue.** Every cell in the 0% column is `#c6c6c6` or `#727272`
 * whatever hue it was built from, and `Hct` reports **209.5°** for all of them — so picking a
 * grey out of an orange row sent the rail 164.5° across to blue and rebuilt the entire grid
 * around blue. The hex cannot carry the answer, so the answer is state.
 *
 * `cell` is here for the same shape of reason: at tone 95 the gamut holds only ~6 chroma in the
 * reds and oranges, so two adjacent columns are 1.6 apart and no measurement can tell which of
 * them was clicked. It is null for a hex that was typed and does not land on a stop, which is
 * exactly when nothing should be ticked.
 *
 * So the coordinates are authoritative and `hex` is derived — the inverse of the first version,
 * which kept only the hex and measured the rest back out of it. It is still **one** piece of
 * state, written by one setter per gesture, so there is no synchronising effect for the React
 * Compiler's lint to reject.
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
 * The model for a hex that arrived from outside the grid — `initial`, or the hex field.
 *
 * `fallbackHue` is kept when the hex is achromatic, so typing `#808080` does not throw away the
 * rail's position. The cell is claimed only if it **round-trips exactly**: a hex that is one
 * code value off a stop is not that stop, and saying otherwise is the mis-tick above.
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
