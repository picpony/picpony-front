'use client';

import { use, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  MdChatBubbleOutline,
  MdEdit,
  MdHome,
  MdImage,
  MdOpenInNew,
  MdPersonOff,
  MdSearch,
  MdUpload,
} from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { derpiUserProfile, derpiUserUploads, useBrowsingFingerprint } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { createPagedSequence } from '@/lib/imageSequence';
import { useListReveal } from '@/lib/listReveal';
import { apiErrorMessage, isNotFound, isRetryable } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import { useEscapeBack, useStoredValue } from '@/lib/hooks';
import { useBackOrParent } from '@/lib/backNavigation';
import { LS_KEYS } from '@/lib/constants';
import { parseContentFilter } from '@/lib/searchQuery';
import { ICON } from '@/lib/icons';
import type { DerpiProfileAward, DerpiProfileUser } from '@/lib/types/user';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import Avatar from '@/components/Avatar';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import FailedTurnHold from '@/components/FailedTurnHold';
import PageBack from '@/components/PageBack';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import { useTooltip } from '@/components/Tooltip';
import DerpiDescription from './DerpiDescription';
import { derpiFallbackUrl, derpiProfileUrl } from './derpiLinks';

const PER_PAGE = 24;

function ProfileStats({ profile }: { profile: DerpiProfileUser | undefined }) {
  const stats = [
    { label: '上传', icon: MdUpload, value: profile?.uploads_count },
    { label: '评论', icon: MdChatBubbleOutline, value: profile?.comments_count },
    { label: '发帖', icon: MdEdit, value: profile?.posts_count },
  ];
  return (
    <Card padding="sm" className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-m">
      {stats.map(({ label, icon: Icon, value }) => (
        <div key={label} className="flex items-center gap-1.5 text-on-surface-variant">
          <Icon size={ICON.dense} aria-hidden="true" />
          {profile ? (
            <span className="text-title-m tabular-nums text-on-surface">{formatCount(value)}</span>
          ) : (
            <Skeleton className="h-6 w-[1ch] text-title-m" />
          )}
          <span>{label}</span>
        </div>
      ))}
    </Card>
  );
}

/**
 * One award: its picture is the content, so its name is its `alt`; the tooltip shows the name and
 * Derpibooru's label beside it to a pointer or a long press (R7-022 — forty pictures with no
 * visible name).
 */
function Award({ award }: { award: DerpiProfileAward }) {
  const src = award.image_url || award.badge_url || award.url || award.image;
  const title = award.title || '勋章';
  const label = typeof award.label === 'string' ? award.label.trim() : '';
  const { anchorRef, anchorProps, tooltip } = useTooltip(label ? `${title} · ${label}` : title);
  if (!src) return null;
  return (
    <li className="flex">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote award artwork, an SVG off the optimizer's whitelist */}
      <img
        ref={anchorRef as React.RefObject<HTMLImageElement | null>}
        {...anchorProps}
        src={src}
        alt={title}
        className="h-8 rounded-xs"
      />
      {tooltip}
    </li>
  );
}

export default function DerpiUserPage({ params }: { params: Promise<{ id: string }> }) {
  /* Page params belong to this segment even while an image overlays it. */
  const { id: userId } = use(params);
  const contentFilter = parseContentFilter(useStoredValue(LS_KEYS.contentFilter, 'safe'));
  const scope = `${userId}:${contentFilter}`;

  /* A filter change must adopt its own remembered page before starting a read. */
  return <DerpiUserContent key={scope} scope={scope} userId={userId} contentFilter={contentFilter} />;
}

/**
 * A Derpibooru account inside the app — `/derpi/user/[id]`, reached from an uploader link or a
 * PicPony profile's bound account.
 *
 * Every state carries the back affordance and an `<h1>` (R3-042): the loading header draws its
 * placeholders around the same heading the loaded one fills in. An account that does not exist is
 * the not-found state with no 重试; a failure says why and offers 重试 when it could help.
 *
 * The uploads are the account's `uploader_id:` search inside the viewer's content settings, so
 * their count is labelled as the filtered one beside the account's own total (R7-022). A numeric
 * route id is the account id, and the grid's read starts beside the profile's rather than after it.
 */
function DerpiUserContent({ userId, contentFilter, scope }: {
  userId: string;
  contentFilter: ReturnType<typeof parseContentFilter>;
  scope: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const descriptionId = useId();
  const [uploadsPage, setUploadsPage] = useScreenStateFor('derpi-profile:uploads-page', scope, 1);
  const profileRead = useResource(derpiUserProfile, { id: userId });
  const profile = profileRead.data;
  const numericId = /^[1-9]\d{0,15}$/.test(userId) ? Number(userId) : null;
  const accountId = profile?.id ?? numericId;
  const missing = profile === undefined && profileRead.error !== undefined;

  /* The viewer's exclusions wrap the uploader query, so they are part of the key; retention is
     scoped to them for the same reason the home feed's is. */
  const fp = useBrowsingFingerprint();
  const uploadsRead = useResource(
    derpiUserUploads,
    accountId !== null && !missing ? { id: accountId, page: uploadsPage, perPage: PER_PAGE, contentFilter, fp } : SKIP,
    { keepPrevious: `${scope}\n${fp}` },
  );

  const handleBack = useBackOrParent('/');
  useEscapeBack(handleBack);

  /* The name, once it is known — the route's metadata could only name the account by number. Re-
     applied when the route is in the foreground again (an image opened over it names itself). */
  useEffect(() => {
    if (!profile || !pathname?.startsWith('/derpi/user/')) return;
    document.title = `${profile.name} - PicPony`;
  }, [profile, pathname]);

  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const [dataPage, setDataPage] = useState(uploadsPage);
  if (uploadsRead.data !== undefined && !uploadsRead.isPrevious && dataPage !== uploadsPage) setDataPage(uploadsPage);

  const listKey = `derpi-uploads:${accountId ?? userId}:${contentFilter}:${fp}`;
  const readPage = useCallback(
    async (target: number) =>
      accountId === null
        ? []
        : (await derpiUserUploads.read({ id: accountId, page: target, perPage: PER_PAGE, contentFilter, fp })).images.map((image) => image.id),
    [accountId, contentFilter, fp],
  );
  const reveal = useListReveal(readPage, uploadsPage, setUploadsPage, () => grid);
  const images = uploadsRead.data?.images;
  const total = uploadsRead.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const sequence = useMemo(
    () =>
      images && images.length > 0 && accountId !== null
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: images.map((image) => image.id), previews: images, totalPages },
            pageSize: PER_PAGE,
            fetchPage: async (target) => {
              const result = await derpiUserUploads.read({ id: accountId, page: target, perPage: PER_PAGE, contentFilter, fp });
              return {
                ids: result.images.map((image) => image.id),
                previews: result.images,
                totalPages: Math.max(1, Math.ceil(result.total / PER_PAGE)),
              };
            },
            reveal,
          })
        : undefined,
    [images, accountId, listKey, dataPage, totalPages, contentFilter, fp, reveal],
  );

  if (missing) {
    return (
      <>
        <PageBack onClick={handleBack} />
        {isNotFound(profileRead.error) ? (
          /* No 重试: no retry makes a missing account appear (R7-009's rule, both profiles). */
          <EmptyState
            fill
            icon={<MdPersonOff size={ICON.display} />}
            title="用户不存在"
            description="这个 Derpibooru 账户不存在，或者链接本来就不对。"
            action={
              <Link scroll={false} href="/" className={buttonClasses({ variant: 'filled' })}>
                <MdHome aria-hidden="true" />
                回到首页
              </Link>
            }
          />
        ) : (
          /* `fill`: this block is the route's whole content — `PageBack` portals out to a slot
             beside the scroller — so it lands where the 404 and the error boundary do. 重试
             when it could help; the original site otherwise. */
          <ErrorRetry
            fill
            title="用户资料加载失败"
            message={apiErrorMessage(profileRead.error)}
            onRetry={isRetryable(profileRead.error) ? profileRead.refresh : undefined}
            action={
              isRetryable(profileRead.error) ? undefined : (
                <a
                  href={derpiFallbackUrl(userId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ variant: 'filled' })}
                >
                  <MdOpenInNew aria-hidden="true" />
                  <span className="min-w-0 truncate">在 Derpibooru 查看</span>
                </a>
              )
            }
          />
        )}
      </>
    );
  }

  const avatarUrl = profile ? profile.avatar_url || profile.avatar : null;
  const awards = profile?.awards ?? [];
  const uploaderQuery = accountId !== null ? `uploader_id:${accountId}` : null;
  const failedTurn = uploadsRead.isPrevious && Boolean(uploadsRead.error);

  return (
    <>
      <PageBack onClick={handleBack} />
      {/* No entrance animation: the route transition already fades this page in. */}
      <div className="@container mx-auto max-w-5xl" data-page-loading={profile ? undefined : ''}>
        <div className="pb-8 page-back-room-5xl">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              {profile ? (
                /* The page's largest early paint: eager, at high priority (R1-028). */
                <Avatar src={avatarUrl} name={profile.name} size="hero" priority className="border-4 border-surface" />
              ) : (
                <Skeleton className="size-24 rounded-full border-4 border-surface sm:size-32" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* One heading for both states, so focus placed on it by a route change survives
                  the record landing. */}
              <h1
                className={
                  profile
                    ? 'text-headline-s sm:text-headline-m flex flex-wrap items-baseline gap-x-3 gap-y-1 text-on-surface'
                    : 'sr-only'
                }
              >
                {profile ? (
                  <>
                    <span className="min-w-0 max-w-full wrap-anywhere">{profile.name}</span>
                    <span className="text-body-m text-on-surface-variant">#{profile.id}</span>
                  </>
                ) : (
                  'Derpibooru 用户'
                )}
              </h1>
              {!profile && <Skeleton className="h-8 w-1/3 sm:h-9" />}
              <p className="mt-1 text-body-m text-on-surface-variant">Derpibooru 用户</p>
            </div>
          </div>

          {awards.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Derpibooru 勋章">
              {awards.map((award, index) => (
                <Award key={`${award.title ?? ''}-${index}`} award={award} />
              ))}
            </ul>
          )}

          <ProfileStats profile={profile} />

          {profile?.description ? (
            <section className="mt-6" aria-labelledby={`${descriptionId}-title`}>
              <SectionHeading as="h2" className="mb-2" id={`${descriptionId}-title`}>
                个人简介
              </SectionHeading>
              <DerpiDescription markdown={profile.description} id={`${descriptionId}-body`} />
            </section>
          ) : null}

          {/* The sidebar can leave less than half a tablet's width for this page.
              Pair the actions only once their own container can hold both labels. */}
          <div className="mt-6 flex flex-col gap-3 @lg:flex-row">
            {profile ? (
              <>
                <Button
                  onClick={() => uploaderQuery && router.push(`/search?q=${encodeURIComponent(uploaderQuery)}`, { scroll: false })}
                  variant="filled"
                  size="lg"
                  className="@lg:flex-1"
                  icon={<MdSearch />}
                >
                  搜索 TA 的作品
                </Button>
                <a
                  href={derpiProfileUrl(profile)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ variant: 'tonal', size: 'lg', className: '@lg:flex-1' })}
                >
                  <MdOpenInNew aria-hidden="true" />
                  <span className="min-w-0 truncate">在 Derpibooru 查看主页</span>
                </a>
              </>
            ) : (
              <>
                <Skeleton className="h-14 rounded-full @lg:flex-1" />
                <Skeleton className="h-14 rounded-full @lg:flex-1" />
              </>
            )}
          </div>

          <section className="mt-10">
            <SectionHeading
              icon={<MdImage size={ICON.control} />}
              aside={
                /* The account's own total is in the stats above; this one is what the viewer's
                   content settings leave of it. */
                uploadsRead.data && total > 0 ? `当前筛选下 ${formatCount(total)} 张` : undefined
              }
            >
              最近上传
            </SectionHeading>

            {uploadsRead.data === undefined ? (
              uploadsRead.error ? (
                <ErrorRetry
                  size="pane"
                  title="上传记录加载失败"
                  message={apiErrorMessage(uploadsRead.error)}
                  onRetry={isRetryable(uploadsRead.error) ? uploadsRead.refresh : undefined}
                />
              ) : (
                <ImageGridSkeleton count={PER_PAGE} />
              )
            ) : uploadsRead.data.images.length === 0 && !uploadsRead.isPrevious ? (
              uploadsPage > 1 ? (
                <EmptyState
                  size="pane"
                  title="这一页没有图片"
                  action={<Button variant="tonal" onClick={() => setUploadsPage(1)}>回到第一页</Button>}
                />
              ) : (
                <EmptyState
                  size="pane"
                  icon={<MdImage size={ICON.display} />}
                  title="暂无上传"
                  description={
                    (profile?.uploads_count ?? 0) > 0
                      ? '在当前的内容筛选设置下，该用户没有可显示的图片'
                      : '该用户尚未上传任何图片'
                  }
                />
              )
            ) : (
              /* The anchor wraps the grid *and* its pager: `Pagination` reaches it with
                 `closest()`, so one that sits beside the pager is one it cannot see. */
              <div ref={setGrid} data-pagination-anchor aria-busy={uploadsRead.isLoading || undefined}>
                {failedTurn && (
                  <div ref={failureRef} className="mb-4">
                    <ErrorRetry
                      size="inline"
                      title={`第 ${uploadsPage} 页加载失败`}
                      message={apiErrorMessage(uploadsRead.error)}
                      onRetry={isRetryable(uploadsRead.error) ? uploadsRead.refresh : undefined}
                    />
                  </div>
                )}
                <div
                  ref={setRows}
                  className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
                    uploadsRead.isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
                  }`}
                >
                  <MasonryGrid images={uploadsRead.data.images} sequence={sequence} listKey={listKey} />
                </div>
                {totalPages > 1 && (
                  <Pagination
                    currentPage={uploadsPage}
                    totalPages={totalPages}
                    onPageChange={setUploadsPage}
                    onPrefetchPage={(next) =>
                      accountId !== null &&
                      derpiUserUploads.prefetch({ id: accountId, page: next, perPage: PER_PAGE, contentFilter, fp })
                    }
                    disabled={uploadsRead.isLoading}
                  />
                )}
                <FailedTurnHold failed={failedTurn} rows={rows} failure={failureRef} />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
