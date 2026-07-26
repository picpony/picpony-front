'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdStar, MdImage, MdSearch, MdOpenInNew, MdUpload, MdChatBubbleOutline, MdEdit } from 'react-icons/md';
import { api, DerpiProfileUser, PonyImage } from '@/lib/api';

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

    return () => { isMounted = false; };
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

    return () => { isMounted = false; };
  }, [profile, uploadsPage]);

  const totalPages = Math.ceil(uploadsTotal / PER_PAGE);

  const handleUploadClick = useCallback((id: number) => {
    router.push(`/pic/${id}`);
  }, [router]);

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <div className="animate-pulse bg-white dark:bg-slate-950 min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
          <div className="flex items-center gap-4 pb-6">
            <div className="w-24 h-24 sm:w-32 sm:h-32 bg-slate-300 dark:bg-slate-600 rounded-full border-4 border-white dark:border-slate-800 shrink-0"></div>
            <div className="flex-1 min-w-0">
              <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">加载失败</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">{error || '用户可能不存在'}</p>
        <div className="flex gap-4 justify-center">
          <button onClick={() => router.back()} className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
            返回上一页
          </button>
          {userId && (
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(userId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors inline-flex items-center gap-1.5"
            >
              <MdOpenInNew size={16} />
              在 Derpibooru 查看
            </a>
          )}
        </div>
      </div>
    );
  }

  const avatarUrl = profile.avatar_url || profile.avatar;
  const uploaderQuery = `uploader_id:${profile.id}`;

  return (
    <div className="animate-fade-in bg-white dark:bg-slate-950 min-h-screen">
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
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-lg"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    const fb = (e.target as HTMLImageElement).nextElementSibling;
                    if (fb) fb.classList.remove('hidden');
                  }}
                />
              ) : null}
              <div className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-3xl sm:text-4xl border-4 border-white dark:border-slate-800 shadow-lg ${avatarUrl ? 'hidden' : ''}`}>
                {profile.name.charAt(0).toUpperCase()}
              </div>
            </div>

            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
                {profile.name}
                <span className="text-sm font-normal text-slate-400 dark:text-slate-500">
                  #{profile.id}
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Derpibooru 用户
              </p>
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
                    className="h-7 rounded shadow-sm hover:scale-110 transition-transform"
                    alt=""
                  />
                ) : null;
              })}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-5 mt-6 bg-slate-50 dark:bg-slate-900/50 rounded-xl px-5 py-3 text-sm">
            <div className="flex items-center gap-1.5 text-primary">
              <MdUpload size={16} />
              <span className="font-semibold text-slate-800 dark:text-slate-200">{(profile.uploads_count ?? 0).toLocaleString()}</span>
              <span className="text-slate-500 dark:text-slate-400">上传</span>
            </div>
            <div className="flex items-center gap-1.5 text-blue-500">
              <MdChatBubbleOutline size={16} />
              <span className="font-semibold text-slate-800 dark:text-slate-200">{(profile.comments_count ?? 0).toLocaleString()}</span>
              <span className="text-slate-500 dark:text-slate-400">评论</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-500">
              <MdEdit size={16} />
              <span className="font-semibold text-slate-800 dark:text-slate-200">{(profile.posts_count ?? 0).toLocaleString()}</span>
              <span className="text-slate-500 dark:text-slate-400">发帖</span>
            </div>
          </div>

          {/* Description */}
          {profile.description && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">个人简介</h3>
              <div className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {profile.description}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={() => router.push(`/search?q=${encodeURIComponent(uploaderQuery)}`)}
              className="flex-1 px-5 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
            >
              <MdSearch size={18} />
              搜搜 TA 的所有作品
            </button>
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(profile.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-5 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
            >
              <MdOpenInNew size={18} />
              在 Derpibooru 查看主页
            </a>
          </div>

          {/* ===== Uploads Tab ===== */}
          <div className="mt-10">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
              <MdImage size={20} className="text-primary" />
              最近上传
              {uploadsTotal > 0 && (
                <span className="text-sm font-normal text-slate-400 dark:text-slate-500">
                  （共 {uploadsTotal.toLocaleString()} 张）
                </span>
              )}
            </h2>

            {isUploadsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl bg-slate-200 dark:bg-slate-700 animate-pulse" />
                ))}
              </div>
            ) : uploads.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                  {uploads.map((img) => {
                    const thumbUrl = img.representations?.small || img.representations?.thumb || img.view_url;
                    return (
                      <div
                        key={img.id}
                        className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 cursor-pointer"
                        onClick={() => handleUploadClick(img.id)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic derpi thumbnail */}
                        <img
                          src={thumbUrl}
                          alt={img.name || `#${img.id}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-white text-xs font-medium">#{img.id}</span>
                        </div>
                        {img.score !== undefined && (
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-xs rounded flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                    <button
                      onClick={() => { setIsUploadsLoading(true); setUploadsPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={uploadsPage === 1}
                      className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      首页
                    </button>
                    <button
                      onClick={() => { setIsUploadsLoading(true); setUploadsPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={uploadsPage === 1}
                      className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <span className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                      {uploadsPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => { setIsUploadsLoading(true); setUploadsPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={uploadsPage === totalPages}
                      className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                    <button
                      onClick={() => { setIsUploadsLoading(true); setUploadsPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={uploadsPage === totalPages}
                      className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      末页
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <MdImage size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                <p className="text-slate-500 dark:text-slate-400 text-lg">暂无上传</p>
                <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">该用户尚未上传任何图片</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
