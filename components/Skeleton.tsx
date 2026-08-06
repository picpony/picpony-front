'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
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
 */
export default function Skeleton({ className = '', delay, style }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton rounded-sm bg-surface-container-high', className)}
      style={delay ? { animationDelay: `${delay}ms`, ...style } : style}
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

/**
 * Table-row placeholder. Admin tables rendered `{loading ? <Spinner/> : rows}`,
 * which collapsed the table to zero height and then snapped it back — this
 * holds the layout while the request is in flight.
 */
export function SkeletonRow({
  cols,
  className = '',
  delay = 0,
}: {
  cols: number;
  className?: string;
  delay?: number;
}) {
  return (
    <tr className={className}>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton delay={delay + i * 60} className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

/** A block of table-row placeholders. */
export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} cols={cols} delay={i * 70} />
      ))}
    </>
  );
}
