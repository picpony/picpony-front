'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { formatChineseDay, type StatsWindow } from '@/lib/statsDates';

/**
 * A two-handle date slider for /stats, drawn under the chart it controls.
 *
 * Native range semantics twice over: each handle is a real `<input type="range">` (keyboard,
 * touch, screen reader), with the visual rail and handles painted by this component in the
 * shared M3 slider language. Both inputs span the whole track, so a handle can be dragged past
 * the other; the pair swaps roles instead of sticking, which is what a range control should do.
 *
 * The draft moves under the finger immediately; `onCommit` fires on release (or on a keyboard
 * step) so a drag is one request, not one per day crossed.
 */
interface DateRangeSliderProps {
  /** Earliest selectable day, `YYYY-MM-DD`. */
  min: string;
  /** Latest selectable day, `YYYY-MM-DD`. */
  max: string;
  value: StatsWindow;
  onCommit: (next: StatsWindow) => void;
  className?: string;
}

const DAY_MS = 86_400_000;

function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayFromIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fraction(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0;
}

/* The invisible native control owns the hit area: a 44dp thumb, transparent, with pointer
   events turned back on because the track itself must not swallow the clicks (two inputs
   overlap). The visible handle is a separate 44×4dp pill placed at the same fraction. */
const INPUT =
  'absolute inset-0 z-10 h-full w-full appearance-none bg-transparent pointer-events-none focus-visible:outline-hidden ' +
  '[&::-webkit-slider-runnable-track]:bg-transparent ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:opacity-0 ' +
  '[&::-moz-range-track]:bg-transparent ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0';

export default function DateRangeSlider({
  min,
  max,
  value,
  onCommit,
  className = '',
}: DateRangeSliderProps) {
  /* The draft is the only source of change once the user drags; the committed window is the
     value to fall back to (the seed) before that. There is no second writer of `value` on this
     page, so the two cannot drift and no effect needs to copy one into the other. */
  const [draft, setDraft] = useState<StatsWindow | null>(null);
  const shown = draft ?? value;
  const draftRef = useRef(shown);
  const [focusVisible, setFocusVisible] = useState<'start' | 'end' | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<'start' | 'end' | null>(null);

  const minIndex = dayIndex(min);
  const maxIndex = Math.max(minIndex, dayIndex(max));
  const startIndex = clamp(dayIndex(shown.start), minIndex, maxIndex);
  const endIndex = clamp(dayIndex(shown.end), minIndex, maxIndex);
  const startFraction = fraction(startIndex, minIndex, maxIndex);
  const endFraction = fraction(endIndex, minIndex, maxIndex);
  const low = Math.min(startFraction, endFraction);
  const high = Math.max(startFraction, endFraction);

  function apply(next: StatsWindow) {
    draftRef.current = next;
    setDraft(next);
  }

  function moveStart(index: number) {
    const day = dayFromIndex(index);
    const current = draftRef.current;
    const currentEnd = clamp(dayIndex(current.end), minIndex, maxIndex);
    apply(index > currentEnd ? { start: current.end, end: day } : { start: day, end: current.end });
  }

  function moveEnd(index: number) {
    const day = dayFromIndex(index);
    const current = draftRef.current;
    const currentStart = clamp(dayIndex(current.start), minIndex, maxIndex);
    apply(index < currentStart ? { start: day, end: current.start } : { start: current.start, end: day });
  }

  /* Read the draft from the ref: the last pointer move can land in the same batch as the
     release, and the render's `startIndex` would then be one step behind. */
  function commit() {
    const current = draftRef.current;
    onCommit({
      start: dayFromIndex(clamp(dayIndex(current.start), minIndex, maxIndex)),
      end: dayFromIndex(clamp(dayIndex(current.end), minIndex, maxIndex)),
    });
  }

  /* The pointer layer. Two native inputs stacked on one track cannot both own the track, so the
     rail takes the gesture and picks the nearer handle; the inputs stay for keyboard and AT. */
  function indexAt(clientX: number): number | null {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(minIndex + ratio * (maxIndex - minIndex));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const index = indexAt(event.clientX);
    if (index === null) return;
    /* Keep the browser's own pointerdown focus change from pulling focus off the input we are
       about to focus: the gesture layer is a plain div, and its default would land on <body>. */
    event.preventDefault();
    const which =
      Math.abs(index - startIndex) <= Math.abs(index - endIndex) ? 'start' : 'end';
    dragRef.current = which;
    setDragging(which);
    event.currentTarget.setPointerCapture(event.pointerId);
    (which === 'start' ? startRef : endRef).current?.focus({ preventScroll: true });
    if (which === 'start') moveStart(index);
    else moveEnd(index);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const index = indexAt(event.clientX);
    if (index === null) return;
    if (dragRef.current === 'start') moveStart(index);
    else moveEnd(index);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commit();
  }

  return (
    <div className={cn('w-full', className)}>
      <div
        className="relative flex h-12 w-full cursor-pointer touch-none select-none items-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          ref={trackRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-5.5 flex h-11 items-center"
        >
          {/* The single slider's paint, three times over: the rail is active up to 8dp short
              of a handle and inactive again 8dp after it, leaving the gap transparent rather
              than filling it with the inactive tone. */}
          <span
            className="bg-secondary-container forced-boundary absolute h-4 w-full rounded-sm"
            style={{
              clipPath: `inset(0 calc(${(1 - low) * 100}% + 0.5rem) 0 0 round var(--radius-sm) 0.125rem 0.125rem var(--radius-sm))`,
            }}
          />
          <span
            className="bg-primary-ink forced-mark absolute h-4 w-full rounded-sm"
            style={{
              /* Both ends face a handle gap, so both take the single slider's 2dp edge —
                 the 8dp cap belongs only to the rail's own outer ends. */
              clipPath: `inset(0 calc(${(1 - high) * 100}% + 0.5rem) 0 calc(${low * 100}% + 0.5rem) round 0.125rem)`,
            }}
          />
          <span
            className="bg-secondary-container forced-boundary absolute h-4 w-full rounded-sm"
            style={{
              clipPath: `inset(0 0 0 calc(${high * 100}% + 0.5rem) round 0.125rem var(--radius-sm) var(--radius-sm) 0.125rem)`,
            }}
          >
            <span className="bg-primary-ink absolute top-1/2 right-1.5 size-1 -translate-y-1/2 rounded-full" />
          </span>
          <span
            className={cn(
              'absolute top-1/2 h-11 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              focusVisible === 'start' && 'ring-2 focus-ring',
            )}
            style={{ left: `${startFraction * 100}%` }}
          >
            <span
              className={cn(
                'bg-primary-ink block size-full rounded-full forced-color-adjust-none forced-colors:bg-[color:CanvasText]',
                (focusVisible === 'start' || dragging === 'start') && 'scale-x-50',
              )}
            />
          </span>
          <span
            className={cn(
              'absolute top-1/2 h-11 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              focusVisible === 'end' && 'ring-2 focus-ring',
            )}
            style={{ left: `${endFraction * 100}%` }}
          >
            <span
              className={cn(
                'bg-primary-ink block size-full rounded-full forced-color-adjust-none forced-colors:bg-[color:CanvasText]',
                (focusVisible === 'end' || dragging === 'end') && 'scale-x-50',
              )}
            />
          </span>
        </div>

        <input
          ref={startRef}
          type="range"
          min={minIndex}
          max={maxIndex}
          step={1}
          value={startIndex}
          aria-label="开始日期"
          aria-valuetext={formatChineseDay(dayFromIndex(startIndex))}
          onChange={(event) => moveStart(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (/^(Arrow|Home|End|PageUp|PageDown)/.test(event.key)) setFocusVisible('start');
          }}
          onKeyUp={commit}
          onFocus={(event) =>
            setFocusVisible(event.currentTarget.matches(':focus-visible') ? 'start' : null)
          }
          onBlur={() => {
            setFocusVisible(null);
            commit();
          }}
          className={INPUT}
        />
        <input
          ref={endRef}
          type="range"
          min={minIndex}
          max={maxIndex}
          step={1}
          value={endIndex}
          aria-label="结束日期"
          aria-valuetext={formatChineseDay(dayFromIndex(endIndex))}
          onChange={(event) => moveEnd(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (/^(Arrow|Home|End|PageUp|PageDown)/.test(event.key)) setFocusVisible('end');
          }}
          onKeyUp={commit}
          onFocus={(event) =>
            setFocusVisible(event.currentTarget.matches(':focus-visible') ? 'end' : null)
          }
          onBlur={() => {
            setFocusVisible(null);
            commit();
          }}
          className={INPUT}
        />
        {/* The outer row carries the gesture: every child below it is pointer-transparent, so
            the whole rail is draggable and picks the nearer handle. The inputs stay keyboard-
            and AT-reachable underneath. */}
      </div>
      {/* The draft's own dates move with the handles, so a drag reads as a range before release. */}
      <div className="text-label-s text-on-surface-variant mt-1 flex items-center justify-between tabular-nums">
        <span>{formatChineseDay(dayFromIndex(startIndex))}</span>
        <span>{formatChineseDay(dayFromIndex(endIndex))}</span>
      </div>
    </div>
  );
}
