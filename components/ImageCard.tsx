'use client';

import { useState, useEffect, memo, useRef } from 'react';
import Link from 'next/link';
import FadeInImage from './FadeInImage';
import ImageCardVideo from './ImageCardVideo';
import { MdThumbUp, MdComment, MdVisibility } from 'react-icons/md';
import { PonyImage } from '@/lib/api';
import { useHeroLink } from '@/lib/useHero';

interface ImageCardProps {
  image: PonyImage;
}

export default memo(function ImageCard({ image }: ImageCardProps) {
  const heroElementRef = useRef<HTMLDivElement>(null);
  const fullUrl = image.representations?.full || image.view_url || '';
  const thumbUrl =
    image.representations?.medium ||
    image.representations?.small ||
    image.representations?.thumb ||
    image.representations?.thumb_small ||
    image.representations?.thumb_tiny ||
    image.representations?.full ||
    image.view_url ||
    '';
  const mediaUrl = image.representations?.small ||
    image.representations?.thumb ||
    image.representations?.thumb_small ||
    image.representations?.thumb_tiny ||
    fullUrl;
  const format = (image.format || fullUrl.split(/[?#]/)[0].split('.').pop() || 'UNKNOWN').toUpperCase();
  const isWebm = format === 'WEBM' || format === 'MP4';

  const [isSpoilered, setIsSpoilered] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const { sourceKey: heroSourceKey, warmFrame, ...heroLinkProps } = useHeroLink({
    image,
    sourceRef: heroElementRef,
    previewSrc: isWebm ? mediaUrl : thumbUrl,
    canAnimate: !isSpoilered || isRevealed,
    kind: 'card',
  });

  useEffect(() => {
    try {
      const spoileredTags: string[] = JSON.parse(localStorage.getItem('trixie_active_spoilered_tags') || '[]');
      if (spoileredTags.length > 0) {
        const imgTags = (image.tags || []).map(t => t.trim().toLowerCase());
        const matched = spoileredTags.some(st => imgTags.includes(st.trim().toLowerCase()));
        setIsSpoilered(matched);
      }
    } catch { /* ignore */ }
  }, [image.tags]);

  const handleReveal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRevealed(true);
  };

  return (
    <div className="w-full">
      <Link
        {...heroLinkProps}
        className="block relative rounded-lg overflow-hidden group bg-slate-100 dark:bg-slate-800 w-full text-left cursor-pointer"
      >
        <div
          ref={heroElementRef}
          data-image-hero-role="thumbnail"
          data-image-hero-id={image.id}
          data-image-hero-source-key={heroSourceKey}
          className="relative w-full overflow-hidden rounded-lg"
          style={{ aspectRatio: `${image.width || 1} / ${image.height || 1}` }}
        >
          {isWebm ? (
            <div
              className="relative w-full overflow-hidden"
              style={{ paddingBottom: `${((image.height || 1) / (image.width || 1)) * 100}%` }}
            >
              <ImageCardVideo src={mediaUrl} onLoadedData={warmFrame} />
            </div>
          ) : (
            <FadeInImage
              src={thumbUrl}
              alt={image.name || `Image ${image.id}`}
              width={image.width || 0}
              height={image.height || 0}
              quality={88}
              onLoad={warmFrame}
              className="w-full h-auto object-cover transition-all duration-500"
              sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, (min-width: 1536px) 304px, 25vw"
            />
          )}

          {isSpoilered && !isRevealed && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer select-none"
              style={{ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', background: 'rgba(0,0,0,0.3)' }}
              onClick={handleReveal}
            >
              <MdVisibility size={36} className="text-white mb-2 opacity-80" />
              <span className="text-white text-sm font-medium opacity-80">点击查看</span>
            </div>
          )}
        </div>

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 pointer-events-none" />
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm pointer-events-none">
          {format}
        </div>
        <div title="点赞数" className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1 pointer-events-none">
          <MdThumbUp size={12} />
          <span>{image.score}</span>
        </div>
        <div title="评论数" className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs font-medium rounded backdrop-blur-sm flex items-center gap-1 pointer-events-none">
          <MdComment size={12} />
          <span>{image.comment_count}</span>
        </div>
      </Link>
    </div>
  );
});
