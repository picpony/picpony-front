'use client';

import Link from 'next/link';
import FadeInImage from './FadeInImage';
import Tooltip from '@mui/material/Tooltip';
import { MdThumbUp, MdComment } from 'react-icons/md';
import { PonyImage } from '@/lib/api';

interface ImageCardProps {
  image: PonyImage;
}

export default function ImageCard({ image }: ImageCardProps) {
  const fullUrl = image.representations?.full || image.view_url || '';
  const thumbUrl = image.representations?.thumb || image.representations?.full || image.view_url || '';
  const isWebm = fullUrl.endsWith('.webm');
  const format = fullUrl.split('.').pop()?.toUpperCase() || 'UNKNOWN';

  return (
    <div className="w-full">
      <Link
        href={`/pic/${image.id}`}
        className="block relative rounded-lg overflow-hidden group bg-slate-100 dark:bg-slate-800 w-full text-left cursor-pointer"
      >
        {isWebm ? (
          <div
            className="relative w-full overflow-hidden"
            style={{ paddingBottom: `${((image.height || 1) / (image.width || 1)) * 100}%` }}
          >
            <video
              src={`${fullUrl}#t=0.1`}
              preload="metadata"
              className="absolute top-0 left-0 w-full h-full object-cover transition-all duration-500"
            />
          </div>
        ) : (
          <FadeInImage
            src={thumbUrl}
            alt={image.name || `Image ${image.id}`}
            width={image.width || 0}
            height={image.height || 0}
            className="w-full h-auto object-cover transition-all duration-500"
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none">
          {format}
        </div>
        <Tooltip title="点赞数" placement="top" arrow>
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
            <MdThumbUp size={12} />
            <span>{image.score}</span>
          </div>
        </Tooltip>
        <Tooltip title="评论数" placement="top" arrow>
          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1">
            <MdComment size={12} />
            <span>{image.comment_count}</span>
          </div>
        </Tooltip>
      </Link>
    </div>
  );
}
