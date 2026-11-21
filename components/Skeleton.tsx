'use client';

import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  className?: string;
  /** Stagger the shimmer sweep across a group, in ms. */
  delay?: number;
  style?: CSSProperties;
  /** Overlay keeps retained content visible beneath the shared shimmer. */
  variant?: 'surface' | 'overlay';
}

/**
 * The single loading placeholder; `.skeleton` (globals.css) owns the sweep and
 * reads `animation-delay: inherit`, which is what lets `delay` stagger a group.
 *
 * **Radius and background overrides are conditional.** `cn` is a plain join that
 * does not resolve Tailwind conflicts, so detecting unconditional `rounded*` or
 * `bg-*` classes avoids emitting competing defaults while keeping responsive or
 * state-prefixed classes backed by the base tokens.
 */
const HAS_RADIUS = /(?:^|\s)rounded(?:-\S+)?/;
const HAS_BG = /(?:^|\s)bg-\S+/;

export default function Skeleton({ className = '', delay, style, variant = 'surface', ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'skeleton',
        variant === 'surface' && !HAS_BG.test(className) && 'bg-surface-container-high',
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
