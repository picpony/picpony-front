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
import { useSsrSpoilerTags } from './ImageLineProvider';
import { COOKIE_KEYS, LS_KEYS } from '@/lib/constants';

interface ImageCardProps {
  image: PonyImage;
}

let spoilerTagsRaw: string | null = null;
let spoilerTags = new Set<string>();

function getActiveSpoilerTags() {
  if (typeof window === 'undefined') return spoilerTags;
  try {
    const nextRaw = localStorage.getItem(LS_KEYS.spoilerTags) || '[]';
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
     /* Mirrored to a cookie for the *next* document, so the server can draw the
        cover before hydration. Written here because this is the one place that
        already parses the list. */
    try {
      const joined = [...spoilerTags].join(',');
      document.cookie = `${COOKIE_KEYS.spoilerTags}=${encodeURIComponent(joined)};path=/;max-age=${
        60 * 60 * 24 * 365
      };samesite=lax`;
    } catch {
      /* Cookies blocked. The effect still covers the card; only the first frame is exposed. */
    }
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

  /* **Covered from the very first render when the server knew to cover it.**
     The server emits `<img>` tags the browser paints before any effect runs, so
     a user who spoilered a tag saw exactly the pictures they asked to hide on
     every cold load. The cookie carries the list so this render can ask the
     same question the effect will; the effect still runs and still wins, so a
     stale or absent cookie costs one frame rather than a wrong answer. */
  const ssrSpoilerTags = useSsrSpoilerTags();
  const [isSpoilered, setIsSpoilered] = useState(() =>
    ssrSpoilerTags.length === 0
      ? false
      : (image.tags || []).some((tag) => ssrSpoilerTags.includes(tag.trim().toLowerCase())),
  );
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
          {/* `Badge tone="media"`, which owns the plate, the `on-media` ink,
              the blur, the 4dp corner and the glyph size — these three marks
              wrote all of that out by hand and dropped the blur, so a score
              over a pale photograph lost its plate.

              The one corner that cannot come from the primitive is the one
              hugging the card's: concentric means `outer - gap`, so at a 16dp
              card corner with an 8px inset that corner is 8dp. */}
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

      {/* The spoiler cover is a sibling of the link, not a child of it:
          interactive content nested inside an `<a>` is invalid HTML, and it
          behaved as such — the cover was a `<div onClick>`, so Tab landed on
          the link and Enter navigated straight to the picture the cover exists
          to hide. As a sibling it is a real `<button>` in its own right, in
          front of the link in both paint order and tab order.

          Kept mounted through the reveal so the cover can dissolve; unmounting
          on click swapped a fully-opaque plate for the image in one frame.
          `inert` (React 19) takes the faded remains out of the tab order and
          the accessibility tree together.

          No per-element motion guard, deliberately: the off tier's global rule
          already does the right thing here — it keeps `opacity` and drops
          `backdrop-filter`, so the cover fades without the blur animating. */}
      {isSpoilered && (
        <button
          type="button"
          onClick={handleReveal}
          inert={isRevealed}
          aria-label="显示被剧透标签遮住的图片"
          className={`absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center rounded-lg bg-media-plate backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-composite ease-[var(--ease-standard)] outline-none select-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset ${
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
