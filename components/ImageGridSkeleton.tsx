'use client';

import { useMasonryColumns } from '@/lib/hooks';
import { cn, distributeToMasonryColumns } from '@/lib/utils';
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

/** The page size varies by list; column placement is the gallery's own algorithm. */
export default function ImageGridSkeleton({
  count = 50,
  entrance = true,
}: {
  count?: number;
  entrance?: boolean;
}) {
  const columns = useMasonryColumns();
  const columnData = distributeToMasonryColumns(
    Array.from({ length: count }, (_, id) => ({ id, width: 1, height: RATIOS[id % RATIOS.length] })),
    columns,
  );

  return (
    <div className={cn('flex items-start gap-2 sm:gap-4', entrance && 'animate-fade-in')} aria-hidden="true">
      {columnData.map((items, colIndex) => (
        <div key={colIndex} className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-4">
          {items.map((item, rowIndex) => {
            return (
              <Skeleton
                key={item.id}
                className="w-full rounded-lg"
                style={{
                  aspectRatio: `1 / ${item.height}`,
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
