'use client';

import { cn } from '@/lib/utils';

export type ProgressTone = 'secondary' | 'success' | 'warning';
export type ProgressSurface = 'default' | 'media';

/**
 * The indicator's fill. `*-fill` for the semantic tones, since a meter is a
 * graphic and the `success`/`warning` *text* roles invert between schemes.
 *
 * **The neutral tone is `secondary`, not the spec's `primary`** (`ActiveIndicatorColor`
 * is Primary over a SecondaryContainer track). Deliberate: this app holds the brand
 * pink instead of a tone of it, and `primary` on `secondary-container` measures under
 * the 3:1 WCAG 1.4.11 bar for a non-text graphic — on a meter, the filled half against
 * the empty half *is* the content. `secondary` measures 5.00:1 / 5.47:1 and is the
 * substitution the focus ring already made. `primary` is removed from the union
 * rather than left available.
 */
const FILLS: Record<ProgressTone, string> = {
  secondary: 'bg-secondary',
  success: 'bg-success-fill',
  warning: 'bg-warning-fill',
};

/** `secondary-container` is `ProgressIndicatorTokens.TrackColor`; over a
 *  photograph no surface role applies, so the media roles take over. */
const TRACKS: Record<ProgressSurface, string> = {
  default: 'bg-secondary-container',
  media: 'bg-media-outline',
};

/* **No stop indicator, and `StopSize` is a divergence now.** Tried twice — a dot in
 * the fill's colour (clipped into a nub by the track's rounding on any bar below
 * 100%), then a concentric dot in the track's on-container hidden above 98% — and
 * both read as a detached mark on a meter that is mostly not full. The M3 argument
 * for the dot is real and its cost is on the table: the dot is *required* where the
 * track's contrast against its container falls under 3:1, and `secondary-container`
 * measures ~1:1 against `surface-container-highest` — on that tone step the empty
 * half of the track is invisible. If the empty track ever needs to be locatable,
 * give the *track* contrast, not a mark at the end of an invisible one.
 * `Slider` keeps its own stop indicator — its track is 16dp with an 8dp cap, so the
 * dot reads as part of the track, and it marks a *draggable* value. */

/** Matches any width utility a call site might name, including a responsive one. */
const HAS_WIDTH = /(?:^|\s)(?:\S+:)?w-\S+/;

/**
 * The linear progress indicator, determinate and indeterminate.
 *
 * **Geometry is `LinearProgressIndicatorTokens`**: height, track and active
 * thickness are all 4dp, so there is no size axis. `StopSize` is 4dp and is **not**
 * implemented — see the block above `TRACKS`.
 *
 * `TrackActiveSpace` (a 4dp gap between indicator and remaining track) is
 * deliberately **not** implemented: it needs the remaining track's leading edge to
 * follow the value, i.e. animated position, which is the layout work `scaleX` is
 * here to avoid — and this bar runs live inside the image overlay while a hero
 * flight is landing.
 *
 * **Motion is a spring, not the loop curve.** The spec's
 * `ProgressAnimationSpec` is a critically damped spring — this app's *effects*
 * family, the one that cannot overshoot (an overshooting progress bar reads as
 * more than 100%). `spring-slow-effects` is the softest effects tier; what is
 * borrowed is the family, not the literal stiffness.
 *
 * The fill is `scaleX` on a `transform-origin: left` box, not an animated width:
 * width puts every frame through layout and paint.
 */
export default function ProgressBar({
  value,
  tone = 'secondary',
  surface = 'default',
  label,
  className = '',
}: {
  /** 0–100. Omit for an indeterminate sweep. */
  value?: number;
  tone?: ProgressTone;
  /** The enclosure, not a colour: `media` is a bar drawn over a photograph. */
  surface?: ProgressSurface;
  /** Accessible name. Say what is progressing, not that something is. */
  label?: string;
  className?: string;
}) {
  const determinate = typeof value === 'number';
  const pct = determinate ? Math.min(100, Math.max(0, value)) : 0;
  const fill = FILLS[tone];

  return (
    <div
      role="progressbar"
      aria-label={label || '加载中'}
      aria-valuenow={determinate ? Math.round(pct) : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      className={cn(
        'relative h-1 overflow-hidden rounded-full',
        /* Same guard as `Skeleton`'s conditional radius: `cn` is a plain join, so
           a call site naming its own width emitted that *and* the full-width
           default, leaving Tailwind's output order to pick — which clipped a
           profile banner's XP bar 24px off its right end. A caller that has said
           otherwise has already answered the question. */
        !HAS_WIDTH.test(className) && 'w-full',
        TRACKS[surface],
        className,
      )}
    >
      <div
        className={cn(
          'h-full w-full origin-left rounded-full',
          fill,
          determinate ? 'spring-slow-effects transition-transform' : 'm3-linear-bar',
        )}
        style={determinate ? { transform: `scaleX(${pct / 100})` } : undefined}
      />
    </div>
  );
}
