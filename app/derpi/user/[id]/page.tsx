'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MdStar,
  MdImage,
  MdErrorOutline,
  MdSearch,
  MdOpenInNew,
  MdUpload,
  MdChatBubbleOutline,
  MdEdit,
} from 'react-icons/md';
import { api, DerpiProfileUser, PonyImage } from '@/lib/api';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import StatusView from '@/components/StatusView';
import PageBack from '@/components/PageBack';
import { useEscapeBack } from '@/lib/hooks';
import EmptyState from '@/components/EmptyState';
import Button, { buttonClasses } from '@/components/Button';
import SectionHeading from '@/components/SectionHeading';

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
  /* Not a sidebar destination, so it carries the shared back affordance — see
     the rule in AGENTS.md. Drawn in all three states, which is what makes the
     error branch's claim below true: it dropped its own 返回上一页 button on the
     strength of "the leading back affordance is already chrome on this route",
     and until now this route never rendered one — so a Derpibooru profile that
     failed to load had no way out at all. */
  const handleBack = useCallback(() => router.back(), [router]);
  useEscapeBack(handleBack);

  if (isLoading) {
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="bg-surface">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-4 pb-6">
            <Skeleton className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-surface shrink-0" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-8 w-1/3 mb-4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
      </div>
      </>
    );
  }

  // --- Error state ---
  if (error || !profile) {
    /* One action, and it is the one this screen alone can offer — the source
       profile on Derpibooru. 返回上一页 is dropped because the leading back
       affordance is already chrome on this route, the same call the forum
       thread's error state makes. */
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <StatusView
        icon={<MdErrorOutline size={48} />}
        title="加载失败"
        description={error || '用户可能不存在'}
        action={
          userId && (
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(userId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'filled' })}
            >
              <MdOpenInNew size={18} />在 Derpibooru 查看
            </a>
          )
        }
      />
      </>
    );
  }

  const avatarUrl = profile.avatar_url || profile.avatar;
  const uploaderQuery = `uploader_id:${profile.id}`;

  return (
    <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="animate-fade-in bg-surface">
      {/* ===== Main Content ===== */}
      <div className="max-w-5xl mx-auto">
        <div className="pb-8 pt-6 sm:pt-8">
          {/* Avatar + Username row */}
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              {/* The fallback used to be swapped in from an `onError` handler
                  that hid the `<img>` and stripped `hidden` off its sibling — an
                  imperative DOM edit React does not know about. `Avatar` keeps the
                  initial mounted underneath instead, so it is both the error state
                  and the decode placeholder, and it cannot get out of step with a
                  re-render. */}
              <Avatar
                src={avatarUrl}
                name={profile.name}
                size="w-24 h-24 sm:w-32 sm:h-32"
                className="border-4 border-surface shadow-e3"
              />
            </div>

            <div className="min-w-0">
              <h1 className="text-headline-s sm:text-headline-m text-on-surface flex items-center gap-3">
                {profile.name}
                <span className="text-body-m text-on-surface-variant">#{profile.id}</span>
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
                    className="h-7 rounded-xs shadow-e1 transition-transform duration-300 ease-[var(--ease-standard)] hover:scale-110"
                    alt=""
                  />
                ) : null;
              })}
            </div>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 bg-surface-container-low rounded-md px-5 py-3 text-body-m">
            <div className="flex items-center gap-1.5 text-on-surface-variant">
              <MdUpload size={16} />
              <span className="text-title-m text-on-surface">
                {(profile.uploads_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">上传</span>
            </div>
            <div className="flex items-center gap-1.5 text-on-surface-variant">
              <MdChatBubbleOutline size={16} />
              <span className="text-title-m text-on-surface">
                {(profile.comments_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">评论</span>
            </div>
            <div className="flex items-center gap-1.5 text-on-surface-variant">
              <MdEdit size={16} />
              <span className="text-title-m text-on-surface">
                {(profile.posts_count ?? 0).toLocaleString()}
              </span>
              <span className="text-on-surface-variant">发帖</span>
            </div>
          </div>

          {/* Description */}
          {profile.description && (
            <div className="mt-6">
              <h3 className="text-label-l-emphasized text-on-surface mb-2">个人简介</h3>
              <div className="text-body-m text-on-surface-variant bg-surface-container-low p-4 rounded-md whitespace-pre-wrap popover-scrollbar max-h-40 overflow-y-auto">
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
              className={buttonClasses({ variant: 'tonal', className: 'flex-1' })}
            >
              <MdOpenInNew size={18} />在 Derpibooru 查看主页
            </a>
          </div>

          {/* ===== Uploads Tab ===== */}
          <div className="mt-10">
            <SectionHeading
              icon={<MdImage size={20} />}
              aside={
                uploadsTotal > 0 ? `（共 ${uploadsTotal.toLocaleString()} 张）` : undefined
              }
            >
              最近上传
            </SectionHeading>

            {isUploadsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : uploads.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                  {uploads.map((img) => {
                    const thumbUrl =
                      img.representations?.small || img.representations?.thumb || img.view_url;
                    return (
                      /* A `<button>`, not a `<div onClick>`: an image grid is
                         navigation, and this one could not be reached by keyboard
                         at all. (`/user/[id]` uses a `<Link>` for the same grid;
                         here the handler resolves the target id first, so a button
                         is the honest element.)

                         `rounded-lg` (16dp) is the grid-tile step from the shape
                         table — and the one pinned to `HERO_TARGET_RADIUS_PX`, so a
                         tile at 12dp did not match the corner the flight lands on.

                         The caption and score reveal on `sm` and up only. They were
                         `opacity-0 group-hover:opacity-100`, and there is no hover
                         on a touch device — so on the majority viewport the image id
                         and score never appeared at all. */
                      <button
                        type="button"
                        key={img.id}
                        onClick={() => handleUploadClick(img.id)}
                        aria-label={img.name || `图片 #${img.id}`}
                        className="group relative aspect-square w-full cursor-pointer overflow-hidden rounded-lg bg-surface-container-high outline-none focus-visible:ring-2 focus-ring"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic derpi thumbnail */}
                        <img
                          src={thumbUrl}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-300 ease-[var(--ease-standard)] group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                          loading="lazy"
                        />
                        <div className="media-hover-scrim absolute inset-0" />
                        <div className="media-caption-gradient absolute bottom-0 left-0 right-0 p-2 opacity-100 transition-opacity duration-300 ease-[var(--ease-standard)] sm:opacity-0 sm:group-hover:opacity-100">
                          <span className="text-on-media text-label-m">#{img.id}</span>
                        </div>
                        {img.score !== undefined && (
                          /* `Badge tone="media"`, not an inline span naming the
                             plate/ink pair by hand — the same object as every
                             other mark in the app, in the one tone that is
                             legible on a photograph. */
                          <Badge
                            tone="media"
                            icon={<MdStar size={14} />}
                            className="absolute top-2 right-2 opacity-100 transition-opacity duration-300 ease-[var(--ease-standard)] sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            {img.score}
                          </Badge>
                        )}
                      </button>
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
              <EmptyState
                size="pane"
                icon={<MdImage size={48} />}
                title="暂无上传"
                description="该用户尚未上传任何图片"
              />
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
