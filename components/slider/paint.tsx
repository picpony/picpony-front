import type { ComponentProps, Ref } from 'react';
import { cn } from '@/lib/utils';

// Shared native hit geometry and M3 paint: docs/design/layout.md#slider.
export const SLIDER_INPUT =
  'peer absolute inset-0 z-10 h-full w-full appearance-none rounded-full bg-transparent focus-visible:outline-hidden ' +
  '[touch-action:pan-y_pinch-zoom] ' +
  '[&::-webkit-slider-thumb]:size-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0 ' +
  '[&::-moz-range-thumb]:size-11 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0';

function beforeHandle(fraction: number) {
  return `inset(0 calc(${(1 - fraction) * 100}% + 0.5rem) 0 0 round var(--radius-sm) 0.125rem 0.125rem var(--radius-sm))`;
}

function afterHandle(fraction: number) {
  return `inset(0 0 0 calc(${fraction * 100}% + 0.5rem) round 0.125rem var(--radius-sm) var(--radius-sm) 0.125rem)`;
}

/** The fixed handle box keeps its gap even while the ink narrows or a spring overshoots. */
export function sliderPose(fraction: number, endFraction?: number) {
  return {
    transform: `translateX(${fraction * 100}%)`,
    endTransform: `translateX(${(endFraction ?? fraction) * 100}%)`,
    inactiveStart: beforeHandle(fraction),
    active: endFraction === undefined
      ? beforeHandle(fraction)
      : `inset(0 calc(${(1 - endFraction) * 100}% + 0.5rem) 0 calc(${fraction * 100}% + 0.5rem) round 0.125rem)`,
    inactive: afterHandle(endFraction ?? fraction),
  };
}

export function SliderPaint({ children, nativeFeedback = false, disabled = false }: {
  children: ComponentProps<'div'>['children'];
  nativeFeedback?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center overflow-clip',
        nativeFeedback && 'peer-focus-visible:[&_[data-slider-thumb]]:ring-2 peer-focus-visible:[&_[data-slider-thumb]]:focus-ring',
        nativeFeedback && !disabled && 'peer-active:[&_[data-slider-ink]]:scale-x-50 peer-focus-visible:[&_[data-slider-ink]]:scale-x-50',
      )}
    >
      {children}
    </div>
  );
}

export function SliderRail({ children, ref }: {
  children: ComponentProps<'div'>['children'];
  ref: Ref<HTMLDivElement>;
}) {
  return <div ref={ref} data-slider-rail="" className="absolute inset-x-5.5 flex h-11 items-center">{children}</div>;
}

export function SliderTrack({ ref, clip, part, stopIndicator = false }: {
  ref: Ref<HTMLSpanElement>;
  clip: string;
  part: 'active' | 'inactive' | 'inactive-start';
  stopIndicator?: boolean | 'start' | 'end';
}) {
  const stopEdge = stopIndicator === true ? 'end' : stopIndicator || null;
  return (
    <span
      ref={ref}
      data-slider-track={part}
      className={cn(
        part === 'active' ? 'bg-primary-ink forced-mark' : 'bg-secondary-container forced-boundary',
        'absolute h-4 w-full rounded-sm',
      )}
      style={{ clipPath: clip }}
    >
      {stopEdge && (
        <span
          className={cn(
            'bg-primary-ink forced-mark absolute top-1/2 size-1 -translate-y-1/2 rounded-full',
            stopEdge === 'start' ? 'left-1.5' : 'right-1.5',
          )}
        />
      )}
    </span>
  );
}

export function SliderHandle({ ref, transform, handle, focused = false, pressed = false }: {
  ref: Ref<HTMLSpanElement>;
  transform: string;
  handle?: 'start' | 'end';
  focused?: boolean;
  pressed?: boolean;
}) {
  return (
    <span ref={ref} data-slider-position="" data-slider-handle={handle} className="absolute inset-0" style={{ transform }}>
      <span data-slider-thumb="" className={cn('absolute left-0 h-11 w-1 -translate-x-1/2 rounded-full', focused && 'ring-2 focus-ring')}>
        <span
          data-slider-ink=""
          className={cn(
            'bg-primary-ink transition-transform spring-fast-spatial block size-full rounded-full forced-color-adjust-none forced-colors:bg-[color:CanvasText]',
            (focused || pressed) && 'scale-x-50',
          )}
        />
      </span>
    </span>
  );
}
