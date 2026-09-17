'use client';

import { clamp, cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /**
   * Which ink the arc takes: `primary` on a surface, `on-primary` inside a
   * filled or brand-coloured control, `inherit` where the surrounding `color`
   * is the only correct answer (the lightbox sits on media-stage and needs
   * `on-media`, which neither of the other two names).
   *
   * `primary` resolves to **`primary-ink`**, not `primary`, and that is the
   * whole reason the ink role exists: the arc is a mark drawn on a surface with
   * a secondary-container track behind it, not a container with a label inside
   * it. On the five palettes whose fill is a pale coat, the brand fill measures
   * 1.07–2.13:1 against its own surface where the ink measures 2.91–2.92 — the
   * busy indicator on every non-filled button would otherwise be all but
   * invisible. One axis, deliberately, rather than two booleans that admit an
   * illegal fourth state.
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
 * Material 3 circular progress indicator — a steady rotation composed with an
 * arc that grows and shrinks (both keyframes live in globals.css), which is
 * what makes it read as progress rather than as a wheel turning. Pass `value`
 * for a determinate arc; the animations drop out and the arc is drawn to
 * length.
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
  const determinate = typeof value === 'number' && Number.isFinite(value);
  const pct = determinate ? clamp(value, 0, 100) : 0;

  // Inset by half the stroke so the ring is not clipped by the viewBox.
  const r = 50 - ((cfg.ring / cfg.width) * 100) / 2;
  const color =
    tone === 'inherit'
      ? undefined
      : tone === 'on-primary'
        ? 'var(--md-sys-color-on-primary)'
        : 'var(--md-sys-color-primary-ink)';
  /* The track is a *role*, not an alpha of the active indicator (which would
     have to be eyeballed per scheme and drifts). M3 gives the circular
     indicator a secondary-container track; over a photograph or a brand fill no
     surface role applies, so it takes media-outline — this app's role for a
     rule or track on media. */
  const trackColor =
    tone === 'primary'
      ? 'var(--md-sys-color-secondary-container)'
      : 'var(--md-sys-color-media-outline)';

  const circle = (
    <svg
      width={cfg.width}
      height={cfg.width}
      viewBox="0 0 100 100"
      className={cn('shrink-0', !determinate && 'm3-progress-spin', determinate && '-rotate-90')}
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
          tone === 'on-primary' ? 'text-on-primary' : tone === 'primary' && 'text-on-surface-variant',
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

/* The linear progress indicator lives in `components/ProgressBar.tsx` — a bar
   is not a spinner. */
