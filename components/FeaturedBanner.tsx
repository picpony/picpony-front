'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, PonyImage, applyCdn } from "@/lib/api";
import { MdThumbUp, MdComment, MdErrorOutline, MdPerson } from "react-icons/md";
import FadeInImage from "@/components/FadeInImage";

export default function FeaturedBanner() {
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

  const fullUrl = featured.representations?.full || featured.view_url || '';
  const imgFormat = (featured.format || '').toLowerCase();
  const isVideo = imgFormat === 'webm' || imgFormat === 'mp4';
  const aspectRatio = (featured.width || 1) / (featured.height || 1);
  const isWideAspect = aspectRatio > 1.5;
  const paddingBottom = isWideAspect ? 'min(45vh, 420px)' : 'min(55vh, 500px)';

  return (
    <Link
      href={`/pic/${featured.id}`}
      className="mb-6 sm:mb-8 rounded-xl overflow-hidden relative group block animate-fade-in"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent z-10 rounded-xl" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent z-10 rounded-xl" />

      <div className="relative w-full overflow-hidden rounded-xl" style={{ paddingBottom }}>
        <div className="absolute inset-0">
          {isVideo ? (
            <video
              src={fullUrl}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <FadeInImage
              src={fullUrl}
              alt={featured.name || `Featured Image ${featured.id}`}
              width={featured.width || 0}
              height={featured.height || 0}
              className="w-full h-full object-cover"
              sizes="100vw"
            />
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 sm:p-6 md:p-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/90 text-white text-xs font-semibold rounded-full mb-2 sm:mb-3 backdrop-blur-sm">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          近日推荐
        </div>

        {featured.description && (
          <p className="text-white/90 text-sm sm:text-base line-clamp-2 max-w-2xl mb-2 sm:mb-3 leading-relaxed drop-shadow-lg">
            {featured.description.split('\n')[0]
              .replace(/\r/g, '')
              .replace(/\\#/g, '#')
              .replace(/#mylittlepony|#mlp|#scitwi/gi, '')
              .replace(/> /g, '')
              .trim()
              .substring(0, 150)}
          </p>
        )}

        <div className="flex items-center gap-3 sm:gap-4 text-white/80 text-xs sm:text-sm pointer-events-none">
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
    </Link>
  );
}