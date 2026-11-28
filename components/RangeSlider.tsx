'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { clamp01, cn } from '@/lib/utils';
import { SLIDER_INPUT, SliderHandle, SliderPaint, SliderRail, SliderTrack } from '@/components/slider/paint';
import {
  moveRangeHandle,
  normalizeRange,
  sameRange,
  snapRangeValue,
  type RangeHandle,
  type RangeValue,
} from '@/components/slider/range';
import { useSliderPaint } from '@/components/slider/useSliderPaint';

export type RangeSliderValue = RangeValue;

interface RangeSliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: RangeSliderValue;
  /** Live draft feedback; expensive work belongs in onCommit, not here. */
  onValueChange?: (next: RangeSliderValue) => void;
  /** One changed value per pointer release, or per native keyboard / AT step. */
  onCommit: (next: RangeSliderValue) => void;
  startLabel: string;
  endLabel: string;
  'aria-label'?: string;
  valueText?: (value: number) => string;
  renderValue?: (value: RangeSliderValue) => ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

interface RangePointer {
  id: number;
  handle: RangeHandle;
  x: number;
  y: number;
  grabOffset: number;
  origin: RangeValue;
  target: HTMLDivElement;
}

function releasePointer(held: RangePointer | null) {
  if (held?.target.hasPointerCapture(held.id)) held.target.releasePointerCapture(held.id);
}

/** A single rail with two native keyboard / AT controls and a release-only commit boundary.
 * Paint, select jumps and fixed hit geometry are shared with Slider.
 * See docs/design/layout.md#slider and docs/motion.md#controls-and-feedback. */
export default function RangeSlider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onValueChange,
  onCommit,
  startLabel,
  endLabel,
  'aria-label': ariaLabel,
  valueText,
  renderValue,
  disabled = false,
  id,
  className = '',
}: RangeSliderProps) {
  const upper = Math.max(min, max);
  const increment = step > 0 ? step : 1;
  const { start: sourceStart, end: sourceEnd } = value;
  const external = normalizeRange(value, min, upper, increment);
  const [state, setState] = useState(() => ({
    min,
    max: upper,
    step: increment,
    sourceStart,
    sourceEnd,
    draft: external,
  }));
  const sourceChanged =
    state.min !== min ||
    state.max !== upper ||
    state.step !== increment ||
    state.sourceStart !== sourceStart ||
    state.sourceEnd !== sourceEnd;
  // Guard by primitive source values, not object identity: parent rerenders must not erase a draft.
  const shown = sourceChanged ? external : state.draft;
  if (sourceChanged) setState({ min, max: upper, step: increment, sourceStart, sourceEnd, draft: external });

  const generatedId = useId();
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(shown);
  const committedRef = useRef(shown);
  const limitsRef = useRef({ min, max: upper, step: increment });
  const pointer = useRef<RangePointer | null>(null);
  const nativeCommitPending = useRef(false);
  const transferringFocus = useRef(false);
  const [focusVisible, setFocusVisible] = useState<RangeHandle | null>(null);
  const [dragging, setDragging] = useState<RangeHandle | null>(null);
  const fraction = (number: number) => (upper > min ? clamp01((number - min) / (upper - min)) : 0);
  const startFraction = fraction(shown.start);
  const endFraction = fraction(shown.end);
  const {
    railRef,
    positionRef,
    endPositionRef,
    activeRef,
    inactiveRef,
    inactiveStartRef,
    queueJump,
    cancelJump,
    pose,
  } = useSliderPaint(startFraction, disabled, endFraction);

  const apply = useCallback(
    (next: RangeValue) => {
      if (sameRange(draftRef.current, next)) return;
      draftRef.current = next;
      setState((previous) => ({ ...previous, draft: next }));
      onValueChange?.(next);
    },
    [onValueChange],
  );

  const commit = useCallback(
    (next: RangeValue) => {
      if (sameRange(committedRef.current, next)) return;
      committedRef.current = { ...next };
      onCommit(next);
    },
    [onCommit],
  );

  const clearPointer = useCallback(() => {
    const held = pointer.current;
    pointer.current = null;
    setDragging(null);
    // Clear ownership before releasing capture: the resulting lost-capture is not a cancellation.
    releasePointer(held);
    return held;
  }, []);

  const cancelGesture = useCallback(() => {
    const held = clearPointer();
    cancelJump();
    if (held) apply(held.origin);
  }, [apply, cancelJump, clearPointer]);

  const focusHandle = useCallback((handle: RangeHandle) => {
    const input = (handle === 'start' ? startRef : endRef).current;
    if (!input || document.activeElement === input) return;
    // Crossing transfers the physical handle's focus without ending its gesture on blur.
    transferringFocus.current = true;
    input.focus({ preventScroll: true });
    transferringFocus.current = false;
  }, []);

  const moveHandle = useCallback(
    (handle: RangeHandle, number: number) => {
      const moved = moveRangeHandle(draftRef.current, handle, snapRangeValue(number, min, upper, increment));
      apply(moved.value);
      if (moved.handle !== handle) {
        if (pointer.current) {
          pointer.current.handle = moved.handle;
          setDragging(moved.handle);
        }
        focusHandle(moved.handle);
        if (pointer.current) setFocusVisible(null);
      }
      return moved.value;
    },
    [apply, focusHandle, min, upper, increment],
  );

  useLayoutEffect(() => {
    const next = normalizeRange({ start: sourceStart, end: sourceEnd }, min, upper, increment);
    const limitsChanged =
      limitsRef.current.min !== min || limitsRef.current.max !== upper || limitsRef.current.step !== increment;
    const echo = sameRange(next, draftRef.current);
    if (limitsChanged || !echo) {
      clearPointer();
      cancelJump();
    }
    // A live controlled echo must not make release look already committed or stop a select jump.
    if (limitsChanged || !echo || (!pointer.current && !nativeCommitPending.current)) committedRef.current = next;
    draftRef.current = next;
    limitsRef.current = { min, max: upper, step: increment };
  }, [sourceStart, sourceEnd, min, upper, increment, clearPointer, cancelJump]);

  useLayoutEffect(() => {
    if (!disabled) return;
    // External disablement ends capture and restores React's draft before the next paint.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      cancelGesture();
      setFocusVisible(null);
    });
    return () => {
      active = false;
    };
  }, [disabled, cancelGesture]);

  useEffect(() => {
    const onWindowBlur = () => {
      setFocusVisible(null);
      cancelGesture();
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [cancelGesture]);

  useEffect(
    () => () => {
      const held = pointer.current;
      pointer.current = null;
      releasePointer(held);
    },
    [],
  );

  function indexAt(clientX: number) {
    const rail = railRef.current?.getBoundingClientRect();
    if (!rail || rail.width <= 0) return null;
    return snapRangeValue(min + clamp01((clientX - rail.left) / rail.width) * (upper - min), min, upper, increment);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || pointer.current || !event.isPrimary || event.button !== 0) return;
    const rail = railRef.current?.getBoundingClientRect();
    const startPosition = positionRef.current?.getBoundingClientRect();
    const endPosition = endPositionRef.current?.getBoundingClientRect();
    const index = indexAt(event.clientX);
    if (!rail || rail.width <= 0 || !startPosition || !endPosition || index === null) return;
    event.preventDefault();
    const current = draftRef.current;
    const handle = Math.abs(index - current.start) <= Math.abs(index - current.end) ? 'start' : 'end';
    const center = rail.left + fraction(current[handle]) * rail.width;
    const halfThumb = (event.currentTarget.getBoundingClientRect().width - rail.width) / 2;
    const onThumb = Math.abs(event.clientX - center) <= halfThumb;
    pointer.current = {
      id: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
      grabOffset: onThumb ? event.clientX - center : 0,
      origin: { ...current },
      target: event.currentTarget,
    };
    focusHandle(handle);
    setFocusVisible(null);
    setDragging(handle);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (onThumb) cancelJump();
    else {
      queueJump([
        clamp01((startPosition.left - rail.left) / rail.width),
        clamp01((endPosition.left - rail.left) / rail.width),
      ]);
      moveHandle(handle, index);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const held = pointer.current;
    if (!held || held.id !== event.pointerId || (held.x === event.clientX && held.y === event.clientY)) return;
    held.x = event.clientX;
    held.y = event.clientY;
    cancelJump();
    const index = indexAt(event.clientX - held.grabOffset);
    if (index !== null) moveHandle(held.handle, index);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    onPointerMove(event);
    clearPointer();
    queueJump(null);
    commit(draftRef.current);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current?.id === event.pointerId) cancelGesture();
  }

  function renderInput(handle: RangeHandle, label: string) {
    return (
      <input
        ref={handle === 'start' ? startRef : endRef}
        id={`${id ?? generatedId}-${handle}`}
        type="range"
        min={min}
        max={upper}
        step={increment}
        value={shown[handle]}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText?.(shown[handle])}
        onChange={(event) => {
          if (pointer.current) cancelGesture();
          cancelJump();
          nativeCommitPending.current = true;
          try {
            commit(moveHandle(handle, Number(event.currentTarget.value)));
          } finally {
            nativeCommitPending.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) {
            cancelGesture();
            setFocusVisible(handle);
          }
        }}
        onFocus={(event) => setFocusVisible(event.currentTarget.matches(':focus-visible') ? handle : null)}
        onBlur={() => {
          setFocusVisible(null);
          if (!transferringFocus.current) cancelGesture();
        }}
        className={cn(
          SLIDER_INPUT,
          'pointer-events-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent',
        )}
      />
    );
  }

  return (
    <div
      data-slider=""
      data-range-slider=""
      role="group"
      aria-label={ariaLabel}
      className={cn('w-full min-w-0', disabled && 'disabled-content', className)}
    >
      <div
        className={cn(
          'relative flex h-12 w-full select-none items-center [touch-action:pan-y_pinch-zoom]',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        {renderInput('start', startLabel)}
        {renderInput('end', endLabel)}
        <SliderPaint>
          <SliderRail ref={railRef}>
            <SliderTrack ref={inactiveStartRef} part="inactive-start" clip={pose.inactiveStart} stopIndicator="start" />
            <SliderTrack ref={activeRef} part="active" clip={pose.active} />
            <SliderTrack ref={inactiveRef} part="inactive" clip={pose.inactive} stopIndicator="end" />
            <SliderHandle
              ref={positionRef}
              handle="start"
              transform={pose.transform}
              focused={focusVisible === 'start'}
              pressed={dragging === 'start'}
            />
            <SliderHandle
              ref={endPositionRef}
              handle="end"
              transform={pose.endTransform}
              focused={focusVisible === 'end'}
              pressed={dragging === 'end'}
            />
          </SliderRail>
        </SliderPaint>
      </div>
      {renderValue?.(shown)}
    </div>
  );
}
