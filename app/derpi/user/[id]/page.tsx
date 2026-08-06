'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MdStar,
  MdImage,
  MdSearch,
  MdOpenInNew,
  MdUpload,
  MdChatBubbleOutline,
  MdEdit,
} from 'react-icons/md';
import { api, DerpiProfileUser, PonyImage } from '@/lib/api';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import Button from '@/components/Button';

const PER_PAGE = 24;

export default function DerpiUserPage() {
  const params = useParams();
  const router = useRouter();
  const userId = (params.id as string) || '';

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<DerpiProfileUser | null>(null);

  // Uploads tab
  const [uploads, setUploads] = useState<PonyImage[]>([]);
  const [uploadsPage, setUploadsPage] = useState(1);
  const [uploadsTotal, setUploadsTotal] = useState(0);
  const [isUploadsLoading, setIsUploadsLoading] = useState(false);

  // Fetch profile
  useEffect(() => {
    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setIsLoading(true);
      setError(null);
    });

    (async () => {
      const data = await api.getDerpiProfile(userId);
      if (!isMounted) return;
      if (data?.user) {
        setProfile(data.user);
        setIsLoading(false);
      } else {
        setError('未找到该 Derpibooru 用户');
        setIsLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Fetch uploads
  useEffect(() => {
    if (!profile) return;
    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) setIsUploadsLoading(true);
    });

    (async () => {
      const query = `uploader_id:${profile.id}`;
      const data = await api.searchDerpiImages(query, uploadsPage, PER_PAGE);
      if (!isMounted) return;
      if (data) {
        setUploads(data.images || []);
        setUploadsTotal(data.total || 0);
      }
      setIsUploadsLoading(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [profile, uploadsPage]);

  const totalPages = Math.ceil(uploadsTotal / PER_PAGE);

  const handleUploadClick = useCallback(
    (id: number) => {
      router.push(`/pic/${id}`);
    },
    [router],
  );

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <div className="bg-surface">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
          <div className="flex items-center gap-4 pb-6">
            <Skeleton className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-surface shrink-0" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-8 rounded w-1/3 mb-4" />
              <Skeleton className="h-4 rounded w-1/4" />
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 rounded w-full" />
            <Skeleton className="h-4 rounded w-5/6" />
            <Skeleton className="h-4 rounded w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-headline-s text-on-surface mb-4">加载失败</h2>
        <p className="text-on-surface-variant mb-6">{error || '用户可能不存在'}</p>
        <div className="flex gap-4 justify-center">
          <Button onClick={() => router.back()} variant="filled">
            返回上一页
          </Button>
          {userId && (
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(userId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2 bg-surface-container-highest text-on-surface rounded-full hover:bg-surface-container-highest transition-ui inline-flex items-center gap-1.5"
            >
              <MdOpenInNew size={16} />在 Derpibooru 查看
            </a>
          )}
        </div>
      </div>
    );
  }

  const avatarUrl = profile.avatar_url || profile.avatar;
  const uploaderQuery = `uploader_id:${profile.id}`;

  return (
    <div className="animate-fade-in bg-surface">
      {/* ===== Main Content ===== */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pb-8 pt-6 sm:pt-8">
          {/* Avatar + Username row */}
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote derpi avatar URL
                <img
                  src={avatarUrl}
                  alt={profile.name}
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-surface shadow-e3"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    const fb = (e.target as HTMLImageElement).nextElementSibling;
                    if (fb) fb.classList.remove('hidden');
                  }}
                />
              ) : null}
              <div
                className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-primary/10 flex items-center justify-center text-primary text-headline-m-emphasized sm:text-display-s border-4 border-surface shadow-e3 ${avatarUrl ? 'hidden' : ''}`}
              >
                {profile.name.charAt(0).toUpperCase()}
              </div>
            </div>

            <div className="min-w-0">
              <h1 className="text-headline-s sm:text-headline-m text-on-surface flex items-center gap-3">
                {profile.name}
                <span className="text-body-m font-normal text-outline">#{profile.id}</span>
              </h1>
              <p className="text-body-m text-on-surface-variant mt-1">Derpibooru 用户</p>
            </div>
          </div>

          {/* Badges (awards) */}
          {profile.awards && profile.awards.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {profile.awards.map((award, i) => {
                const badgeUrl = award.image_url || award.badge_url || award.url || award.image;
                return badgeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote badge image
                  <img
                    key={i}
                    src={badgeUrl}
                    title={award.title || '勋章'}
                    className="h-7 rounded shadow-e1 hover:scale-110 transition-transform"
                    alt=""
                  />
                ) : null;
              })}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-5 mt-6 bg-surface-container-low/50 rounded-md px-5 py-3 text-body-m">
            <div className="flex items-center gap-1.5 text-primary">
              <MdUpload size={16} />
              <span className="font-semibold text-on-surface">
                {(profile.uploads_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">上传</span>
            </div>
            <div className="text-on-accent-blue flex items-center gap-1.5">
              <MdChatBubbleOutline size={16} />
              <span className="font-semibold text-on-surface">
                {(profile.comments_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">评论</span>
            </div>
            <div className="flex items-center gap-1.5 text-warning">
              <MdEdit size={16} />
              <span className="font-semibold text-on-surface">
                {(profile.posts_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">发帖</span>
            </div>
          </div>

          {/* Description */}
          {profile.description && (
            <div className="mt-6">
              <h3 className="text-label-l-emphasized text-on-surface mb-2">个人简介</h3>
              <div className="text-body-m text-on-surface-variant bg-surface-container-low/50 p-4 rounded-md leading-relaxed whitespace-pre-wrap popover-scrollbar max-h-40 overflow-y-auto">
                {profile.description}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <Button
              onClick={() => router.push(`/search?q=${encodeURIComponent(uploaderQuery)}`)}
              variant="filled"
              size="lg"
              className="flex-1"
              icon={<MdSearch size={18} />}
            >
              搜搜 TA 的所有作品
            </Button>
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(profile.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-5 py-3 border border-outline text-on-surface rounded-full hover:bg-surface-container-high transition-ui flex items-center justify-center gap-2 text-label-l"
            >
              <MdOpenInNew size={18} />在 Derpibooru 查看主页
            </a>
          </div>

          {/* ===== Uploads Tab ===== */}
          <div className="mt-10">
            <h2 className="text-title-m-emphasized text-on-surface mb-4 flex items-center gap-2">
              <MdImage size={20} className="text-primary" />
              最近上传
              {uploadsTotal > 0 && (
                <span className="text-body-m font-normal text-outline">
                  （共 {uploadsTotal.toLocaleString()} 张）
                </span>
              )}
            </h2>

            {isUploadsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-md" />
                ))}
              </div>
            ) : uploads.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                  {uploads.map((img) => {
                    const thumbUrl =
                      img.representations?.small || img.representations?.thumb || img.view_url;
                    return (
                      <div
                        key={img.id}
                        className="group relative aspect-square rounded-md overflow-hidden bg-surface-container-high cursor-pointer"
                        onClick={() => handleUploadClick(img.id)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic derpi thumbnail */}
                        <img
                          src={thumbUrl}
                          alt={img.name || `#${img.id}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-scrim/0 group-hover:bg-scrim/20 transition-ui" />
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-on-media text-label-m">#{img.id}</span>
                        </div>
                        {img.score !== undefined && (
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-scrim/50 backdrop-blur-sm text-on-media text-body-s rounded flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MdStar size={10} />
                            {img.score}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <Pagination
                    currentPage={uploadsPage}
                    totalPages={totalPages}
                    onPageChange={(next) => {
                      setIsUploadsLoading(true);
                      setUploadsPage(next);
                    }}
                  />
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <MdImage size={48} className="mx-auto text-outline mb-4" />
                <p className="text-on-surface-variant text-title-m">暂无上传</p>
                <p className="text-outline text-body-m mt-1">该用户尚未上传任何图片</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
