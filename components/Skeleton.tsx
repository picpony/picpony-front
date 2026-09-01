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
 * The single loading placeholder; `.skeleton` (globals.css) owns the sweep and
 * reads `animation-delay: inherit`, which is what lets `delay` stagger a group.
 *
 * **The radius is conditional — a deliberate divergence, do not fix.** `cn` is a
 * plain join that does not resolve Tailwind conflicts, so a call site passing its
 * own radius emitted both it and the default, leaving the winner to stylesheet
 * order. The placeholder's radius is the one token that legitimately inherits
 * from the thing it stands in for, so detecting the override and standing down
 * is worth the guard.
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

/* Former `SkeletonRow`/`SkeletonRows` (table-row placeholders) removed: no
   table remains in the app for them to stand in for — `DataTable` owns its own
   loading state and the admin fallback builds its row shape inline. */
