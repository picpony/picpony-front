'use client';

import { useCallback, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type PointerEvent } from 'react';
import { cn, clamp01 } from '@/lib/utils';
import { useMotionScale, useMotionTier } from '@/lib/appearance';
import { sampleEasing, sampledTrack } from '@/lib/sampledAnimation';
import { SHAPE_SPEC, springEase } from '@/lib/spring';
import { shapeFor, springTiming } from '@/lib/springTiming';

interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'size'> {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Required — a bare track has nothing to name it. */
  'aria-label': string;
  /** The meaning of the current value, instead of a bare number. */
  valueText?: (value: number) => string;
  className?: string;
}

function sliderPose(fraction: number) {
  return {
    transform: `translateX(${fraction * 100}%)`,
    // Oversized insets collapse to an empty clip at either endpoint. Keeping the
    // gap in every keyframe also keeps it constant during select jumps.
    active: `inset(0 calc(${(1 - fraction) * 100}% + 0.5rem) 0 0 round var(--radius-sm) 0.125rem 0.125rem var(--radius-sm))`,
    inactive: `inset(0 0 0 calc(${fraction * 100}% + 0.5rem) round 0.125rem var(--radius-sm) var(--radius-sm) 0.125rem)`,
  };
}

/**
 * Native range semantics with M3 Expressive paint. Press/focus changes only the
 * handle's ink; its layout and the native grab target stay fixed. Track selection
 * animates the paint, while dragging and keyboard input remain immediate.
 * Geometry, source references and motion: docs/design/layout.md#slider.
 */
export default function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  valueText,
  className = '',
  id,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onBlur,
  'aria-label': ariaLabel,
  ...rest
}: SliderProps) {
  const generatedId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const inactiveRef = useRef<HTMLSpanElement>(null);
  const animations = useRef<Animation[]>([]);
  const jumpFrom = useRef<number | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const tier = useMotionTier();
  const scale = useMotionScale('feedback');
  const fraction = max > min ? clamp01((value - min) / (max - min)) : 0;
  const pose = sliderPose(fraction);

  const stop = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);

  useLayoutEffect(() => {
    const from = jumpFrom.current;
    jumpFrom.current = null;
    stop();
    const position = positionRef.current;
    const active = activeRef.current;
    const inactive = inactiveRef.current;
    if (disabled || tier === 'off' || from === null || from === fraction || !position || !active || !inactive) return stop;

    const distance = fraction - from;
    const samples = sampleEasing(springEase(SHAPE_SPEC[shapeFor('fastSpatial')]));
    // Clamp spring overshoot to the range, without cutting off its settling tail.
    const bounded = (progress: number) => (clamp01(from + distance * progress) - from) / distance;
    const timing = springTiming('fastSpatial');
    const tracks: [HTMLElement, (progress: number) => Keyframe][] = [
      [position, (progress) => ({ transform: sliderPose(from + distance * progress).transform })],
      [active, (progress) => ({ clipPath: sliderPose(from + distance * progress).active })],
      [inactive, (progress) => ({ clipPath: sliderPose(from + distance * progress).inactive })],
    ];
    animations.current = tracks.map(([element, frame]) => {
      const track = sampledTrack(samples, frame, bounded);
      return element.animate(track.keyframes, { ...timing, easing: track.easing });
    });
    return stop;
  }, [fraction, disabled, tier, scale, stop]);

  function resetPointer(event: PointerEvent<HTMLInputElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    jumpFrom.current = null;
  }

  return (
    <div
      data-slider=""
      className={cn('relative flex h-12 w-full min-w-0 select-none items-center', disabled && 'disabled-content', className)}
    >
      <input
        {...rest}
        id={id ?? generatedId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={valueText?.(value)}
        onChange={(event) => onValueChange(Number(event.target.value))}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented || disabled || !event.isPrimary || event.button !== 0) return;
          const rail = railRef.current?.getBoundingClientRect();
          const position = positionRef.current?.getBoundingClientRect();
          if (!rail || !position || rail.width <= 0) return;
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          const halfThumb = (event.currentTarget.getBoundingClientRect().width - rail.width) / 2;
          const onThumb = Math.abs(event.clientX - (rail.left + fraction * rail.width)) <= halfThumb;
          jumpFrom.current = onThumb ? null : clamp01((position.left - rail.left) / rail.width);
          if (onThumb) stop();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          const held = pointer.current;
          if (!held || held.id !== event.pointerId || (held.x === event.clientX && held.y === event.clientY)) return;
          jumpFrom.current = null;
          stop();
        }}
        onPointerUp={(event) => {
          resetPointer(event);
          onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          resetPointer(event);
          stop();
          onPointerCancel?.(event);
        }}
        onLostPointerCapture={(event) => {
          if (pointer.current?.id === event.pointerId) {
            resetPointer(event);
            stop();
          }
          onLostPointerCapture?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)) {
            jumpFrom.current = null;
            stop();
          }
        }}
        onBlur={(event) => {
          pointer.current = null;
          jumpFrom.current = null;
          stop();
          onBlur?.(event);
        }}
        className={cn(
          'peer absolute inset-0 z-10 h-full w-full appearance-none rounded-full bg-transparent focus-visible:outline-hidden',
          '[touch-action:pan-y_pinch-zoom]',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          '[&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center overflow-clip',
          'peer-focus-visible:[&_[data-slider-thumb]]:ring-2 peer-focus-visible:[&_[data-slider-thumb]]:focus-ring',
          !disabled && 'peer-active:[&_[data-slider-ink]]:scale-x-50 peer-focus-visible:[&_[data-slider-ink]]:scale-x-50',
        )}
      >
        {/* The full-width translation box must not widen the surrounding scroller.
            This paint clip includes the thumb's focus ring and leaves the input outside. */}
        <div ref={railRef} data-slider-rail="" className="absolute inset-x-5.5 flex h-11 items-center">
          <span
            ref={activeRef}
            data-slider-track="active"
            className="bg-primary-ink forced-mark absolute h-4 w-full rounded-sm"
            style={{ clipPath: pose.active }}
          />
          <span
            ref={inactiveRef}
            data-slider-track="inactive"
            className="bg-secondary-container forced-boundary absolute h-4 w-full rounded-sm"
            style={{ clipPath: pose.inactive }}
          >
            <span className="bg-primary-ink absolute top-1/2 right-1.5 size-1 -translate-y-1/2 rounded-full" />
          </span>
          <span ref={positionRef} data-slider-position="" className="absolute inset-0" style={{ transform: pose.transform }}>
            <span data-slider-thumb="" className="absolute left-0 h-11 w-1 -translate-x-1/2 rounded-full">
              <span data-slider-ink="" className="bg-primary-ink block size-full rounded-full forced-color-adjust-none forced-colors:bg-[color:CanvasText]" />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
