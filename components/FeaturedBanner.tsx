'use client';

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { api, PonyImage, applyCdn } from "@/lib/api";
import { MdThumbUp, MdComment, MdPerson } from "react-icons/md";
import FadeInImage from "@/components/FadeInImage";
import { useHeroLink } from "@/lib/useHero";

export default function FeaturedBanner() {
  const heroElementRef = useRef<HTMLDivElement>(null);
  const [featured, setFeatured] = useState<PonyImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const getApiKey = (): string | undefined => {
      try {
        const userInfoStr = localStorage.getItem('user_info');
        if (userInfoStr) {
          const userInfo = JSON.parse(userInfoStr);
          return userInfo.api_key || undefined;
        }
      } catch {}
      return undefined;
    };

    api.getFeatured(getApiKey())
      .then((data) => {
        if (isMounted) {
          if (data && data.image) {
            let img = data.image;
            // 应用 CDN
            if (localStorage.getItem('trixie_use_cdn') === 'true') {
              img = {
                ...img,
                representations: Object.fromEntries(
                  Object.entries(img.representations).map(([k, v]) => [k, applyCdn(v)])
                ) as unknown as PonyImage['representations'],
                view_url: applyCdn(img.view_url),
              };
            }
            setFeatured(img);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
  const { sourceKey: heroSourceKey, ...heroLinkProps } = useHeroLink({
    image: featured,
    sourceRef: heroElementRef,
    previewSrc: isVideo ? displayVideoUrl : displayImageUrl,
    canAnimate: true,
    kind: 'featured',
  });

  if (loading) {
    return (
      <div className="mb-6 sm:mb-8 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 animate-pulse">
        <div className="relative w-full" style={{ paddingBottom: 'min(40vh, 400px)' }}>
          <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (error || !featured) {
    return null;
  }

  const aspectRatio = (featured.width || 1) / (featured.height || 1);
  const isWideAspect = aspectRatio > 1.5;
  const paddingBottom = isWideAspect ? 'min(45vh, 420px)' : 'min(55vh, 500px)';
  return (
    <Link
      {...heroLinkProps}
      className="image-hero-card-link mb-6 sm:mb-8 rounded-xl relative group block"
    >
      {/* Media only — hero hides this while the flyer flies. */}
      <div
        ref={heroElementRef}
        data-image-hero-role="thumbnail"
        data-image-hero-id={featured.id}
        data-image-hero-source-key={heroSourceKey}
        className="relative w-full overflow-hidden rounded-xl"
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
              alt={featured.name || `Featured Image ${featured.id}`}
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
        className="pointer-events-none absolute inset-0 z-20 rounded-xl"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 rounded-xl"
          style={{
            backgroundImage: [
              'linear-gradient(to right, rgba(0, 0, 0, 0.3), transparent)',
              'linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.2), transparent)',
            ].join(', '),
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 md:p-8">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/90 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm sm:mb-3">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            近日推荐
          </div>

          {featured.description && (
            <p className="mb-2 max-w-2xl text-sm leading-relaxed text-white/90 line-clamp-2 drop-shadow-lg sm:mb-3 sm:text-base">
              {featured.description.split('\n')[0]
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
                <span
                  key={tag}
                  className="max-w-[140px] truncate rounded-full bg-black/40 px-2 py-0.5 text-xs text-white/85 backdrop-blur-sm"
                >
                  {tag}
                </span>
              ))}
              {featured.tags.length > 6 && (
                <span className="px-2 py-0.5 text-xs text-white/60">
                  +{featured.tags.length - 6}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-white/80 sm:gap-4 sm:text-sm">
            <div className="flex items-center gap-1">
              <MdThumbUp size={14} />
              <span>{featured.score?.toLocaleString() || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <MdComment size={14} />
              <span>{featured.comment_count?.toLocaleString() || 0}</span>
            </div>
            {featured.uploader && (
              <div className="flex items-center gap-1">
                <MdPerson size={14} />
                <span>{featured.uploader}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
