'use client';

import { useMasonryColumns } from '@/lib/hooks';

/**
 * Aspect ratios, not pixel heights, and a fixed sequence rather than random
 * values so the server and client render the same thing.
 *
 * The old version hard-coded three tiles per column at 200–380px, so the
 * placeholder was roughly 900px tall while a real page is 50 images deep. The
 * skeleton ended well above the fold, leaving empty space under it, and the
 * page then grew abruptly when the data arrived.
 *
 * The spread is deliberately portrait-heavy: this is fan art, and most of it is
 * taller than it is wide, so a skeleton of squares does not predict the layout.
 */
const RATIOS = [
  1.32, 0.78, 1.5, 1.0, 1.18, 0.72, 1.41, 0.95, 1.25, 1.62, 0.84, 1.1, 1.38, 0.9, 1.55, 1.05, 0.8,
  1.28, 1.12, 1.46, 0.88, 1.35, 1.02, 1.58,
];

/**
 * Rows per column, derived rather than guessed.
 *
 * A page is `PAGE_SIZE` images spread over `columns`, so that — not a fixed 7 —
 * is how deep the placeholder has to run. At 7 the skeleton came out roughly a
 * third of the real height, so the scroll container jumped sharply the moment
 * the data arrived, which is the exact problem this file's header comment says
 * it was written to solve. It under-corrected by 3×.
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
              <div
                key={rowIndex}
                className="skeleton bg-surface-container-high w-full rounded-lg"
                style={{
                  aspectRatio: `1 / ${ratio}`,
                  /* Diagonal stagger, so the shimmer sweeps across the grid as
                     one wave rather than every tile flashing together. Capped:
                     past a second the tail tiles read as broken rather than
                     loading, and they are all below the fold anyway. */
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
