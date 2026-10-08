'use client';

import { useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { masonryLayout, noteSkeletonReplaced } from '@/lib/masonry';
import Skeleton from '@/components/Skeleton';

/**
 * Fixed aspect-ratio sequence (height over width), not random values, so server and client render
 * the same thing and the placeholder fills a real page's depth. **Its mean is a real page's**:
 * 0.93 over 250 recent and top-scored safe uploads (derpibooru, 2026-09). It was 1.17 — a quarter
 * taller — so a grid shrank by a quarter of its length the moment its pictures replaced it.
 */
const RATIOS = [
  1.06, 0.62, 1.2, 0.8, 0.94, 0.58, 1.13, 0.76, 1, 1.3, 0.67, 0.88, 1.1, 0.72, 1.24, 0.84, 0.64,
  1.02, 0.9, 1.17, 0.7, 1.08, 0.82, 1.26,
];

/**
 * The grid's placeholder, placed by the grid's own rule (`lib/masonry.ts`) and the same CSS —
 * so it has the right column count in the server's HTML too. It used to share the grid's
 * script-chosen count and painted four columns on every phone until hydration.
 *
 * `data-page-loading` holds the page footer back while this is up (see the page-chrome rules
 * in globals.css): under a placeholder shorter than the viewport the footer was painted at the
 * bottom of the screen and thrown off it when the content landed.
 *
 * The page size varies by list; pass the request's own.
 */
export default function ImageGridSkeleton({
  count = 50,
  entrance = true,
}: {
  count?: number;
  entrance?: boolean;
}) {
  const layout = useMemo(
    () =>
      masonryLayout(
        Array.from({ length: count }, (_, id) => ({ width: 1, height: RATIOS[id % RATIOS.length] })),
      ),
    [count],
  );

  /* Reported on the way out, so the grid mounting in the same commit knows it is taking over
     from a placeholder that was already saying "arriving" — and skips its own entrance. */
  useLayoutEffect(() => () => noteSkeletonReplaced(), []);

  return (
    <div
      data-page-loading
      className={cn('masonry', entrance && 'animate-fade-in')}
      aria-hidden="true"
    >
      <div className="masonry-grid" style={layout.grid as CSSProperties}>
        {layout.items.map((placement, index) => (
          /* The slot is its own box, as it is for a card: the placeholder's own class positions
             it relatively for the sweep, and the slot must be the absolutely placed one. */
          <div key={index} className="masonry-item" style={placement as CSSProperties}>
            <Skeleton
              className="w-full rounded-lg"
              style={{
                aspectRatio: `1 / ${RATIOS[index % RATIOS.length]}`,
                /* Diagonal stagger so the shimmer sweeps the grid as one wave; capped — a slow
                   tail reads as broken, not loading. Column and row come from the phone
                   layout, the one where the eye takes the grid in as a single wave. */
                animationDelay: `${Math.min(
                  (Number(placement['--mc2']) + Number(placement['--mk2'])) * 90,
                  900,
                )}ms`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
