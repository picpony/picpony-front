'use client';

import { memo, useRef } from 'react';
import type { ImagePreview } from '@/lib/types/image';
import { distributeToMasonryColumns } from '@/lib/utils';
import { useMasonryColumns } from '@/lib/hooks';
import { StaggerGrid } from '@/lib/motionLazy';
import ImageCard from './ImageCard';

interface MasonryGridProps {
  images: ImagePreview[];
  /** A swapping tab pane already owns the entrance of its contents. */
  entrance?: boolean;
}

export default memo(function MasonryGrid({ images, entrance = true }: MasonryGridProps) {
  const columns = useMasonryColumns();
  const columnData = distributeToMasonryColumns(images, columns);

  /* Cards cascade in individually (one whole-grid fade read as a page redraw).
     Targets the existing `.image-card` root rather than adding a wrapper node —
     the hero flight measures a descendant of it, and an extra node perturbs
     those measurements. `deps` re-evaluates the hook's empty-grid check when
     rows land; it does not replay the cascade on a page turn or reflow —
     `useStaggerGridOn` latches once per mount. */
  const gridRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={gridRef} className="flex items-start gap-2 sm:gap-4">
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
            {col.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </div>
        ))}
      </div>
      {/* Renders nothing, and is a **sibling after** the grid rather than a child:
          React attaches a parent's ref only after its children's layout effects,
          so inside the div the hook's root was null on every mounting commit and
          the entrance silently never ran. The cascade lives behind a dynamic
          import, so the gallery chunk does not carry GSAP; with the engine absent
          the cards are simply there. */}
      {entrance && (
        <StaggerGrid
          gridRef={gridRef}
          selector=".image-card"
          deps={[columns, images.length, images[0]?.id]}
        />
      )}
    </>
  );
});
