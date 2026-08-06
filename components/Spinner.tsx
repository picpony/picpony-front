'use client';

import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /** For buttons on filled/brand backgrounds — inherits `on-primary`. */
  white?: boolean;
  /**
   * Take the surrounding `color` instead of a token. For surfaces that are
   * neither the page nor a brand fill — the lightbox sits on `media-stage` and
   * needs `on-media`, which is not one of the two the flag above can pick.
   */
  inheritColor?: boolean;
  /** 0–100. Omit for the indeterminate sweep. */
  value?: number;
  /** Draw the faint full-circle track behind the arc (M3 Expressive). */
  track?: boolean;
}

/* width = outer diameter, ring = stroke width. */
const sizeConfig = {
  sm: { width: 20, ring: 2.5 },
  md: { width: 24, ring: 3 },
  lg: { width: 36, ring: 4 },
  xl: { width: 50, ring: 5 },
};

/**
 * Material 3 circular progress indicator.
 *
 * The previous implementation was a conic-gradient ring spun by `animate-spin`:
 * a wheel turning at a constant rate. The Material indicator composes two
 * motions — a steady rotation of the whole ring plus an arc that grows and
 * shrinks — so the head runs ahead and the tail catches up. That second motion
 * is what makes it read as progress. Both live in globals.css
 * (`.m3-progress-spin` / `.m3-progress-arc`).
 *
 * Pass `value` for a determinate arc; the animations drop out and the arc is
 * drawn to length instead.
 */
export default function Spinner({
  size = 'md',
  label,
  className = '',
  white = false,
  inheritColor = false,
  value,
  track = false,
}: SpinnerProps) {
  const cfg = sizeConfig[size];
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.min(100, Math.max(0, value)) : 0;

  // Inset by half the stroke so the ring is not clipped by the viewBox.
  const r = 50 - ((cfg.ring / cfg.width) * 100) / 2;
  const color = inheritColor
    ? undefined
    : white
      ? 'var(--md-sys-color-on-primary)'
      : 'var(--md-sys-color-primary)';

  const circle = (
    <svg
      width={cfg.width}
      height={cfg.width}
      viewBox="0 0 100 100"
      className={cn(!determinate && 'm3-progress-spin', determinate && '-rotate-90')}
      role="progressbar"
      aria-label={label || '加载中'}
      aria-valuenow={determinate ? pct : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      style={{ color }}
    >
      {track && (
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.16}
          strokeWidth={(cfg.ring / cfg.width) * 100}
        />
      )}
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={(cfg.ring / cfg.width) * 100}
        // Rounded caps are what distinguish the M3 indicator from a plain arc.
        strokeLinecap="round"
        // Normalises the path to 100 units so the dash values in the keyframes
        // are radius-independent.
        pathLength={100}
        className={cn(!determinate && 'm3-progress-arc')}
        strokeDasharray={determinate ? `${pct} ${100 - pct}` : undefined}
      />
    </svg>
  );

  if (label !== undefined) {
    return (
      <div
        className={cn(
          'flex items-center justify-center gap-2',
          white ? 'text-on-primary' : 'text-on-surface-variant',
          className,
        )}
      >
        {circle}
        {label && <span className="text-body-m">{label}</span>}
      </div>
    );
  }

  return <span className={className}>{circle}</span>;
}

/**
 * Material 3 linear progress indicator. Used where a spinner would sit alone in
 * a wide empty area — a bar communicates"this region is loading" better than a
 * dot floating in the middle of it.
 */
export function LinearProgress({
  value,
  className = '',
  label,
}: {
  value?: number;
  className?: string;
  label?: string;
}) {
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.min(100, Math.max(0, value)) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label || '加载中'}
      aria-valuenow={determinate ? pct : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      className={cn(
        'bg-primary-container relative h-1 w-full overflow-hidden rounded-full',
        className,
      )}
    >
      <div
        className={cn(
          'bg-primary h-full rounded-full',
          determinate
            ? 'transition-[width] duration-300 ease-[var(--ease-standard)]'
            : 'm3-linear-bar w-full',
        )}
        style={determinate ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
