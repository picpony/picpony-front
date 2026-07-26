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

let spoilerTagsRaw: string | null = null;
let spoilerTags = new Set<string>();

function getActiveSpoilerTags() {
  if (typeof window === 'undefined') return spoilerTags;
  try {
    const nextRaw = localStorage.getItem('trixie_active_spoilered_tags') || '[]';
    if (nextRaw === spoilerTagsRaw) return spoilerTags;
    spoilerTagsRaw = nextRaw;
    const values: unknown = JSON.parse(nextRaw);
    spoilerTags = new Set(
      Array.isArray(values)
        ? values.filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
        : [],
    );
  } catch {
    spoilerTagsRaw = null;
    spoilerTags = new Set();
  }
  return spoilerTags;
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
  const { sourceKey: heroSourceKey, ...heroLinkProps } = useHeroLink({
    image,
    sourceRef: heroElementRef,
    previewSrc: isWebm ? mediaUrl : thumbUrl,
    canAnimate: !isSpoilered || isRevealed,
    kind: 'card',
  });

  useEffect(() => {
    const activeTags = getActiveSpoilerTags();
    const next = (image.tags || []).some((tag) => activeTags.has(tag.trim().toLowerCase()));
    setIsSpoilered((current) => current === next ? current : next);
  }, [image.tags]);

  const handleReveal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRevealed(true);
  };

  const aspectW = image.width || 1;
  const aspectH = image.height || 1;
  const intrinsicH = Math.round(300 * (aspectH / aspectW));

  return (
    <div
      className="image-card w-full"
      style={{ containIntrinsicSize: `auto ${intrinsicH}px` }}
    >
      <Link
        {...heroLinkProps}
        className="image-hero-card-link block relative rounded-lg group bg-slate-100 dark:bg-slate-800 w-full text-left cursor-pointer"
      >
        {/* Media only — hero hides this node while the flyer flies. */}
        <div
          ref={heroElementRef}
          data-image-hero-role="thumbnail"
          data-image-hero-id={image.id}
          data-image-hero-source-key={heroSourceKey}
          className="relative w-full overflow-hidden rounded-lg"
          style={{ aspectRatio: `${aspectW} / ${aspectH}` }}
        >
          {isWebm ? (
            <div
              className="relative w-full overflow-hidden"
              style={{ paddingBottom: `${((image.height || 1) / (image.width || 1)) * 100}%` }}
            >
              <ImageCardVideo src={mediaUrl} />
            </div>
          ) : (
            <FadeInImage
              src={thumbUrl}
              alt={image.name || `Image ${image.id}`}
              width={image.width || 0}
              height={image.height || 0}
              quality={82}
              className="w-full h-auto object-cover"
              sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, (min-width: 1536px) 304px, 25vw"
            />
          )}

          {isSpoilered && !isRevealed && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer select-none bg-black/55"
              onClick={handleReveal}
            >
              <MdVisibility size={36} className="text-white mb-2 opacity-80" />
              <span className="text-white text-sm font-medium opacity-80">点击查看</span>
            </div>
          )}
        </div>

        {/* Stay at the card slot; CSS fades when the sibling thumb is hero-locked. */}
        <div
          data-image-hero-chrome
          className="pointer-events-none absolute inset-0 z-[2] rounded-lg"
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-lg bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
          <div className="absolute top-2 right-2 rounded bg-black/55 px-2 py-1 text-xs font-medium text-white">
            {format}
          </div>
          <div
            title="点赞数"
            className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-xs font-medium text-white"
          >
            <MdThumbUp size={12} />
            <span>{image.score}</span>
          </div>
          <div
            title="评论数"
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/55 px-2 py-1 text-xs font-medium text-white"
          >
            <MdComment size={12} />
            <span>{image.comment_count}</span>
          </div>
        </div>
      </Link>
    </div>
  );
});
