'use client';

import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  className?: string;
  /** Stagger the shimmer sweep across a group, in ms. */
  delay?: number;
  style?: CSSProperties;
}

/**
 * The single loading placeholder.
 *
 * The app shipped two loading languages side by side: a `.skeleton` shimmer
 * sweep (5 sites) and Tailwind's `animate-pulse` opacity throb (18 sites), so
 * two lists loading next to each other pulsed differently. Everything routes
 * through here now.
 *
 * `.skeleton` (app/globals.css) owns the sweep itself and reads
 * `animation-delay: inherit`, which is what lets `delay` stagger a group.
 *
 * The radius is *conditional*, which looks like a trick and is a correctness
 * fix. `cn` is a plain join — it deliberately does not resolve Tailwind
 * conflicts — so a call site passing its own `rounded-full` emitted **both**
 * that and the default `rounded-sm`, and which one applied came down to
 * Tailwind's emission order rather than to what the caller asked for. 47 of the
 * ~60 call sites pass a radius, including every circular avatar and every
 * `aspect-square` tile, so this was not a corner case: the placeholder for a
 * round avatar was one stylesheet reordering away from being a rounded square.
 * Detecting the override and standing down is the one place a guard like this is
 * worth it, because the radius is the only token a placeholder legitimately has
 * to inherit from the thing it stands in for.
 */
const HAS_RADIUS = /(?:^|\s)(?:rounded|rounded-(?:none|xs|sm|md|lg|xl|2xl|3xl|full))(?:\s|$)/;

export default function Skeleton({ className = '', delay, style, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'skeleton bg-surface-container-high',
        !HAS_RADIUS.test(className) && 'rounded-sm',
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms`, ...style } : style}
      {...rest}
    />
  );
}

/** Paragraph placeholder. The last line is short so it reads as prose. */
export function SkeletonText({
  lines = 3,
  className = '',
  delay = 0,
}: {
  lines?: number;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          delay={delay + i * 90}
          className={cn('h-3.5', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

export function SkeletonCircle({
  size = 40,
  className = '',
  delay = 0,
}: {
  size?: number;
  className?: string;
  delay?: number;
}) {
  return (
    <Skeleton
      delay={delay}
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size }}
    />
  );
}

/* There were `SkeletonRow` / `SkeletonRows` here, emitting `<tr>` and `<td>`.
   They date from when `DataTable` was a real `<table>`; it is a `.m3-row`
   grouped list of divs now, and the only remaining caller — the admin console's
   lazy-tab fallback — was dropping bare table rows into a plain `<div>`. React
   does not discard those the way an HTML parser would, so the UA stylesheet
   wrapped them in an anonymous table box and the fallback showed a five-column
   grid in front of a list that has no columns. A table-row placeholder now has
   nothing in the app to stand in for; `DataTable` owns its own loading state and
   the admin fallback builds the same `.m3-row` shape inline. */
