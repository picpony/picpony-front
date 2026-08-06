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
        ? values
            .filter((value): value is string => typeof value === 'string')
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
  const mediaUrl =
    image.representations?.small ||
    image.representations?.thumb ||
    image.representations?.thumb_small ||
    image.representations?.thumb_tiny ||
    fullUrl;
  const format = (
    image.format ||
    fullUrl.split(/[?#]/)[0].split('.').pop() ||
    'UNKNOWN'
  ).toUpperCase();
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
    setIsSpoilered((current) => (current === next ? current : next));
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
      data-tab-row
      className="image-card w-full"
      style={{ containIntrinsicSize: `auto ${intrinsicH}px` }}
    >
      <Link
        {...heroLinkProps}
        className="image-hero-card-link block relative rounded-lg group bg-surface-container-high w-full text-left cursor-pointer"
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
              /* Fall back to the card's own aspect box rather than 0 — `0` is
                 not a valid next/image dimension, and the API omits width and
                 height on some records. */
              width={aspectW}
              height={aspectH}
              quality={82}
              className="w-full h-auto"
              sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, (min-width: 1536px) 304px, 25vw"
            />
          )}

          {/* Kept mounted through the reveal so the scrim can dissolve. It used
              to unmount on click, which swapped a fully-opaque cover for the
              image in a single frame — the one moment on the card where a
              transition actually carries information. */}
          {isSpoilered && (
            <div
              className={`absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center bg-scrim/55 backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-300 ease-[var(--ease-standard)] select-none motion-reduce:transition-none ${
                isRevealed ? 'pointer-events-none opacity-0 backdrop-blur-0' : 'opacity-100'
              }`}
              aria-hidden={isRevealed}
              onClick={handleReveal}
            >
              <MdVisibility size={36} className="text-on-media mb-2 opacity-80" />
              <span className="text-on-media text-label-l opacity-80">点击查看</span>
            </div>
          )}
        </div>

        {/* Stay at the card slot; CSS fades when the sibling thumb is hero-locked. */}
        <div
          data-image-hero-chrome
          className="pointer-events-none absolute inset-0 z-[2] rounded-lg"
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-lg bg-scrim/0 transition-ui group-hover:bg-scrim/10" />
          <div className="absolute top-2 right-2 rounded bg-scrim/55 px-2 py-1 text-label-m text-on-media">
            {format}
          </div>
          <div
            title="点赞数"
            className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-scrim/55 px-2 py-1 text-label-m text-on-media"
          >
            <MdThumbUp size={12} />
            <span>{image.score}</span>
          </div>
          <div
            title="评论数"
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-scrim/55 px-2 py-1 text-label-m text-on-media"
          >
            <MdComment size={12} />
            <span>{image.comment_count}</span>
          </div>
        </div>
      </Link>
    </div>
  );
});
