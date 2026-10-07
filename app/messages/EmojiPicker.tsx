'use client';

import Image from 'next/image';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { PONY_EMOJI, UNICODE_EMOJI } from '@/lib/generated/emoji';
import { cn } from '@/lib/utils';

export type EmojiPick = { kind: 'pony'; name: string } | { kind: 'unicode'; glyph: string };

export interface EmojiPickerHandle {
  /** Put focus on the grid's one tab stop. */
  focus: () => void;
}

interface EmojiPickerProps {
  onPick: (pick: EmojiPick) => void;
  /** Focus leaving the grid by key — the surface decides where it goes next. */
  onLeave?: (direction: 'forward' | 'backward' | 'escape') => void;
  className?: string;
  /**
   * The caption's bottom inset. It is sticky at the bottom of whichever surface scrolls the
   * picker, so the surface gives it the padding it would otherwise have had itself — a padded
   * scroller shows the grid scrolling past under a sticky caption.
   */
  captionClassName?: string;
}

interface Cell {
  key: string;
  pick: EmojiPick;
  /** The Chinese name, for the caption and the accessible name. Unicode speaks for itself. */
  label: string | null;
}

const SECTIONS: { title: string; cells: Cell[] }[] = [
  {
    title: '小马表情',
    cells: PONY_EMOJI.map((emoji) => ({ key: emoji.name, pick: { kind: 'pony', name: emoji.name }, label: emoji.label })),
  },
  {
    title: '常用表情',
    cells: UNICODE_EMOJI.map((glyph) => ({ key: glyph, pick: { kind: 'unicode', glyph }, label: null })),
  },
];

const FLAT: Cell[] = SECTIONS.flatMap((section) => section.cells);
/** Where each section starts in the flat order. */
const OFFSETS = SECTIONS.map((_, s) => SECTIONS.slice(0, s).reduce((sum, section) => sum + section.cells.length, 0));
/** 44px cells: a 40dp target with 4px between, the picker's own density step. */
const CELL_PX = 44;

/**
 * The emoji picker: the pony set and the everyday Unicode set, as two grids with **one tab
 * stop** between them (a roving `tabindex`). It had 62 stops named by file slug
 * (「abwut」「ajsup」…); a cell's name is its Chinese name now, shown in the caption under the
 * grid as the pointer or the keyboard reaches it.
 *
 * Arrows move by cell and by row (across the two sections as if they were one grid, with the
 * column kept), Home / End go to a row's ends and Ctrl+Home / Ctrl+End to the first and last
 * emoji, Enter or Space picks. The column count follows the width it is given, so the same
 * picker fills a phone's panel and a desktop popover.
 */
const EmojiPicker = forwardRef<EmojiPickerHandle, EmojiPickerProps>(function EmojiPicker(
  { onPick, onLeave, className = '', captionClassName = '' },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [columns, setColumns] = useState(7);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<Cell>(FLAT[0]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setColumns(Math.max(4, Math.floor(root.clientWidth / CELL_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  /** Section, row and column of a flat index. */
  const layout = useMemo(() => {
    const places: { section: number; row: number; column: number }[] = [];
    const rowStarts: number[][] = [];
    let index = 0;
    SECTIONS.forEach((section, s) => {
      rowStarts[s] = [];
      section.cells.forEach((_, i) => {
        const row = Math.floor(i / columns);
        if (i % columns === 0) rowStarts[s].push(index);
        places.push({ section: s, row, column: i % columns });
        index += 1;
      });
    });
    return { places, rowStarts };
  }, [columns]);

  const moveTo = useCallback((index: number) => {
    const next = Math.max(0, Math.min(FLAT.length - 1, index));
    setActive(next);
    setShown(FLAT[next]);
    cellRefs.current[next]?.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => cellRefs.current[active]?.focus(),
  }), [active]);

  /** The cell at `column` of the row `delta` rows away, crossing into the next section. */
  const verticalTarget = (from: number, delta: 1 | -1) => {
    const { places, rowStarts } = layout;
    const place = places[from];
    let section = place.section;
    let row = place.row + delta;
    if (row < 0) {
      if (section === 0) return from;
      section -= 1;
      row = rowStarts[section].length - 1;
    } else if (row >= rowStarts[section].length) {
      if (section === SECTIONS.length - 1) return from;
      section += 1;
      row = 0;
    }
    const start = rowStarts[section][row];
    const sectionEnd = rowStarts[section][0] + SECTIONS[section].cells.length - 1;
    return Math.min(start + place.column, sectionEnd);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { places, rowStarts } = layout;
    const place = places[active];
    const rowStart = rowStarts[place.section][place.row];
    const sectionEnd = rowStarts[place.section][0] + SECTIONS[place.section].cells.length - 1;
    const rowEnd = Math.min(rowStart + columns - 1, sectionEnd);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = active + 1;
        break;
      case 'ArrowLeft':
        next = active - 1;
        break;
      case 'ArrowDown':
        next = verticalTarget(active, 1);
        break;
      case 'ArrowUp':
        next = verticalTarget(active, -1);
        break;
      case 'Home':
        next = event.ctrlKey || event.metaKey ? 0 : rowStart;
        break;
      case 'End':
        next = event.ctrlKey || event.metaKey ? FLAT.length - 1 : rowEnd;
        break;
      case 'Tab':
        if (onLeave) {
          event.preventDefault();
          onLeave(event.shiftKey ? 'backward' : 'forward');
        }
        return;
      case 'Escape':
        if (onLeave) {
          event.preventDefault();
          event.stopPropagation();
          onLeave('escape');
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    moveTo(next);
  };

  return (
    <div ref={rootRef} className={cn('flex min-w-0 flex-col gap-3', className)} onKeyDown={onKeyDown}>
      {SECTIONS.map((section, s) => {
        const rows: Cell[][] = [];
        for (let i = 0; i < section.cells.length; i += columns) rows.push(section.cells.slice(i, i + columns));
        return (
          <div key={section.title} className="flex flex-col gap-1">
            <span aria-hidden="true" className="px-1 text-label-m text-on-surface-variant">
              {section.title}
            </span>
            <div role="grid" aria-label={section.title} className="flex flex-col">
              {rows.map((row, r) => (
                <div role="row" key={r} className="flex">
                  {row.map((cell, c) => {
                    const index = OFFSETS[s] + r * columns + c;
                    return (
                      <div role="gridcell" key={cell.key} className="flex size-11 items-center justify-center">
                        <button
                          ref={(node) => {
                            cellRefs.current[index] = node;
                          }}
                          type="button"
                          tabIndex={index === active ? 0 : -1}
                          aria-label={cell.label ?? undefined}
                          data-ripple=""
                          onClick={() => {
                            setActive(index);
                            onPick(cell.pick);
                          }}
                          onFocus={() => {
                            setActive(index);
                            setShown(cell);
                          }}
                          onPointerEnter={() => setShown(cell)}
                          className="state-layer flex size-10 cursor-pointer items-center justify-center rounded-sm text-on-surface-variant select-none focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
                        >
                          {cell.pick.kind === 'pony' ? (
                            <Image
                              src={`/img/emoji/${cell.pick.name}.png`}
                              alt=""
                              width={32}
                              height={32}
                              unoptimized
                              draggable={false}
                              className="size-8 object-contain"
                            />
                          ) : (
                            <span className="text-headline-s leading-none">{cell.pick.glyph}</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {/* The name of whatever the pointer or the keyboard is on — once, here, rather than a
          tooltip per cell. Hidden from assistive technology: each cell is named already. */}
      <div
        aria-hidden="true"
        /* Sticky at the bottom of whichever surface scrolls it — both are `surface-container`
           (the popover's own tone and the phone panel's), so the caption wears it too. */
        className={cn(
          'sticky bottom-0 -mx-1 flex min-h-9 shrink-0 items-center gap-2 bg-surface-container px-2 text-body-m text-on-surface',
          captionClassName,
        )}
      >
        {shown.pick.kind === 'pony' ? (
          <Image
            src={`/img/emoji/${shown.pick.name}.png`}
            alt=""
            width={24}
            height={24}
            unoptimized
            className="size-6 object-contain"
          />
        ) : (
          <span className="text-title-l leading-none">{shown.pick.glyph}</span>
        )}
        <span className="truncate">{shown.label ?? ''}</span>
      </div>
    </div>
  );
});

export default EmojiPicker;
