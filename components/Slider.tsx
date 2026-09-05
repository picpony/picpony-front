'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { cn, clamp01 } from '@/lib/utils';

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
  /**
   * What the current value *means*, read out instead of the bare number —
   * "0.35" tells a screen-reader user nothing.
   */
  valueText?: (value: number) => string;
  className?: string;
}

/**
 * M3 slider (M3 Expressive geometry — deliberately unlike the old one).
 *
 * The real `<input type="range">` does the work and is painted invisible over
 * the top, like `Checkbox`/`Radio`/`ToggleSwitch`: the platform keeps the drag,
 * the arrow keys, Home/End, the form value and the `slider` role; only the
 * appearance is ours. It is the first child so the painted parts key off it
 * with `peer-*`, and stays on top via z-index rather than document order. Its
 * thumb is 44dp wide so the grab area matches the painted handle's height —
 * the touch target may extend past the component's bounds.
 *
 * **Nothing about the position is transitioned**, deliberately: a slider
 * reports where the input is, and a transition would put the mark behind the
 * finger for the whole drag. The only animated property is the handle's
 * *width* (4dp → 2dp on press — it narrows, never grows).
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
  'aria-label': ariaLabel,
  ...rest
}: SliderProps) {
  const id = useId();
  const span = max - min || 1;
  const fraction = clamp01((value - min) / span);

  return (
    <div
      className={cn(
        'relative flex h-11 w-full min-w-0 items-center',
        disabled && 'disabled-content',
        className,
      )}
      style={
        {
          /* The browser's own thumb coordinates: the native thumb travels from
             half-thumb to 100% minus half-thumb, so a plain percentage would
             lead the mark at the start and lag it at the end. */
          '--slider-pos': `calc(${fraction} * (100% - 2.75rem) + 1.375rem)`,
        } as React.CSSProperties
      }
    >
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={valueText?.(value)}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className={cn(
          /* On top and transparent: this is the control, everything below is
             the picture of it. The focus ring goes here — this is what takes
             focus. */
          'peer focus-ring absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none',
          'focus-visible:ring-2',
          disabled && 'cursor-not-allowed',
          '[&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        )}
        {...rest}
      />
      {/* Active segment: 16dp, cut 8dp short of the handle's centre (6dp gap +
          2dp half-width). */}
      <span
        aria-hidden="true"
        className="bg-primary-ink absolute left-0 h-4 rounded-full"
        style={{ width: 'max(0px, calc(var(--slider-pos) - 0.5rem))' }}
      />
      {/* Inactive segment: the M3 inactive-track role (secondary-container), the
          same one the progress indicators use. */}
      <span
        aria-hidden="true"
        className="bg-secondary-container absolute right-0 h-4 rounded-full"
        style={{ left: 'min(100%, calc(var(--slider-pos) + 0.5rem))' }}
      />
      {/* Stop indicator: a 4dp dot that says the track has an end rather than a
          fade. Hidden once the value reaches it, or it sits under the handle. */}
      {fraction < 0.98 && (
        <span
          aria-hidden="true"
          className="bg-on-secondary-container absolute right-1.5 size-1 rounded-full"
        />
      )}
      {/* The handle: 4dp × 44dp, narrowing to 2dp while pressed or focused. */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-primary-ink spring-fast-spatial pointer-events-none absolute h-11 w-1 -translate-x-1/2 rounded-full transition-[width]',
          !disabled && 'peer-active:w-0.5 peer-focus-visible:w-0.5',
        )}
        style={{ left: 'var(--slider-pos)' }}
      />
    </div>
  );
}
