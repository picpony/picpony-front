'use client';

import { useEffect, useRef, useState } from 'react';
import { MdImage } from 'react-icons/md';

import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import PaletteTileFace from '@/components/PaletteTileFace';
import PalettePreview from '@/components/PalettePreview';
import Spinner from '@/components/Spinner';
import { apiErrorMessage } from '@/lib/api/errors';
import { useScheme, type CustomSpec, type PaletteHues } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import { ImageDecodeError, imageOptions, usePaletteTools, type ImageOption } from '@/lib/paletteLazy';

/**
 * A theme recommended from a picture: direction A ranks readable hue families by area,
 * then chooses suitable light/deep fills. The displayed recommendation installs exactly.
 *
 * **Its own dialog, not a section of `ColorPicker`** — 选择颜色 asks *what
 * colour*; this asks *which of these*, and answers it with a short list nothing
 * can be typed into. One dialog holding both made the confirm button ambiguous
 * about which of the two it was sending.
 *
 * Image recommendations are separate from the exact manual/saved-colour path. The
 * approved borderless theme tiles and one companion hue remain the selection model.
 */
/** A file this browser cannot read, told apart from every other failure. */
const failureMessage = (error: unknown) =>
  error instanceof ImageDecodeError ? '无法读取此图片，换一张试试。' : apiErrorMessage(error);

export default function ImagePalettePicker({
  isOpen,
  onClose,
  hues,
  onPick,
  onExited,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 配色方案 in force: under 单色 the options are the picture's colours alone. */
  hues: PaletteHues;
  /** The chosen palette. Its seed **is** `primary`, exactly as a hand-named hex is. */
  onPick: (spec: CustomSpec) => void;
  /** The dialog has finished leaving — where the theme wipe may start. */
  onExited?: () => void;
}) {
  const scheme = useScheme();
  const multi = hues === 'multi';
  const tools = usePaletteTools(isOpen);
  const [options, setOptions] = useState<ImageOption[]>([]);
  const [picked, setPicked] = useState<ImageOption | null>(null);
  /* `[]` after a run that found nothing is a real answer and prints as one, so the state is
     the array plus a phase rather than `null` standing for two different things — and a file
     that could not be read at all is a third thing again (`failed`). */
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done' | 'failed'>('idle');
  const [failure, setFailure] = useState('');
  /** The chosen picture, shown small in the zone so the colours below have a source. */
  const [preview, setPreview] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const read = useRef(0);

  /* Each object URL is revoked when it is replaced and when the dialog goes. */
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  /* The read settles into a value rather than a try/catch: the React Compiler cannot lower a
     conditional or `??` inside a try block, and this component was the one it skipped. */
  const readImage = async (file: File) => {
    const request = ++read.current;
    setPhase('reading');
    setPicked(null);
    const result = await imageOptions(file).then(
      (found) => ({ found, error: null }),
      (error: unknown) => ({ found: null, error }),
    );
    if (request !== read.current) return;
    if (!result.found) {
      setOptions([]);
      setPreview(null);
      setFailure(failureMessage(result.error));
      setPhase('failed');
      return;
    }
    setOptions(result.found);
    setPreview(URL.createObjectURL(file));
    /* Open on the largest readable hue family's recommendation and its actual theme. */
    setPicked(result.found[0] ?? null);
    setPhase('done');
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next: number | null = null;
    if (step !== undefined) next = (index + step + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    setPicked(options[next] ?? null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="从图片取色"
      maxWidth="md"
      onExited={onExited}
      footer={
        <>
          <Button variant="text" onClick={onClose}>取消</Button>
          <Button
            variant="filled"
            disabled={!picked}
            onClick={() => {
              if (!picked) return;
              onPick({ seed: picked.seed, accent: picked.accent });
              onClose();
            }}
          >
            使用此颜色
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <DropZone
          accept="image/*"
          disabled={phase === 'reading'}
          filled={Boolean(preview)}
          onFile={(file) => void readImage(file)}
          aria-label="选择或拖拽一张图片"
        >
          {/* One row in every state, 40px tall (the thumbnail's height), so the zone does
              not change size when a picture is chosen. */}
          <div className="flex min-h-10 items-center justify-center gap-3">
            {phase === 'reading' ? (
              <Spinner tone="inherit" />
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
            ) : (
              <MdImage size={ICON.control} className="text-outline" />
            )}
            <span className="text-body-s text-on-surface-variant">
              {phase === 'reading'
                ? '正在取色…'
                : preview
                  ? '点击或拖拽以更换图片'
                  : '拖一张图片进来，或点击选择'}
            </span>
          </div>
        </DropZone>

        {phase === 'done' &&
          (options.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-label-m text-on-surface-variant">{multi ? '从图片推荐的配色' : '从图片推荐的颜色'}</p>
              <p className="text-body-s text-on-surface-variant">按色彩占比推荐，并调整明度与彩度，让颜色更适合界面。</p>
              {/* `role="radiogroup"` with a roving tab stop, because a single
                  choice among up to eight is what this is — the same argument
                  `PaletteSwatches` makes about the eleven, and the same tile: each
                  option is the theme it would install, in miniature. The badge is the
                  whole selected state, and deliberately no ring on top of it: three
                  signals for "this one" was two too many. Four to a row at every width — two
                  rows of four, where a phone's dialog wrapped three, three and two: the grid is
                  capped at four 72dp tiles and their gaps, and a narrower dialog narrows the
                  tiles rather than the count. */}
              <div
                role="radiogroup"
                aria-label={multi ? '图片推荐配色' : '图片推荐颜色'}
                className="grid w-full max-w-81 grid-cols-4 gap-3"
              >
                {options.map((option, index) => {
                  const on = picked?.seed === option.seed;
                  return (
                    <button
                      key={option.seed}
                      ref={(node) => {
                        refs.current[index] = node;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={
                        multi ? `${option.seed}，副色相${option.accent === null ? '自动' : '取自图中'}` : option.seed
                      }
                      tabIndex={on ? 0 : -1}
                      onClick={() => setPicked(option)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      data-ripple
                      /* The settings tile's box: 72 × 56 at the card's corner (the grid's column,
                         a little narrower in a phone's dialog), no edge of its own, past the touch
                         floor at every density. */
                      className="state-layer focus-ring forced-boundary text-on-surface relative h-14 w-full cursor-pointer overflow-hidden rounded-md focus-visible:outline-hidden focus-visible:ring-2"
                    >
                      <PaletteTileFace
                        tone={option.tones[scheme]}
                        face={option.tones.face[scheme]}
                        hues={hues}
                        selected={on}
                      />
                    </button>
                  );
                })}
              </div>
              {multi && picked && (
                <p className="text-body-s text-on-surface-variant">
                  {picked.accent === null
                    ? '未找到合适的图中副色，已自动搭配'
                    : '副色相也取自这张图'}
                </p>
              )}
            </div>
          ) : (
            <EmptyState size="inline" title="没有找到可读取的颜色，换一张试试。" />
          ))}

        {phase === 'failed' && <ErrorRetry size="inline" title={failure} />}

        {/* The consequence of whichever tile is selected. Absent until there is one, because
            previewing the colour that is already in force would say nothing. */}
        {picked && tools && (
          <PalettePreview
            derived={tools.deriveCustomTheme({ seed: picked.seed, accent: picked.accent })}
            hues={hues}
            caption={picked.seed}
          />
        )}

      </div>
    </Modal>
  );
}
