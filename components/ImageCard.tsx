'use client';

import { memo, useCallback, useDeferredValue, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { MdThumbUp, MdComment, MdVisibilityOff, MdBrokenImage, MdRefresh } from 'react-icons/md';
import FadeInImage from './FadeInImage';
import ImageCardVideo from './ImageCardVideo';
import Button from './Button';
import Skeleton from './Skeleton';
import type { ImagePreview } from '@/lib/types/image';
import { useHeroLink } from '@/lib/useHero';
import { ICON } from '@/lib/icons';
import { MediaBadge } from './Badge';
import { useSpoilerMatch } from '@/lib/spoilers';
import { describeImage } from '@/lib/imageDescription';
import { openFromSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import { pickRendition } from '@/lib/imageLoader';
import { estimateCardWidth, MASONRY_CARD_SIZES } from '@/lib/masonry';
import { useMounted } from '@/lib/overlay';

interface ImageCardProps {
  image: ImagePreview;
  /** Position in the list, from 0 — the first screen's cards are the only ones the server paints. */
  index: number;
  /** The list 上一张 / 下一张 walk through once this card is opened (`lib/imageSequence.ts`). */
  sequence: ImageSequenceSource;
  /** PicPony's own comment count, shown beside Derpibooru's as `+n`. */
  siteComments?: number;
}

/**
 * How many cards the server renders an `<img>` for. The rest render their frame (the aspect box
 * and its shimmer) and mount the picture after hydration.
 *
 * On a slow phone the seeded page used to start 49 card images before the first-document JS had
 * arrived, taking the link from the scripts that make the page usable and from the banner that
 * is the page's LCP (R12-002). Eight is two rows at four columns and four at two — past the
 * first screen at every width, where the banner above takes most of the viewport.
 */
const SERVER_PAINTED_CARDS = 8;

/** A still frame at this density does not read soft in motion; past it the bytes are wasted. */
const ANIMATED_MAX_DENSITY = 1.5;

function formatOf(image: ImagePreview): string {
  const fullUrl = image.representations?.full || image.view_url || '';
  return (image.format || fullUrl.split(/[?#]/)[0].split('.').pop() || 'UNKNOWN').toUpperCase();
}

/**
 * An animated picture: the optimizer passes animations through unresized, so these take a
 * Derpibooru rendition sized for the card instead (R12-001). `animated` where the row carries it,
 * the GIF format where it does not.
 */
function isAnimated(image: ImagePreview, format: string): boolean {
  return (image as { animated?: unknown }).animated === true || format === 'GIF';
}

/** The animated rendition for this device's card width and density, or `''` for none. */
function animatedRendition(image: ImagePreview): string {
  return pickRendition(
    image.representations as unknown as Record<string, string>,
    image.width || 0,
    image.height || 0,
    estimateCardWidth(window.innerWidth) * Math.min(window.devicePixelRatio || 1, ANIMATED_MAX_DENSITY),
  );
}

export default memo(function ImageCard({ image, index, sequence, siteComments }: ImageCardProps) {
  const heroElementRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
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
  const format = formatOf(image);
  const isVideo = format === 'WEBM' || format === 'MP4';
  const animated = !isVideo && isAnimated(image, format);
  const name = describeImage(image);

  /* **Covered from the very first render when the server knew to cover it** — the cookie
     mirror of the device's spoiler tags (`lib/spoilers.ts`) — so a cold load never paints a
     picture the user asked to hide, and the live list takes over after hydration. */
  const spoilers = useSpoilerMatch(image.tags);
  const [revealed, setRevealed] = useState(false);
  const covered = spoilers.length > 0 && !revealed;

  /* The server paints the first screen's pictures; the rest — and every animated one, whose
     rendition depends on this device's width and density — mount once the page has hydrated,
     in a deferred render so fifty `<img>`s do not land in one task. A client-mounted card (a
     page turn, a navigation) is past hydration and shows its picture at once. */
  const hydrated = useDeferredValue(useMounted());
  const paintMedia = hydrated || (index < SERVER_PAINTED_CARDS && !animated);

  /* A failed picture is re-tried from the top by remounting it. */
  const [attemptKey, setAttemptKey] = useState(0);
  const [failed, setFailed] = useState(false);
  const markFailed = useCallback(() => setFailed(true), []);
  const retry = () => {
    setFailed(false);
    setAttemptKey((key) => key + 1);
  };

  /* Two statements rather than one conditional with a fallback inside it: that shape is one the
     React Compiler cannot lower, and it skipped the whole card for it — so every re-render of a
     card (a router update reaches all fifty through `useHeroLink`) rebuilt its whole subtree,
     about 18ms a card at 4× CPU (R12-010). */
  const rendition = animated && hydrated ? animatedRendition(image) : '';
  const animatedSrc = rendition || thumbUrl;

  const { sourceKey: heroSourceKey, onClick: heroClick, ...heroLinkProps } = useHeroLink({
    image,
    sourceRef: heroElementRef,
    previewSrc: isVideo ? mediaUrl : animatedSrc,
    canAnimate: !covered,
    kind: 'card',
  });

  /* **Every activation names the list first**, synchronously and before the hero launches, so
     the detail's 上一张 / 下一张 walk this list. A click is every activation there is: a tap, a
     press and Enter on the link all arrive as one. A modified click opens a new tab and leaves
     this one's list alone. */
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      openFromSequence(sequence);
    }
    heroClick(event);
  };

  /* Focus moves to the link *before* the cover goes: the cover is the focused element, and a
     control that turns inert drops focus to the page body (R4-024). The link is itself inert
     until this render commits, so it is released first — the value the render then writes. */
  const handleReveal = () => {
    const link = linkRef.current;
    if (link) {
      link.inert = false;
      link.focus({ preventScroll: true });
    }
    setRevealed(true);
  };

  const aspectW = image.width || 1;
  const aspectH = image.height || 1;
  const intrinsicH = Math.round(300 * (aspectH / aspectW));
  const comments = typeof image.comment_count === 'number' ? image.comment_count : null;
  const onSite = siteComments && siteComments > 0 ? siteComments : 0;

  return (
    <div
      className="image-card relative w-full"
      style={{ containIntrinsicSize: `auto ${intrinsicH}px` }}
    >
      <Link
        {...heroLinkProps}
        ref={linkRef}
        onClick={handleClick}
        /* Named by what is in the picture (R11-001, R11-002): the video branch has no `<img>` to
           lend it a name, and the image branch's `alt` was the upload's file name. */
        aria-label={isVideo ? `视频：${name}` : name}
        /* Covered, the link is out of reach entirely: the cover is the one control, and Enter
           on a link hidden under it opened the very picture it hides. */
        inert={covered}
        draggable={false}
        className="image-hero-card-link block relative rounded-lg group bg-surface-container-high w-full text-left cursor-pointer select-none [-webkit-touch-callout:none]"
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
          {isVideo ? (
            <ImageCardVideo key={attemptKey} src={mediaUrl} onGiveUp={markFailed} />
          ) : paintMedia ? (
            <FadeInImage
              key={`${attemptKey}:${animatedSrc}`}
              src={animatedSrc}
              alt={name}
              /* Fall back to the card's own aspect box rather than 0 — `0` is
                 not a valid next/image dimension, and the API omits width and
                 height on some records. */
              width={aspectW}
              height={aspectH}
              quality={82}
              className="w-full h-auto"
              draggable={false}
              sizes={MASONRY_CARD_SIZES}
              /* Below the first row the picture is not what the page is waiting for. */
              fetchPriority={index < 4 ? undefined : 'low'}
              /* Animated renditions are already sized for the card; the optimizer would pass
                 them through untouched anyway. */
              unoptimized={animated}
              proxyThumb
              onGiveUp={markFailed}
            />
          ) : (
            /* The frame the server paints for a picture it leaves to the client: the same
               shimmer the picture's own loading state starts with, so hydration is seamless. */
            <Skeleton className="absolute inset-0 block rounded-none" />
          )}
        </div>

        {/* Stay at the card slot; CSS fades when the sibling thumb is hero-locked. */}
        <div
          data-image-hero-chrome
          className="pointer-events-none absolute inset-0 z-2 rounded-lg"
          aria-hidden="true"
        >
          <div className="media-hover-scrim absolute inset-0 rounded-lg" />
          {/* Same corner marks on profile thumbnails: MediaBadge owns their
              plate, type size, inset and the corner concentric with the tile. */}
          <MediaBadge corner="top-right">{format}</MediaBadge>
          {/* No `title` on either count. This whole chrome layer is
              `pointer-events-none aria-hidden`, so a native tooltip could never be
              hovered and the name could never be read — two dead attributes. */}
          {typeof image.score === 'number' && (
            <MediaBadge corner="bottom-left" icon={<MdThumbUp />}>
              {image.score}
            </MediaBadge>
          )}
          {(comments !== null || onSite > 0) && (
            /* Derpibooru's count, then PicPony's own as `+n` — the original front end's
               reading, and the one the detail's merged comment list adds up to. */
            <MediaBadge corner="bottom-right" icon={<MdComment />}>
              {comments ?? 0}
              {onSite > 0 && `+${onSite}`}
            </MediaBadge>
          )}
        </div>
      </Link>

      {failed && !covered && (
        /* The give-up plate is drawn here rather than inside the image: a 重试 control inside
           the card's link would be a button nested in an anchor. The plate itself passes the
           pointer through, so a press anywhere else still opens the picture. */
        <div className="card-failure pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-container-high px-2 text-center text-on-surface-variant">
          <MdBrokenImage size={ICON.standard} aria-hidden="true" />
          <span className="card-failure-caption text-label-m">图片加载失败</span>
          <Button
            variant="tonal"
            size="xs"
            icon={<MdRefresh />}
            onClick={retry}
            aria-label="重新加载图片"
            className="pointer-events-auto"
          >
            重试
          </Button>
        </div>
      )}

      {spoilers.length > 0 && (
        /* The spoiler cover (C2): opaque, so nothing of the picture shows through it (a 55%
           tint over a two-pixel blur left every character recognisable, R4-023); it names the
           tags that caused it; one press or Enter reveals the picture, which has been mounted
           underneath all along, so the reveal is instant; and focus stays on the card.

           A sibling of the link, never a child: interactive content nested inside an `<a>` is
           invalid, and as a `<div onClick>` inside it Enter used to navigate straight to the
           hidden picture. Kept mounted through the reveal so it can fade on the effects clock;
           `inert` then takes it out of the tab order and the accessibility tree together. */
        <button
          type="button"
          onClick={handleReveal}
          inert={revealed}
          aria-label={`显示剧透图片：${spoilers.join('、')}`}
          className={`card-spoiler absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg bg-surface-container-highest px-3 text-center text-on-surface-variant select-none focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset forced-boundary transition-opacity spring-fast-effects ${
            revealed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <MdVisibilityOff size={ICON.standard} aria-hidden="true" />
          <span className="text-label-l text-on-surface">剧透</span>
          <span className="card-spoiler-tags line-clamp-2 max-w-full text-body-s break-words">
            {spoilers.join('、')}
          </span>
          <span className="card-spoiler-hint text-label-m">点按显示</span>
        </button>
      )}
    </div>
  );
});
