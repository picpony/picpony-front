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
 *
 * **The painted track spans the handle's travel, not the box.** The native thumb's
 * centre can only travel from half its width to the far end less half its width, and
 * the handle is drawn there; a track painted edge to edge left a 14px active stub at
 * the minimum and the handle standing 22px in, so a value at its minimum read as above
 * it (and the maximum mirrored it). Inset by the half-thumb, the minimum is an empty
 * track with the handle at its start.
 *
 * **Focus is on the handle**, as M3 draws it — the ring used to wrap the whole 44dp-tall
 * control in a pill.
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
             lead the mark at the start and lag it at the end. `--slider-inset` is
             that half-thumb — where the painted track starts and ends. */
          '--slider-inset': '1.375rem',
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
             the picture of it. It takes focus; the handle shows it. */
          'peer absolute inset-0 z-10 h-full w-full appearance-none rounded-full bg-transparent focus-visible:outline-hidden',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          '[&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        )}
        {...rest}
      />
      {/* Active segment: 16dp, from the track's start to 8dp short of the handle's
          centre (6dp gap + 2dp half-width) — nothing at all at the minimum. A painted
          mark, so forced colors repaints it in the system highlight. */}
      <span
        aria-hidden="true"
        className="bg-primary-ink absolute h-4 rounded-full forced-mark"
        style={{
          left: 'var(--slider-inset)',
          width: 'max(0px, calc(var(--slider-pos) - var(--slider-inset) - 0.5rem))',
        }}
      />
      {/* Inactive segment: the M3 inactive-track role (secondary-container), the
          same one the progress indicators use, ending where the handle's travel
          does. It carries the stop indicator — a 4dp dot saying the track has an
          end rather than a fade — and clips it, so the dot goes as the segment
          narrows past it instead of being left sitting on nothing. */}
      <span
        aria-hidden="true"
        className="bg-secondary-container absolute h-4 overflow-hidden rounded-full forced-boundary"
        style={{
          left: 'min(calc(100% - var(--slider-inset)), calc(var(--slider-pos) + 0.5rem))',
          right: 'var(--slider-inset)',
        }}
      >
        <span className="bg-on-secondary-container absolute top-1/2 right-1.5 size-1 -translate-y-1/2 rounded-full" />
      </span>
      {/* The handle: 4dp × 44dp, narrowing to 2dp while pressed or focused, and the
          one part that shows focus. */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-primary-ink spring-fast-spatial pointer-events-none absolute h-11 w-1 -translate-x-1/2 rounded-full transition-[width]',
          'peer-focus-visible:ring-2 peer-focus-visible:focus-ring peer-focus-visible:outline-hidden',
          'forced-color-adjust-none forced-colors:bg-[color:CanvasText]',
          !disabled && 'peer-active:w-0.5 peer-focus-visible:w-0.5',
        )}
        style={{ left: 'var(--slider-pos)' }}
      />
    </div>
  );
}
