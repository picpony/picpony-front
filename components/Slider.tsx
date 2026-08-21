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
   * What the current value *means*, read out instead of the bare number: "0.35"
   * tells a screen-reader user nothing, "容差 0.35" does.
   */
  valueText?: (value: number) => string;
  className?: string;
}

/**
 * M3 slider.
 *
 * There was no such primitive. Two screens shipped a bare `<input type="range">`
 * plus a global `.range-slider` class, and that class was off the spec in every
 * dimension it had: a 6px track (M3 has no 6), a `border-radius: 3px` and a
 * `border-radius: 50%` written as raw numbers rather than shape steps, a hover
 * halo at 16% — which is the *dragged* state opacity, not hover's 8% — and no
 * focus indicator at all, so the one control in the app you operate by dragging
 * could not be found by keyboard.
 *
 * **The geometry is M3 Expressive's, which does not look like the old slider.**
 * The track is 16dp tall rather than 4, and the handle is a 4dp-wide vertical pill
 * 44dp tall rather than a 20dp circle — `SliderTokens` v2_3_5. Two details carry
 * most of the character:
 *
 * - **The handle sits in a gap.** 6dp of clearance on each side, so the track is
 *   visibly cut rather than passing behind the handle. That gap is what makes a
 *   thick track read as two segments with a position between them instead of as a
 *   progress bar with a lump on it.
 * - **The handle narrows on press**, 4dp to 2dp. Not grows: M3 gives no control
 *   size feedback that *adds* mass on press, and a handle that swells under the
 *   finger hides the value it is reporting. The captcha's own handle used to grow
 *   10% and gain two elevation steps, which was three answers to one gesture.
 *
 * The real `<input type="range">` does the work and is painted invisible over the
 * top, which is the same pattern `Checkbox`, `Radio` and `ToggleSwitch` use: the
 * platform keeps the drag, the arrow keys, Home/End, PageUp/PageDown, the form
 * value and the `slider` role, and only the appearance is ours. It is the *first*
 * child so the painted parts can key off it with `peer-*`, and it stays on top
 * through `z-10` rather than through document order. Its thumb is 44dp wide so the
 * grab area matches the painted handle's height rather than its 4dp width — the
 * M3 rule that a touch target may extend past the component's bounds.
 *
 * The painted parts use the same `fraction · (100% − thumb) + thumb/2` mapping the
 * browser uses to place the thumb, so the mark cannot drift out from under the
 * finger at either end of the track.
 *
 * **Nothing about the position is transitioned**, deliberately. A slider reports
 * where the input is, and a transition on the fill or the handle would put the
 * mark behind the finger for the whole drag. The only animated property is the
 * handle's *width*, which is a state rather than a position.
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
          /* Where the handle's centre sits, in the browser's own thumb
             coordinates: the native thumb travels from `thumb/2` to
             `100% − thumb/2`, so anything painted against a plain percentage
             would lead it at the start of the track and lag it at the end. */
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
          /* On top and transparent: this is the control, everything below is the
             picture of it. The focus ring goes here rather than on the container,
             because this is what actually takes focus. */
          'peer focus-ring absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none',
          'focus-visible:ring-2',
          disabled && 'cursor-not-allowed',
          '[&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        )}
        {...rest}
      />
      {/* Active segment. `primary`, 16dp, cut 8dp short of the handle's centre —
          6dp of gap plus the 2dp half-width of the handle itself. */}
      <span
        aria-hidden="true"
        className="bg-primary absolute left-0 h-4 rounded-full"
        style={{ width: 'max(0px, calc(var(--slider-pos) - 0.5rem))' }}
      />
      {/* Inactive segment. `secondary-container` is M3's inactive track role — the
          same one the progress indicators use, so the app has one answer for
          "the part of a track that is not filled". */}
      <span
        aria-hidden="true"
        className="bg-secondary-container absolute right-0 h-4 rounded-full"
        style={{ left: 'min(100%, calc(var(--slider-pos) + 0.5rem))' }}
      />
      {/* The stop indicator at the far end: a 4dp dot on the inactive track, which
          is what tells you the track has an end rather than a fade. Hidden once
          the value reaches it, or it would sit under the handle. */}
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
          'bg-primary spring-fast-spatial pointer-events-none absolute h-11 w-1 -translate-x-1/2 rounded-full transition-[width]',
          !disabled && 'peer-active:w-0.5 peer-focus-visible:w-0.5',
        )}
        style={{ left: 'var(--slider-pos)' }}
      />
    </div>
  );
}
