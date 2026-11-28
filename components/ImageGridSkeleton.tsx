'use client';

import { useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  clampedCardAspect,
  MASONRY_CARD_SIZES,
  MASONRY_MAX_RATIO,
  masonryLayout,
  noteSkeletonReplaced,
} from '@/lib/masonry';
import type { FolderSeedCover } from '@/lib/folderTransit';
import FadeInImage from '@/components/FadeInImage';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';

/**
 * Placeholder for a masonry image collection before its item list arrives.
 *
 * Because the result count and each picture's aspect ratio are unknown until the list responds,
 * this never fabricates guessed masonry tiles that jump once data lands. It shows a single
 * centred large M3E loading indicator (`PageLoadingIndicator`) while holding the page footer back
 * (`data-page-loading`); once the API confirms the structure, `MasonryGrid` decomposes into the
 * real cards in their exact final positions and sizes (inheriting the active shared morph clock).
 *
 * The one known-geometry exception is a cold folder open carrying `seedCover` from a pressed
 * folder card: slot #0's exact picture and aspect ratio are already known, so that single cover
 * renders in place for the container-transform handoff alongside the centred indicator below.
 */
export default function ImageGridSkeleton({
  entrance = true,
  paused = false,
  seedCover,
}: {
  /** Retained for caller compatibility; unknown-structure grids render one centred indicator. */
  count?: number;
  entrance?: boolean;
  /** Pause the indicator while held invisible during a warm-cache deferral. */
  paused?: boolean;
  /** Known cover for slot #0 (carried from a pressed folder card) so a cold folder open lands on
      its exact aspect ratio and keeps the picture painted until the real grid arrives. */
  seedCover?: FolderSeedCover;
}) {
  const seedW = seedCover ? seedCover.width || 1 : 1;
  const seedH = seedCover ? seedCover.height || 1 : 1;
  const seedRatio = seedCover ? clampedCardAspect(seedW, seedH) : null;
  const seedCroppedTall = seedCover ? seedH / seedW > MASONRY_MAX_RATIO : false;
  const seedLayout = useMemo(
    () => (seedRatio !== null ? masonryLayout([{ width: 1, height: seedRatio }]) : null),
    [seedRatio],
  );

  /* Reported on the way out so the decomposing `MasonryGrid` mounting in the same commit appears
     at once and hands off cleanly on the active shared M3E morph clock. */
  useLayoutEffect(() => () => noteSkeletonReplaced(), []);

  if (seedCover && seedRatio !== null && seedLayout) {
    return (
      <div
        data-page-loading=""
        data-grid-loading=""
        className={cn('space-y-6', entrance && 'animate-fade-in')}
      >
        <div className="masonry" aria-hidden="true">
          <div className="masonry-grid" style={seedLayout.grid as CSSProperties}>
            <div className="masonry-item" style={seedLayout.items[0] as CSSProperties}>
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
                  className={
                    seedCroppedTall ? 'size-full object-cover object-top' : 'size-full object-cover'
                  }
                />
              </div>
            </div>
          </div>
        </div>
        <PageLoadingIndicator
          size="inline"
          indicatorSize="lg"
          paused={paused}
          label="正在加载图片…"
        />
      </div>
    );
  }

  return (
    <PageLoadingIndicator
      size="pane"
      indicatorSize="lg"
      holdFooter
      paused={paused}
      label="正在加载图片…"
      data-grid-loading=""
      className={cn(entrance && 'animate-fade-in')}
    />
  );
}
