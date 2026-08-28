'use client';

import { memo, useRef } from 'react';
import { PonyImage } from '@/lib/api';
import { distributeToMasonryColumns } from '@/lib/utils';
import { useMasonryColumns } from '@/lib/hooks';
import { StaggerGrid } from '@/lib/motionLazy';
import ImageCard from './ImageCard';

interface MasonryGridProps {
  images: PonyImage[];
}

export default memo(function MasonryGrid({ images }: MasonryGridProps) {
  const columns = useMasonryColumns();
  const columnData = distributeToMasonryColumns(images, columns);

  /* Cards cascade in individually. The whole grid used to carry one
     `animate-fade-in`, so forty images arrived as a single rectangle fading up
     — which reads as a page redraw rather than as content arriving.

     Targets the existing `.image-card` root rather than a wrapper element: the
     hero flight measures a descendant of it, and adding a node between the
     column and the card is exactly the kind of change that perturbs those
     measurements. `deps` carries the id set and the column count so the hook's own
     empty-grid check re-evaluates when rows land — it does **not** replay the cascade on a
     page turn or a reflow; see `useStaggerGridOn`, which latches once per mount because a
     page turn starts with the viewport at the bottom of the grid, where the cascade order
     puts the cards last. */
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
      {/* Renders nothing, and it is a **sibling after** the grid rather than a child of it.
          React attaches a parent's ref only after its children's layout effects run, so inside
          the div this read `gridRef.current === null` on every commit that mounted the two
          together — silently skipping the entrance on load and leaving a page turn as the first
          pass that ever found a root. See `useStaggerGridOn`.

          The cascade lives behind a dynamic import, so the gallery's chunk does not carry GSAP;
          with the engine absent the cards are simply there, which is what 入场动画 off gives. */}
      <StaggerGrid
        gridRef={gridRef}
        selector=".image-card"
        deps={[columns, images.length, images[0]?.id]}
      />
    </>
  );
});
