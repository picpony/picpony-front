'use client';

import { useState, useEffect, memo, useRef } from 'react';
import Link from 'next/link';
import FadeInImage from './FadeInImage';
import ImageCardVideo from './ImageCardVideo';
import { MdThumbUp, MdComment, MdVisibility } from 'react-icons/md';
import { PonyImage } from '@/lib/api';
import { useHeroLink } from '@/lib/useHero';
import { ICON } from '@/lib/icons';
import Badge from './Badge';

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

  /* No `preventDefault`/`stopPropagation` any more: this button is a sibling of
     the link, not a child of it, so there is no navigation to suppress. */
  const handleReveal = () => setIsRevealed(true);

  const aspectW = image.width || 1;
  const aspectH = image.height || 1;
  const intrinsicH = Math.round(300 * (aspectH / aspectW));

  return (
    <div
      data-tab-row
      className="image-card relative w-full"
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
              alt={image.name || `图片 #${image.id}`}
              /* Fall back to the card's own aspect box rather than 0 — `0` is
                 not a valid next/image dimension, and the API omits width and
                 height on some records. */
              width={aspectW}
              height={aspectH}
              quality={82}
              className="w-full h-auto"
              sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, (min-width: 1536px) 304px, 25vw"
              /* 分层加载：加速代理→CDN→直连，失败自动降级（画廊缩略图） */
              resilient
              proxyThumb
            />
          )}
        </div>

        {/* Stay at the card slot; CSS fades when the sibling thumb is hero-locked. */}
        <div
          data-image-hero-chrome
          className="pointer-events-none absolute inset-0 z-2 rounded-lg"
          aria-hidden="true"
        >
          <div className="media-hover-scrim absolute inset-0 rounded-lg" />
          {/* `Badge tone="media"`, which owns the plate, the `on-media` ink, the blur,
              the 4dp corner and — since this pass — the glyph size. These three marks
              wrote all of that out by hand and dropped the blur, so a score over a pale
              photograph lost its plate; `Badge`'s own docstring names "a score pill over
              a gallery thumbnail" as the thing it replaced.

              The one corner that cannot come from the primitive is the one hugging the
              card's, because concentric means `outer - gap`: the card is 16dp and the
              inset is 8px, so that corner is **8dp** — which is `rounded-*-sm`, a step
              on the scale. It was written as `calc(--radius-lg - --spacing*2)`, which is
              the same arithmetic spelled as an arbitrary value; naming the step it
              resolves to is both shorter and checkable against the shape table. */}
          <Badge tone="media" className="absolute top-2 right-2 rounded-tr-sm">
            {format}
          </Badge>
          {/* No `title` on either count. This whole chrome layer is
              `pointer-events-none aria-hidden`, so a native tooltip could never be
              hovered and the name could never be read — two dead attributes. */}
          <Badge
            tone="media"
            icon={<MdThumbUp />}
            className="absolute bottom-2 left-2 rounded-bl-sm"
          >
            {image.score}
          </Badge>
          <Badge
            tone="media"
            icon={<MdComment />}
            className="absolute bottom-2 right-2 rounded-br-sm"
          >
            {image.comment_count}
          </Badge>
        </div>
      </Link>

      {/* The spoiler cover is a sibling of the link, not a child of it.
          Interactive content nested inside an `<a>` is invalid HTML, and it
          behaved exactly as invalid HTML does: the cover was a `<div onClick>`,
          so the only focusable thing on the card was the link — Tab landed on
          it, Enter navigated straight to the picture the cover exists to hide,
          and the reveal could not be reached from a keyboard at all. As a
          sibling it is a real `<button>` in its own right, in front of the link
          in both paint order and tab order.

          Kept mounted through the reveal so the cover can dissolve; it used to
          unmount on click, swapping a fully-opaque plate for the image in one
          frame — the one moment on this card where a transition carries
          information. `inert` (React 19) takes the faded remains out of the tab
          order and the accessibility tree together, which `aria-hidden` alone
          would not: that leaves a focusable element inside a hidden subtree.

          No `motion-reduce:` guard, and it is not an omission — one was here and
          it did nothing. The reduced-motion block re-declares `transition-property`
          with `!important`, which outranks `.motion-reduce\:transition-none`
          (Tailwind emits that without one), so the guard lost every time. It was
          also arguing against the paragraph above it: the dissolve is the one
          transition on this card that carries information, and the global rule
          already does the right thing here — it keeps `opacity` and drops
          `backdrop-filter`, so the cover fades without the blur animating. */}
      {isSpoilered && (
        <button
          type="button"
          onClick={handleReveal}
          inert={isRevealed}
          aria-label="显示被剧透标签遮住的图片"
          className={`absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center rounded-lg bg-media-plate backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-300 ease-[var(--ease-standard)] outline-none select-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset ${
            isRevealed ? 'pointer-events-none opacity-0 backdrop-blur-0' : 'opacity-100'
          }`}
        >
          <MdVisibility size={ICON.large} className="text-on-media mb-2" />
          <span className="text-on-media-variant text-label-l">点击查看</span>
        </button>
      )}
    </div>
  );
});
