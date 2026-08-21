'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { api, PonyImage, applyCdn } from '@/lib/api';
import { MdThumbUp, MdComment, MdPerson } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import Badge from '@/components/Badge';
import Skeleton from '@/components/Skeleton';
import { useHeroLink } from '@/lib/useHero';
import { readSnapshot, writeSnapshot } from '@/lib/pageCache';
import { ICON } from '@/lib/icons';
import { readUserInfo } from '@/lib/hooks';

/* The banner's scrims are drawn over photography, so they must be black in both
   schemes — but "black" should still come from the token, not from a literal,
   or a change to `scrim` silently skips these two gradients. */
const scrim = (alpha: number) =>
  `color-mix(in oklab, var(--md-sys-color-scrim) ${alpha * 100}%, transparent)`;

const FEATURED_KEY = 'home:featured';

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
    <div data-tab-row className="mb-6 sm:mb-8 overflow-hidden rounded-lg" aria-hidden="true">
      <div className="relative w-full" style={{ paddingBottom: 'min(40vh, 400px)' }}>
        <Skeleton className="absolute inset-0 rounded-lg" />
      </div>
    </div>
  );
}

export default function FeaturedBanner({ reloadKey = 0 }: { reloadKey?: number }) {
  const heroElementRef = useRef<HTMLDivElement>(null);
  /* The banner is the first thing on the page, so its skeleton is the one you
     cannot miss. Seeded from the last load, refreshed underneath — see
     `lib/pageCache.ts`. */
  const snapshot = useState(() => readSnapshot<PonyImage>(FEATURED_KEY))[0];
  const [featured, setFeatured] = useState<PonyImage | null>(snapshot?.value ?? null);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState(false);
  /* Whether a render has already been served. Once it has, the banner only
     re-requests when the parent bumps `reloadKey` — which the home feed's
     retry does, so clicking 重试 reloads the 近日推荐 banner alongside the
     信息流. Served is flagged on delivery (not dispatch), the same reason as
     `app/page.tsx`. */
  const served = useRef(snapshot && !snapshot.stale ? 'snap' : '');
  const lastReload = useRef(reloadKey);
  /* True the moment there is something to put on screen, so a reload of an
     already-loaded banner refreshes underneath without flashing its skeleton,
     while a reload of an errored (blank) banner shows the placeholder again. */
  const hasContent = useRef<boolean>(Boolean(snapshot?.value));

  useEffect(() => {
    /* An explicit reload is the difference from the other served paths: the
       guard below normally drinks the snapshot result to keep a remount from
       re-requesting, but a retry must break through it. */
    const reloadRequested = lastReload.current !== reloadKey;
    lastReload.current = reloadKey;
    if (served.current && !reloadRequested) return;
    let isMounted = true;
    if (reloadRequested && !hasContent.current) {
      setLoading(true);
      setError(false);
    }
    // Flagged on delivery, not on dispatch — see `app/page.tsx` for why.
    const getApiKey = (): string | undefined =>
      (readUserInfo()?.api_key as string) || undefined;

    api
      .getFeatured(getApiKey())
      .then((data) => {
        if (isMounted) {
          served.current = 'snap';
          if (data && data.image) {
            hasContent.current = true;
            let img = data.image;
            // 应用 CDN
            if (localStorage.getItem('trixie_use_cdn') === 'true') {
              img = {
                ...img,
                representations: Object.fromEntries(
                  Object.entries(img.representations).map(([k, v]) => [k, applyCdn(v)]),
                ) as unknown as PonyImage['representations'],
                view_url: applyCdn(img.view_url),
              };
            }
            setFeatured(img);
            writeSnapshot<PonyImage>(FEATURED_KEY, img);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          served.current = 'snap';
          // A refresh that fails leaves the snapshot on screen rather than
          // replacing something correct with an error.
          if (!hasContent.current) setError(true);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [reloadKey, snapshot]);

  const fullUrl = featured?.representations?.full || featured?.view_url || '';
  const imgFormat = (
    featured?.format ||
    fullUrl.split(/[?#]/)[0].split('.').pop() ||
    ''
  ).toLowerCase();
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
  const { sourceKey: heroSourceKey, ...heroLinkProps } = useHeroLink({
    image: featured,
    sourceRef: heroElementRef,
    previewSrc: isVideo ? displayVideoUrl : displayImageUrl,
    canAnimate: true,
    kind: 'featured',
  });

  if (loading) {
    return <FeaturedBannerSkeleton />;
  }

  if (error || !featured) {
    return null;
  }

  const aspectRatio = (featured.width || 1) / (featured.height || 1);
  const isWideAspect = aspectRatio > 1.5;
  const paddingBottom = isWideAspect ? 'min(45vh, 420px)' : 'min(55vh, 500px)';
  return (
    /* 16dp, the gallery tile's step, on all six of this component's layers.
       They were 12dp — the *card* step — so the largest picture on the home page
       took a corner one step smaller than the smaller tiles directly under it. It
       is a grid entry rather than a dialog, which is why 16 and not the shape
       table's 28dp "large media" row (that row means the detail surface).
       It also matters to the flight: this is an `image-hero-card-link`, the flyer
       reads the source's computed radius and morphs it to `HERO_TARGET_RADIUS_PX`
       (16), so at 16 the corner morph is a no-op and the handoff is continuous.
       All six layers are coincident (`inset-0` / `w-full`), so `inner = outer − 0`
       requires them to move together — including the skeleton's two, or the
       placeholder stops matching what it replaces. */
    <Link
      {...heroLinkProps}
      data-tab-row
      className="image-hero-card-link mb-6 sm:mb-8 rounded-lg relative group block"
    >
      {/* Media only — hero hides this while the flyer flies. */}
      <div
        ref={heroElementRef}
        data-image-hero-role="thumbnail"
        data-image-hero-id={featured.id}
        data-image-hero-source-key={heroSourceKey}
        className="relative w-full overflow-hidden rounded-lg"
        style={{ paddingBottom }}
      >
        <div className="absolute inset-0">
          {isVideo ? (
            <video
              src={displayVideoUrl}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="w-full h-full object-cover"
            />
          ) : (
            <FadeInImage
              src={displayImageUrl}
              alt={featured.name || `近日推荐 #${featured.id}`}
              eager
              width={featured.width || 0}
              height={featured.height || 0}
              quality={88}
              className="w-full h-full object-cover"
              sizes="(min-width: 1536px) 1216px, calc(100vw - 2rem)"
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
          {/* `Badge`, not a hand-rolled pill. It was `rounded-full px-3 py-1.5`
              with its own container/ink pair written out — the exact silhouette
              the primitive exists to stop from drifting, and the reason this
              banner's mark was a capsule while every other mark in the app is a
              rounded rectangle.
              The fill stays `primary`/`on-primary` rather than a media role:
              those two are documented as not inverting between schemes, so the
              banner's own mark reads as one constant material over any
              photograph — which is what a media role would otherwise buy. */}
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
          </Badge>{' '}
          {featured.description && (
            <p className="text-body-m text-on-media-variant sm:text-body-l mb-2 line-clamp-2 max-w-2xl sm:mb-3">
              {' '}
              {featured.description
                .split('\n')[0]
                .replace(/\r/g, '')
                .replace(/\\#/g, '#')
                .replace(/#mylittlepony|#mlp|#scitwi/gi, '')
                .replace(/> /g, '')
                .trim()
                .substring(0, 150)}
            </p>
          )}
          {featured.tags && featured.tags.length > 0 && (
            <div className="mb-2 flex max-w-2xl flex-wrap gap-1.5 sm:mb-3">
              {featured.tags.slice(0, 6).map((tag) => (
                /* `tone="media"` — the plate/ink pair, which is what this wrote
                   out by hand. `max-w-36` caps a long tag as the old `[140px]`
                   did, on the spacing scale rather than as an arbitrary value. */
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
              <span>{featured.score?.toLocaleString() || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <MdComment size={ICON.dense} />
              <span>{featured.comment_count?.toLocaleString() || 0}</span>
            </div>
            {featured.uploader && (
              <div className="flex items-center gap-1">
                <MdPerson size={ICON.dense} />
                <span>{featured.uploader}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
