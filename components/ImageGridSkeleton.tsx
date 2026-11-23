'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  clampedCardAspect,
  MASONRY_CARD_SIZES,
  MASONRY_MAX_RATIO,
  masonryLayout,
  noteSkeletonReplaced,
} from '@/lib/masonry';
import type { FolderSeedCover } from '@/lib/folderTransit';
import { getAppScroller } from '@/lib/appScroller';
import FadeInImage from '@/components/FadeInImage';
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

const PAUSED_SWEEP = 'after:[animation-play-state:paused]';

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
  seedCover,
}: {
  count?: number;
  entrance?: boolean;
  /** Known cover for slot #0 (carried from a pressed folder card) so a cold folder open lands on
      its exact aspect ratio and keeps the picture painted until the real grid arrives. */
  seedCover?: FolderSeedCover;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const seedW = seedCover ? seedCover.width || 1 : 1;
  const seedH = seedCover ? seedCover.height || 1 : 1;
  const seedRatio = seedCover ? clampedCardAspect(seedW, seedH) : null;
  const seedCroppedTall = seedCover ? seedH / seedW > MASONRY_MAX_RATIO : false;
  const layout = useMemo(
    () =>
      masonryLayout(
        Array.from({ length: count }, (_, id) => ({
          width: 1,
          height: id === 0 && seedRatio !== null ? seedRatio : RATIOS[id % RATIOS.length],
        })),
      ),
    [count, seedRatio],
  );

  /* Reported on the way out, so the grid mounting in the same commit knows it is taking over
     from a placeholder that was already saying "arriving" — and skips its own entrance. */
  useLayoutEffect(() => () => noteSkeletonReplaced(), []);

  /* One observer for the whole loading page. Off-screen sweeps cannot be composited and
     otherwise restyle dozens of tiles per frame; the quiet placeholder keeps its exact
     geometry and colour. No observer support means the same static placeholders. */
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle(PAUSED_SWEEP, !entry.isIntersecting);
    }, {
      root: grid.closest('[data-app-scroll-container]') ?? getAppScroller(),
      rootMargin: '240px 0px',
    });
    for (const placeholder of grid.querySelectorAll('[data-grid-placeholder]')) observer.observe(placeholder);
    return () => observer.disconnect();
  }, [layout]);

  return (
    <div
      data-page-loading
      className={cn('masonry', entrance && 'animate-fade-in')}
      aria-hidden="true"
    >
      <div ref={gridRef} className="masonry-grid" style={layout.grid as CSSProperties}>
        {layout.items.map((placement, index) => (
          /* The slot is its own box, as it is for a card: the placeholder's own class positions
             it relatively for the sweep, and the slot must be the absolutely placed one. */
          <div key={index} className="masonry-item" style={placement as CSSProperties}>
            {index === 0 && seedCover && seedRatio !== null ? (
              <div
                data-folder-seed-cover={seedCover.id}
                className="relative w-full overflow-hidden rounded-lg bg-surface-container-high"
                style={{ aspectRatio: `1 / ${seedRatio}` }}
              >
                <FadeInImage
                  src={seedCover.src}
                  alt=""
                  width={seedW}
                  height={seedH}
                  quality={82}
                  sizes={MASONRY_CARD_SIZES}
                  unoptimized={Boolean(seedCover.animated)}
                  proxyThumb
                  eager
                  shimmer={false}
                  className={seedCroppedTall ? 'size-full object-cover object-top' : 'size-full object-cover'}
                />
              </div>
            ) : (
              <Skeleton
                data-grid-placeholder
                className={cn('w-full rounded-lg', PAUSED_SWEEP)}
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
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
