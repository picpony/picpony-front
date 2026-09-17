'use client';

import { useState } from 'react';

import Button from '@/components/Button';
import CheckGlyph from '@/components/CheckGlyph';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import PalettePreview from '@/components/PalettePreview';
import Skeleton from '@/components/Skeleton';
import { usePaletteTools, type PaletteTools } from '@/lib/paletteLazy';
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
 * **This dialog names one colour and nothing else.** Image extraction is
 * `ImagePalettePicker`'s job — a second entry point into this dialog made it carry
 * two models at once. Both end at the same `resolveCustomPalette`.
 *
 * **One piece of state, and the coordinates are the authoritative half of it.**
 * The hex provably cannot carry the hue or the cell (a grey has no hue; on the
 * palest row the gamut holds so little chroma that adjacent columns are closer
 * than `Hct`'s own rounding), so `Pick` carries all three and one setter per
 * gesture writes the whole object — no synchronising effect for the React
 * Compiler's lint to reject.
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
  return <PickerDialog tools={tools} isOpen={isOpen} initial={initial} onPick={onPick} onClose={onClose} />;
}

/**
 * The dialog's own placeholder, in the shape of the thing it is waiting for —
 * not a `Spinner`, which is for an action in flight, while a destination whose
 * shape is known loads as that shape. The shape is known to the pixel: the chunk
 * decides the *colours*, not the layout.
 */
function PickerSkeleton({ caption }: { caption: string }) {
  return (
    <div className="flex flex-col gap-5" aria-hidden="true">
      <PalettePreview caption={caption} />
      <Group label="色相">
        <div className="flex flex-wrap gap-2 p-1 pointer-coarse:gap-4 pointer-coarse:p-2">
          {HUE_STOPS.map((hue) => <Skeleton key={hue} className="size-8 rounded-full" />)}
        </div>
      </Group>
      <Group label="明度与彩度">
        <div className="popover-scrollbar overflow-x-auto">
          <div className="grid w-max gap-1 p-1 pointer-coarse:gap-2" style={{ gridTemplateColumns: `2rem repeat(${CHROMAS.length}, 2.5rem)` }}>
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
      <Group label="十六进制"><Skeleton className="h-10 w-40 rounded-xs" /></Group>
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
  onPick,
  onClose,
}: {
  tools: PaletteTools | null;
  isOpen: boolean;
  initial: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [draft, setDraft] = useState(() => initial.toLowerCase());
  const [error, setError] = useState<string | undefined>(undefined);
  const { hex, hue, cell } = pick ?? (tools
    ? pickFrom(tools, initial.toLowerCase(), 0)
    : { hex: initial.toLowerCase(), hue: 0, cell: null });

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
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button
            variant="filled"
            disabled={!tools || Boolean(error)}
            onClick={() => {
              onPick(hex);
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
          <PalettePreview derived={tools.deriveTheme(hex)} caption={hex} />

          <Group label="色相">
            {/* The rail needs 4px of clearance on every side so the selected stop's
                2px ring at a 2px offset does not clip against the row above once the
                rail wraps. */}
            <div className="flex flex-wrap gap-2 p-1 pointer-coarse:gap-4 pointer-coarse:p-2">
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
                      'touch-target focus-ring spring-fast-effects transition-[box-shadow] size-8 cursor-pointer rounded-full outline-none focus-visible:ring-2',
                      on && 'ring-primary-ink ring-offset-surface ring-2 ring-offset-2',
                    )}
                    style={{ background: tools.hexFromHct(h, tools.maxChroma(h, RAIL_TONE), RAIL_TONE) }}
                  />
                );
              })}
            </div>
          </Group>

          <Group label="明度与彩度">
            <div className="popover-scrollbar overflow-x-auto">
              {/* `w-max`, not `min-w-max`: a grid is a block, so it fills the scroller
                  and the auto label column absorbs every pixel of slack — which
                  stranded the tone numbers at the far left. */}
              <div
                className="grid w-max gap-1 p-1 pointer-coarse:gap-2"
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
                        return (
                          <button
                            key={x}
                            type="button"
                            aria-label={`明度 ${t}，彩度 ${Math.round(x * 100)}%，${swatch}`}
                            aria-pressed={on}
                            onClick={() => setCell({ tone: t, chroma: x })}
                            className={cn(
                              'touch-target focus-ring rounded-xs spring-fast-effects transition-[background-color,box-shadow] grid h-10 cursor-pointer place-items-center outline-none focus-visible:ring-2',
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

        </div>
      ) : (
        <PickerSkeleton caption={initial.toLowerCase()} />
      )}
    </Modal>
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
