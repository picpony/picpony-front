'use client';

import { memo } from 'react';
import { PonyImage } from '@/lib/api';
import { distributeToMasonryColumns } from '@/lib/utils';
import { useMasonryColumns } from '@/lib/hooks';
import { useStaggerGrid } from '@/lib/motion';
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
     measurements. Keyed on the id set and the column count so a page change or
     a breakpoint reflow replays it. */
  const gridRef = useStaggerGrid<HTMLDivElement>('.image-card', [
    columns,
    images.length,
    images[0]?.id,
  ]);

  return (
    <div ref={gridRef} className="flex items-start gap-2 sm:gap-4">
      {columnData.map((col, colIndex) => (
        <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
          {col.map((image) => (
            <ImageCard key={image.id} image={image} />
          ))}
        </div>
      ))}
    </div>
  );
});
