'use client';

import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /**
   * Which ink the arc takes.
   *
   * `primary` on a surface, `on-primary` inside a filled or brand-coloured control,
   * and `inherit` where the surrounding `color` is the only correct answer — the
   * lightbox sits on `media-stage` and needs `on-media`, which is neither of the
   * other two.
   *
   * One axis, not two booleans. It was `white?: boolean` plus
   * `inheritColor?: boolean` — a raw colour name as a prop in a system that forbids
   * raw colours, and an illegal fourth state (`white` *and* `inheritColor`) that
   * nothing stopped a call site reaching. `Button` also derived `white` from its own
   * variant, which is a mapping the primitive should own.
   */
  tone?: 'primary' | 'on-primary' | 'inherit';
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
 * The previous implementation was a conic-gradient ring spun by Tailwind's spin
 * utility:
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
  tone = 'primary',
  value,
  track = false,
}: SpinnerProps) {
  const cfg = sizeConfig[size];
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.min(100, Math.max(0, value)) : 0;

  // Inset by half the stroke so the ring is not clipped by the viewBox.
  const r = 50 - ((cfg.ring / cfg.width) * 100) / 2;
  const color =
    tone === 'inherit'
      ? undefined
      : tone === 'on-primary'
        ? 'var(--md-sys-color-on-primary)'
        : 'var(--md-sys-color-primary)';
  /* The track is a *role*, not an alpha of the active indicator. It was
     `strokeOpacity={0.16}` — an alpha on a token, which the colour rules call a
     bug precisely because it has to be eyeballed once per scheme and drifts.
     M3 gives the circular indicator a `secondary-container` track; over a
     photograph or a brand fill no surface role applies, so it takes
     `media-outline`, which is this app's documented role for a rule or a track
     on media and is already the value the cropper's guides use. */
  const trackColor =
    tone === 'primary'
      ? 'var(--md-sys-color-secondary-container)'
      : 'var(--md-sys-color-media-outline)';

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
          stroke={trackColor}
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
          tone === 'on-primary' ? 'text-on-primary' : 'text-on-surface-variant',
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

/* The linear progress indicator moved to `components/ProgressBar.tsx`.
   It lived here as `LinearProgress` with zero call sites while six hand-rolled
   bars shipped across four files, so it grew a tone axis, `StopSize`, the spring
   the spec assigns and a home of its own. A bar is not a spinner. */
