'use client';

import { useMasonryColumns } from '@/lib/hooks';
import Skeleton from '@/components/Skeleton';

/**
 * Fixed aspect-ratio sequence (deliberately portrait-heavy — this is fan art),
 * not random values, so server and client render the same thing and the
 * placeholder fills a real page's depth instead of ending above the fold.
 */
const RATIOS = [
  1.32, 0.78, 1.5, 1.0, 1.18, 0.72, 1.41, 0.95, 1.25, 1.62, 0.84, 1.1, 1.38, 0.9, 1.55, 1.05, 0.8,
  1.28, 1.12, 1.46, 0.88, 1.35, 1.02, 1.58,
];

/**
 * Rows per column = a real page (`PAGE_SIZE` images) over `columns`, so the
 * placeholder's height tracks the content it stands in for.
 */
const PAGE_SIZE = 50;

export default function ImageGridSkeleton() {
  const columns = useMasonryColumns();
  const rows = Math.ceil(PAGE_SIZE / columns);

  return (
    <div className="flex animate-fade-in items-start gap-2 sm:gap-4" aria-hidden="true">
      {Array.from({ length: columns }, (_, colIndex) => (
        <div key={colIndex} className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-4">
          {Array.from({ length: rows }, (_, rowIndex) => {
            const ratio = RATIOS[(colIndex * rows + rowIndex) % RATIOS.length];
            return (
              <Skeleton
                key={rowIndex}
                className="w-full rounded-lg"
                style={{
                  aspectRatio: `1 / ${ratio}`,
                  /* Diagonal stagger so the shimmer sweeps the grid as one wave;
                     capped — a slow tail reads as broken, not loading. */
                  animationDelay: `${Math.min((colIndex + rowIndex) * 90, 900)}ms`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
