'use client';

import { cn } from '@/lib/utils';

export type ProgressTone = 'secondary' | 'success' | 'warning';
export type ProgressSurface = 'default' | 'media';

/**
 * The indicator's fill. `*-fill` for the semantic tones, since a meter is a
 * graphic and the `success`/`warning` *text* roles invert between schemes.
 *
 * **The neutral tone is `secondary`, and the spec says `primary`.**
 * `LinearProgressIndicatorTokens.ActiveIndicatorColor` is `Primary` over a
 * `SecondaryContainer` track, which separates cleanly in AOSP's own scheme because
 * primary is P40 there — dark ink on a tone-90 track. This app holds the brand pink
 * instead of a tone of it (T61 light / T54 dark, the one documented departure from
 * the tone map), and the cost lands exactly here: `primary` on `secondary-container`
 * measures **2.39:1 light / 2.41:1 dark**, under the 3:1 WCAG 1.4.11 asks of a
 * non-text graphic. The filled half of the bar and the empty half were not reliably
 * distinguishable — on a meter, that is the whole content.
 *
 * `secondary` is the substitution the focus ring already made for the same reason,
 * so it is this app's established answer rather than a new one, and it measures
 * **5.00:1 / 5.47:1** against the track. `primary` is removed rather than left
 * available, because a tone that exists gets reached for.
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

/* **There is no stop indicator, and `StopSize` is a divergence now.**
 *
 * It was a 4dp square at `right-0` in the fill's own colour, which the track's `rounded-full`
 * clipped into a nub — on any bar that cannot reach 100 that reads as a stray piece of the
 * fill floating a few pixels off the end of the real one, and the profile's XP bar is exactly
 * that (`experience % 100`, so 0–99, never 100). Two fixes were tried before removal: a round
 * dot concentric with the track's cap, and then that dot in the *track's* on-container
 * (`on-secondary-container`, which measures 13.32:1 light / 7.24:1 dark against the track,
 * against the fill colour's 5.00:1) with a hide above 98%. Both are defensible and both still
 * read as a detached mark on a meter that is mostly not full, which is what the report was
 * about.
 *
 * The M3 argument for keeping it is real and is worth writing down rather than losing: the dot
 * is *required* when the track's contrast against the container behind it falls under 3:1, and
 * here it does by a distance — `secondary-container` measures 1.23:1 light / 1.99:1 dark
 * against `surface` and **1.00:1** against `surface-container-highest`, i.e. on that tone step
 * the empty half of the track is invisible and nothing says where it ends. So this removal
 * costs something measurable, and the thing it costs is on the table if the empty track ever
 * needs to be locatable: the answer then is to give the *track* contrast, not to put a mark at
 * the end of an invisible one.
 *
 * `Slider` keeps its own stop indicator. That is not an inconsistency — a slider's dot marks
 * where a *draggable* value can go, and its track is 16dp with an 8dp cap, so a 4dp dot inset
 * on the inactive side reads as part of the track rather than as a fragment of the fill. */

/** Matches any width utility a call site might name, including a responsive one. */
const HAS_WIDTH = /(?:^|\s)(?:\S+:)?w-\S+/;

/**
 * The linear progress indicator, determinate and indeterminate.
 *
 * This existed as `LinearProgress` inside `Spinner.tsx` with **zero call sites**,
 * while six hand-rolled tracks carried seven fills across four files — three
 * heights (4/8/10px), three track tones, two drive mechanisms, one of them
 * missing its corner, and **not one `role="progressbar"`**, so no progress in the
 * app was announced at all, including the词库 sync that is the one place a user
 * has to wait.
 *
 * **Geometry is `LinearProgressIndicatorTokens` (v0_7_0).** `Height`,
 * `TrackThickness` and `ActiveThickness` are all 4dp, so `h-1` is the height and
 * there is no size axis: 8px and 10px were 2× and 2.5× the token, and 10 is not
 * even on the 4dp grid.
 *
 * `StopSize` is 4dp and is **not** implemented — the block above `TRACKS` records what was
 * tried, what M3 asks for, and what removing it costs.
 *
 * `TrackActiveSpace` (a 4dp gap between the indicator and the remaining track) is
 * deliberately **not** implemented. It needs the remaining track's leading edge to
 * follow the value, i.e. an animated *position*, which is the layout work `scaleX`
 * is here to avoid — and this bar runs live inside the image overlay while a hero
 * flight is landing. Worth revisiting if the gap is ever wanted more than the
 * pipeline.
 *
 * **Motion is a spring, not the loop curve.** All seven hand-rolled bars ran
 * `duration-200` on `--ease-symmetric`, which is the *loop* curve.
 * `ProgressIndicatorDefaults.ProgressAnimationSpec` is
 * `spring(dampingRatio = DampingRatioNoBouncy, stiffness = StiffnessVeryLow)` — a
 * critically damped spring, which is this app's *effects* family and the one that
 * cannot overshoot, and an overshooting progress bar reads as more than 100%.
 * AOSP's `StiffnessVeryLow` is 50, which at this app's normalised rate settles in
 * ~940ms; `spring-slow-effects` is the softest effects tier the scheme offers
 * (ζ1.0, 235ms), so what is borrowed is the family rather than the literal value.
 *
 * The fill is `scaleX` on a `transform-origin: left` box, not an animated `width`:
 * `width` puts every frame through layout and paint, and it is the property
 * `transition-ui` exists to have excluded.
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
        /* Same guard, and the same reason, as `Skeleton`'s conditional radius and
           `Badge`'s conditional `max-w`: `cn` is a plain join, so a call site naming its
           own width emitted that *and* `w-full`, leaving Tailwind's output order to
           pick. It picked `w-full` — which is how the profile banner's XP bar ended up
           100% of the banner wide while also inset 24px from its left edge, i.e. 24px
           of it clipped off the right end. A bar that fills its container is the right
           default and the only sensible one; a caller that has said otherwise has
           already answered the question. */
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
