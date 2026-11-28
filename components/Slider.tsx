'use client';

import { useId, useRef, type InputHTMLAttributes, type PointerEvent } from 'react';
import { cn, clamp01 } from '@/lib/utils';
import {
  SLIDER_INPUT,
  SliderHandle,
  SliderPaint,
  SliderRail,
  SliderTrack,
} from '@/components/slider/paint';
import { useSliderPaint } from '@/components/slider/useSliderPaint';

interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'size'
> {
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
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const fraction = max > min ? clamp01((value - min) / (max - min)) : 0;
  const { railRef, positionRef, activeRef, inactiveRef, queueJump, stop, pose } = useSliderPaint(
    fraction,
    disabled,
  );

  function resetPointer(event: PointerEvent<HTMLInputElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    queueJump(null);
  }

  return (
    <div
      data-slider=""
      className={cn(
        'relative flex h-12 w-full min-w-0 select-none items-center',
        disabled && 'disabled-content',
        className,
      )}
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
          const onThumb =
            Math.abs(event.clientX - (rail.left + fraction * rail.width)) <= halfThumb;
          queueJump(onThumb ? null : [clamp01((position.left - rail.left) / rail.width)]);
          if (onThumb) stop();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          const held = pointer.current;
          if (
            !held ||
            held.id !== event.pointerId ||
            (held.x === event.clientX && held.y === event.clientY)
          )
            return;
          queueJump(null);
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
          if (
            !event.defaultPrevented &&
            /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)
          ) {
            queueJump(null);
            stop();
          }
        }}
        onBlur={(event) => {
          pointer.current = null;
          queueJump(null);
          stop();
          onBlur?.(event);
        }}
        className={cn(SLIDER_INPUT, disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
      />
      <SliderPaint nativeFeedback disabled={disabled}>
        {/* Keep the translated paint clipped without clipping the native input's hit region. */}
        <SliderRail ref={railRef}>
          <SliderTrack ref={activeRef} part="active" clip={pose.active} />
          <SliderTrack ref={inactiveRef} part="inactive" clip={pose.inactive} stopIndicator />
          <SliderHandle ref={positionRef} transform={pose.transform} />
        </SliderRail>
      </SliderPaint>
    </div>
  );
}
