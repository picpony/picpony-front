'use client';

import { PonyImage } from '@/lib/api';
import { distributeToMasonryColumns } from '@/lib/utils';
import { useMasonryColumns } from '@/lib/hooks';
import ImageCard from './ImageCard';

interface MasonryGridProps {
  images: PonyImage[];
}

export default function MasonryGrid({ images }: MasonryGridProps) {
  const columns = useMasonryColumns();
  const columnData = distributeToMasonryColumns(images, columns);

  return (
    <div className="flex gap-2 sm:gap-4 animate-fade-in items-start">
      {columnData.map((col, colIndex) => (
        <div key={colIndex} className="flex flex-col gap-2 sm:gap-4 flex-1 min-w-0">
          {col.map((image) => (
            <ImageCard key={image.id} image={image} />
          ))}
        </div>
      ))}
    </div>
  );
}
