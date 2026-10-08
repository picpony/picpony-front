'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { SKIP, useResource } from '@/lib/resource';
import { featuredImage, useBrowsingFingerprint } from '@/lib/resources';
import { MdThumbUp, MdComment, MdPerson, MdVisibilityOff, MdBrokenImage, MdRefresh } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useHeroLink } from '@/lib/useHero';
import { ICON } from '@/lib/icons';
import { useSession } from '@/lib/hooks';
import { useMotionTier } from '@/lib/appearance';
import { parseBrowsingFingerprint } from '@/lib/searchQuery';
import { useMounted } from '@/lib/overlay';
import { currentBlockFilters } from '@/lib/blockFilters';
import { isWithheldBy } from '@/lib/imageFilters';
import { useSpoilerMatch } from '@/lib/spoilers';
import { describeImage } from '@/lib/imageDescription';
import { descriptionTeaser } from '@/lib/plainText';
import { saveDataRequested } from '@/lib/imageLoader';
import { clearImageSequence } from '@/lib/imageSequence';
import { GALLERY_BLOCK_SIZES } from '@/lib/masonry';
import { formatCount } from '@/lib/format';
import type { FeaturedSeed } from '@/lib/feed.server';
import type { PonyImage } from '@/lib/types/image';

/* The banner's scrims are drawn over photography, so they must be black in both
   schemes — but "black" should still come from the token, not from a literal,
   or a change to `scrim` silently skips these two gradients. */
const scrim = (alpha: number) =>
  `color-mix(in oklab, var(--md-sys-color-scrim) ${alpha * 100}%, transparent)`;

/**
 * The slot's height: a wide picture (over 1.5:1) takes the shorter one. The skeleton takes the
 * common case's, so the rarer wide banner *shrinks* into place rather than every banner growing
 * over the grid (R4-021).
 */
const HEIGHT_NORMAL = 'min(55vh, 500px)';
const HEIGHT_WIDE = 'min(45vh, 420px)';
const heightFor = (image: PonyImage) => ((image.width || 1) / (image.height || 1) > 1.5 ? HEIGHT_WIDE : HEIGHT_NORMAL);

/**
 * The banner's placeholder, shared with the home page's Suspense fallback.
 *
 * It has to be reachable from outside: the fallback stands in for a tree in
 * which `FeaturedBanner` has not mounted at all, so its own `loading` branch
 * cannot run. The gallery therefore came up as a bare grid with the banner's
 * slot missing, then grew by ~400px and pushed the whole grid down the moment
 * the real banner arrived.
 */
export function FeaturedBannerSkeleton() {
  return (
    <div className="mb-6 sm:mb-8 overflow-hidden rounded-lg" aria-hidden="true">
      <div className="relative w-full" style={{ paddingBottom: HEIGHT_NORMAL }}>
        <Skeleton className="absolute inset-0 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * 近日推荐 — Derpibooru's featured picture, at the top of the gallery.
 *
 * **In the first byte.** The server reads the anonymous featured picture beside the feed
 * (`readFeatured`) and hands it down, so the banner — the page's largest element and the
 * phone's LCP — is painted before hydration, requested eagerly at high priority. A signed-in
 * visitor with a Derpibooru key re-reads with the key over it (the key must not reach a shared
 * server cache), keeping the seeded picture on screen meanwhile.
 *
 * **The device's settings apply** (R4-025): a picture the content filter, a ban toggle, a hidden
 * tag or only-pony would keep out of the grid is not shown above it — the slot is simply not
 * there — and a spoilered one wears the grid's own cover.
 *
 * **Every state keeps the slot**: loading is the skeleton in the banner's own height, and a
 * failed read is a plate in the same geometry with 重试, so the grid below never jumps (it
 * collapsed by the banner's height when the read failed, R4-021).
 */
export default function FeaturedBanner({
  seed,
  reloadKey = 0,
  enabled = true,
}: {
  seed?: FeaturedSeed | null;
  reloadKey?: number;
  /** False while the gallery waits to be shown (a deep link to the forum tab). */
  enabled?: boolean;
}) {
  const heroElementRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const { user, ready } = useSession();
  const apiKey = typeof user?.api_key === 'string' && user.api_key ? user.api_key : undefined;

  /* **The server's settings for the hydrating render, the device's from then on** — the same
     hand-off the feed makes with its fingerprint, so the first key agrees with the seed's and
     the first verdict with the server's HTML. The device's settings are read from the browsing
     fingerprint, a store: a client-side mount (coming back to the gallery) judges the banner in
     its first render, so a picture the device withholds is never painted for a frame and then
     removed — which, from inside the grid, moved every card under the viewer by the banner's
     height (scroll anchoring holds nothing there). A settings change re-renders through it too. */
  const mounted = useMounted();
  const fingerprint = useBrowsingFingerprint();
  const device = useMemo(() => parseBrowsingFingerprint(fingerprint), [fingerprint]);
  const contentFilter = mounted ? device.contentFilter : (seed?.contentFilter ?? 'safe');

  /* Before the session is known, only a seeded read may start — the anonymous one the server
     already made. Without a seed the read waits for the session, so a signed-in visitor with a
     key does not pay for an anonymous read first. */
  const args = !enabled
    ? SKIP
    : ready
      ? { apiKey, contentFilter }
      : seed
        ? { apiKey: undefined, contentFilter }
        : SKIP;
  const read = useResource(featuredImage, args, {
    initial: seed ? { key: seed.key, data: seed.data, generatedAt: seed.generatedAt } : undefined,
    /* A keyed re-read keeps the anonymous picture up meanwhile; a filter change does not. */
    keepPrevious: contentFilter,
  });
  const featured = read.data ?? null;
  const loading = read.data === undefined && !read.error;
  /* A refresh that fails leaves the picture on screen rather than replacing
     something correct with an error — the resource keeps the last good value
     beside the error. */
  const failed = Boolean(read.error) && read.data === undefined;

  /* The home feed's 重试 reloads the banner alongside the 信息流. It skips the TTL, because the
     point of pressing 重试 is that you do not believe what is on screen. */
  const lastReload = useRef(reloadKey);
  useEffect(() => {
    if (lastReload.current === reloadKey) return;
    lastReload.current = reloadKey;
    read.refresh();
  }, [reloadKey, read]);

  const spoilers = useSpoilerMatch(featured?.tags);
  const [revealed, setRevealed] = useState<number | null>(null);
  const covered = spoilers.length > 0 && revealed !== featured?.id;
  const tier = useMotionTier();
  /* Decorative playback only at the standard tier and without Data Saver (R4-045). Not in the
     hydrating render: the server renders the still, like a device that asked for less. */
  const playAllowed = mounted && tier === 'standard' && !saveDataRequested();

  const fullUrl = featured?.representations?.full || featured?.view_url || '';
  const imgFormat = (featured?.format || fullUrl.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isVideo = imgFormat === 'webm' || imgFormat === 'mp4';
  const displayImageUrl =
    featured?.representations?.large ||
    featured?.representations?.medium ||
    featured?.representations?.small ||
    featured?.representations?.thumb_small ||
    fullUrl;
  const displayVideoUrl =
    featured?.representations?.medium ||
    featured?.representations?.small ||
    featured?.representations?.thumb_small ||
    featured?.representations?.thumb ||
    fullUrl;
  const { sourceKey: heroSourceKey, onClick: heroClick, ...heroLinkProps } = useHeroLink({
    image: featured,
    sourceRef: heroElementRef,
    previewSrc: isVideo ? displayVideoUrl : displayImageUrl,
    canAnimate: !covered,
    kind: 'featured',
  });

  if (!enabled && !featured) return <FeaturedBannerSkeleton />;
  if (loading) return <FeaturedBannerSkeleton />;
  if (failed) return <FeaturedFailure onRetry={read.refresh} />;
  if (!featured) return null;
  /* Withheld by the device's settings: the server's verdict until the device's is known. */
  const withheld = mounted
    ? isWithheldBy(featured.tags, device, currentBlockFilters())
    : Boolean(seed?.hidden && seed.data?.id === featured.id);
  if (withheld) return null;

  const name = describeImage(featured);
  const teaser = descriptionTeaser(featured.description);
  const paddingBottom = heightFor(featured);

  /* Not a list: opening the banner walks no sequence, so a stale one from a grid is dropped. */
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      clearImageSequence();
    }
    heroClick(event);
  };

  /* Focus to the link before the cover turns inert — see `ImageCard`'s reveal. */
  const handleReveal = () => {
    const link = linkRef.current;
    if (link) {
      link.inert = false;
      link.focus({ preventScroll: true });
    }
    setRevealed(featured.id);
  };

  return (
    /* 16dp, the gallery tile's step, on all of this component's layers — they
       were the 12dp card step, one smaller than the tiles under it. It is a grid
       entry, not the shape table's 28dp "large media" row (that row means the
       detail surface). It also matters to the flight: the flyer reads the
       source's computed radius and morphs it to the target 16, so at 16 the
       corner morph is a no-op and the handoff is continuous. All layers are
       coincident, so they must move together — including the skeleton's two,
       or the placeholder stops matching what it replaces. */
    <div className="relative mb-6 sm:mb-8">
      <Link
        {...heroLinkProps}
        ref={linkRef}
        onClick={handleClick}
        aria-label={`近日推荐：${name}`}
        inert={covered}
        draggable={false}
        className="image-hero-card-link rounded-lg relative group block select-none [-webkit-touch-callout:none]"
      >
        {/* Media only — hero hides this while the flyer flies. */}
        <div
          ref={heroElementRef}
          data-image-hero-role="thumbnail"
          data-image-hero-id={featured.id}
          data-image-hero-source-key={heroSourceKey}
          className="relative w-full overflow-hidden rounded-lg bg-surface-container-high"
          style={{ paddingBottom }}
        >
          <div className="absolute inset-0">
            {isVideo ? (
              <video
                key={playAllowed ? 'play' : 'still'}
                src={playAllowed ? displayVideoUrl : `${displayVideoUrl}#t=0.1`}
                autoPlay={playAllowed}
                loop={playAllowed}
                muted
                playsInline
                disablePictureInPicture
                aria-hidden="true"
                tabIndex={-1}
                /* The still costs its first frame, not the file. */
                preload={playAllowed ? 'auto' : 'metadata'}
                className="w-full h-full object-cover"
              />
            ) : (
              <FadeInImage
                src={displayImageUrl}
                alt={name}
                /* The page's LCP element: requested at once and ahead of the cards. `eager`
                   also paints it as it decodes rather than after a fade — a transparent image
                   is not a paint. (`preload` would add a head `<link>`, but a component that
                   renders inside a streamed boundary cannot put one in the head; the preload
                   scanner finds the eager `<img>` in the HTML anyway.) */
                eager
                fetchPriority="high"
                width={featured.width || 1}
                height={featured.height || 1}
                quality={88}
                draggable={false}
                className="w-full h-full object-cover"
                sizes={GALLERY_BLOCK_SIZES}
              />
            )}
          </div>
        </div>

        {/* Labels stay in the original card slot and simply fade via CSS. */}
        <div
          data-image-hero-chrome
          className="pointer-events-none absolute inset-0 z-20 rounded-lg"
          aria-hidden="true"
        >
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              backgroundImage: [
                `linear-gradient(to right, ${scrim(0.3)}, transparent)`,
                `linear-gradient(to top, ${scrim(0.6)}, ${scrim(0.2)}, transparent)`,
              ].join(', '),
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 md:p-8">
            {/* `Badge`, not a hand-rolled pill: one shape, one owner for the
                colour pair. The fill stays `primary`/`on-primary` rather than a
                media role — those two are documented as not inverting between
                schemes, so the banner's own mark reads as one constant material
                over any photograph. */}
            <Badge
              size="md"
              colors="bg-primary text-on-primary"
              className="mb-2 sm:mb-3"
              icon={
                <svg fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              }
            >
              近日推荐
            </Badge>
            {teaser && (
              /* A plain-text pass over the description's markup (R4-054): the first readable
                 paragraph, spoilers dropped, cut at 150 characters. */
              <p className="text-body-m text-on-media-variant sm:text-body-l mb-2 line-clamp-2 max-w-2xl sm:mb-3">
                {teaser}
              </p>
            )}
            {featured.tags && featured.tags.length > 0 && (
              <div className="mb-2 flex max-w-2xl flex-wrap gap-1.5 sm:mb-3">
                {featured.tags.slice(0, 6).map((tag) => (
                  /* `tone="media"` — the plate/ink pair, which is what this wrote
                     out by hand. `max-w-36` caps a long tag on the spacing scale
                     rather than as an arbitrary value. */
                  <Badge key={tag} tone="media" className="max-w-36">
                    {tag}
                  </Badge>
                ))}
                {featured.tags.length > 6 && (
                  <span className="text-body-s text-on-media-variant px-2 py-0.5">
                    +{featured.tags.length - 6}
                  </span>
                )}
              </div>
            )}
            <div className="text-body-s text-on-media-variant sm:text-body-m flex items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-1">
                <MdThumbUp size={ICON.dense} />
                <span>{formatCount(featured.score ?? 0)}</span>
              </div>
              <div className="flex items-center gap-1">
                <MdComment size={ICON.dense} />
                <span>{formatCount(featured.comment_count ?? 0)}</span>
              </div>
              {featured.uploader && (
                <div className="flex min-w-0 items-center gap-1">
                  <MdPerson size={ICON.dense} />
                  <span className="truncate">{featured.uploader}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>

      {spoilers.length > 0 && (
        /* The grid's spoiler cover, in the banner's geometry (C2): opaque, named, one press or
           Enter reveals the picture already mounted underneath, and focus moves to the link
           first. A sibling of the link, never inside it. */
        <button
          type="button"
          onClick={handleReveal}
          inert={!covered}
          aria-label={`显示剧透图片：${spoilers.join('、')}`}
          className={`absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg bg-surface-container-highest px-6 text-center text-on-surface-variant select-none focus-visible:outline-hidden focus-visible:ring-2 focus-ring forced-boundary transition-opacity spring-fast-effects ${
            covered ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <MdVisibilityOff size={ICON.large} aria-hidden="true" />
          <span className="text-title-m text-on-surface">近日推荐含剧透内容</span>
          <span className="line-clamp-2 max-w-md text-body-m break-words">{spoilers.join('、')}</span>
          <span className="text-label-l">点按显示</span>
        </button>
      )}
    </div>
  );
}

/**
 * A failed featured read, in the banner's own geometry — so the grid under it does not move —
 * with a way to try again. Its height is the skeleton's: the picture it stands in for is not
 * known.
 */
function FeaturedFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mb-6 sm:mb-8 overflow-hidden rounded-lg">
      <div className="relative w-full" style={{ paddingBottom: HEIGHT_NORMAL }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container-high px-6 text-center text-on-surface-variant">
          <MdBrokenImage size={ICON.large} aria-hidden="true" />
          <p className="text-title-m text-on-surface">近日推荐加载失败</p>
          <Button variant="tonal" icon={<MdRefresh />} onClick={onRetry}>
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}
