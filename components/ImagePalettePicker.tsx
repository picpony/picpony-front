'use client';

import { useRef, useState } from 'react';
import { MdImage } from 'react-icons/md';

import Button from '@/components/Button';
import DropZone from '@/components/DropZone';
import Modal from '@/components/Modal';
import PaletteChipFace from '@/components/PaletteChipFace';
import PalettePreview from '@/components/PalettePreview';
import Spinner from '@/components/Spinner';
import { useScheme } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import { imageOptions, usePaletteTools, type ImageOption } from '@/lib/paletteLazy';

/**
 * A theme out of a picture: Monet's extraction, offered as the colours it found.
 *
 * **Its own dialog, not a section of `ColorPicker`** — 选择颜色 asks *what
 * colour*; this asks *which of these*, and answers it with a short list nothing
 * can be typed into. One dialog holding both made the confirm button ambiguous
 * about which of the two it was sending.
 *
 * **The extraction is Monet's ranking.** `QuantizerCelebi` then `Score`; fewer
 * than four candidates is a correct answer, and this row renders what it gets.
 * The full arithmetic is on `sourceColorsFromPixels`.
 *
 * **A seed is installed verbatim, and that is the fix for "取的色很奇怪".** A
 * style puts `primary` at M3's P40/P80 and three of the five do not keep the
 * seed's hue at all, so a sunset orange offered a purple and a grey — five
 * options at tone 40, none of them the colour in the photograph. This app's bar
 * is `primary`, so the fill is the largest thing on screen. See
 * `lib/paletteRule.ts` for the full measurement.
 */
export default function ImagePalettePicker({
  isOpen,
  onClose,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** The chosen seed. It **is** `primary`, exactly as a hand-named hex is. */
  onPick: (hex: string) => void;
}) {
  const scheme = useScheme();
  const tools = usePaletteTools(isOpen);
  const [options, setOptions] = useState<ImageOption[]>([]);
  const [picked, setPicked] = useState<ImageOption | null>(null);
  /* `[]` after a run that found nothing is a real answer and prints as one, so the state is
     the array plus a phase rather than `null` standing for two different things. */
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done'>('idle');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const readImage = async (file: File) => {
    setPhase('reading');
    setPicked(null);
    try {
      const found = await imageOptions(file);
      setOptions(found);
      /* Pre-select the top-ranked one. `Score` already sorted them, so the first is AOSP's own
         answer to "what colour is this picture" — landing on it means the preview below is
         populated the moment the read finishes rather than after one more click. */
      setPicked(found[0] ?? null);
    } catch {
      setOptions([]);
    }
    setPhase('done');
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
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    setPicked(options[next] ?? null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="从图片取色" maxWidth="md">
      <div className="flex flex-col gap-5">
        <DropZone
          accept="image/*"
          disabled={phase === 'reading'}
          onFile={(file) => void readImage(file)}
          aria-label="选择或拖拽一张图片"
        >
          <div className="flex items-center justify-center gap-2">
            {phase === 'reading' ? (
              <Spinner tone="inherit" />
            ) : (
              <MdImage size={ICON.control} className="text-outline" />
            )}
            <span className="text-body-s text-on-surface-variant">
              {phase === 'reading' ? '正在取色…' : '拖一张图片进来，或点击选择'}
            </span>
          </div>
        </DropZone>

        {phase === 'done' &&
          (options.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-label-m text-on-surface-variant">这张图里的颜色</p>
              {/* `role="radiogroup"` with a roving tab stop, because a single
                  choice among four is what this is — the same argument
                  `PaletteSwatches` makes about the eleven. The tick is the whole
                  selected state, and deliberately no ring on top of it: three
                  signals for "this one" was two too many. */}
              <div role="radiogroup" aria-label="图片中的颜色" className="flex flex-wrap gap-2">
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
                      aria-label={option.seed}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setPicked(option)}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      data-ripple
                      /* `touch-size` rather than `touch-target`: `data-ripple` sets
                         `overflow: hidden` to clip the wave, which would clip a hit-area
                         pseudo-element out of hit-testing with it. */
                      className="state-layer focus-ring touch-size relative size-10 cursor-pointer overflow-hidden rounded-full outline-none focus-visible:ring-2"
                      /* The ink is this option's own, so `state-layer` — which paints from
                         `currentColor` — tints with it rather than with the active theme's. */
                      style={{ color: option.tones[scheme].onPrimary }}
                    >
                      <PaletteChipFace tone={option.tones[scheme]} selected={on} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-body-s text-on-surface-variant">
              这张图里没有能撑起主题的颜色，换一张试试。
            </p>
          ))}

        {/* The consequence of whichever chip is selected. Absent until there is one, because
            previewing the colour that is already in force would say nothing. */}
        {picked && tools && (
          <PalettePreview derived={tools.deriveTheme(picked.seed)} caption={picked.seed} />
        )}

        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="filled"
            disabled={!picked}
            onClick={() => {
              if (!picked) return;
              onPick(picked.seed);
              onClose();
            }}
          >
            使用此颜色
          </Button>
        </div>
      </div>
    </Modal>
  );
}
