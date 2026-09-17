'use client';

import { use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  MdImage,
  MdSearch,
  MdOpenInNew,
  MdUpload,
  MdChatBubbleOutline,
  MdEdit,
} from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { derpiUserProfile, derpiUserUploads } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import Avatar from '@/components/Avatar';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import PageBack from '@/components/PageBack';
import { useEscapeBack, useStoredValue } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';
import { parseContentFilter } from '@/lib/searchQuery';
import EmptyState from '@/components/EmptyState';
import Button, { buttonClasses } from '@/components/Button';
import SectionHeading from '@/components/SectionHeading';
import { ICON } from '@/lib/icons';

const PER_PAGE = 24;

function ProfileStats({
  loading = false,
  uploads = 0,
  comments = 0,
  posts = 0,
}: {
  loading?: boolean;
  uploads?: number;
  comments?: number;
  posts?: number;
}) {
  const stats = [
    { label: '上传', icon: MdUpload, value: uploads },
    { label: '评论', icon: MdChatBubbleOutline, value: comments },
    { label: '发帖', icon: MdEdit, value: posts },
  ];

  return (
    <Card padding="sm" className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-m">
      {stats.map(({ label, icon: Icon, value }) => (
        <div key={label} className="flex items-center gap-1.5 text-on-surface-variant">
          <Icon size={ICON.dense} />
          {loading ? (
            <Skeleton className="h-6 w-[1ch] text-title-m" />
          ) : (
            <span className="text-title-m text-on-surface">{value.toLocaleString()}</span>
          )}
          <span>{label}</span>
        </div>
      ))}
    </Card>
  );
}

export default function DerpiUserPage({ params }: { params: Promise<{ id: string }> }) {
  // Page params belong to this segment even while an image overlays it.
  const { id: userId } = use(params);
  const contentFilter = parseContentFilter(useStoredValue(LS_KEYS.contentFilter, 'safe'));
  const scope = `${userId}:${contentFilter}`;

  // A filter change must adopt its own remembered page before starting a read.
  return <DerpiUserContent key={scope} scope={scope} userId={userId} contentFilter={contentFilter} />;
}

function DerpiUserContent({ userId, contentFilter, scope }: {
  userId: string;
  contentFilter: ReturnType<typeof parseContentFilter>;
  scope: string;
}) {
  const router = useRouter();
  const [uploadsPage, setUploadsPage] = useScreenStateFor('derpi-profile:uploads-page', scope, 1);
  const profileRead = useResource(derpiUserProfile, { id: userId });
  const profile = profileRead.data;
  const error = profileRead.error instanceof Error ? profileRead.error.message : '用户资料加载失败';
  const uploadsRead = useResource(
    derpiUserUploads,
    profile ? { id: profile.id, page: uploadsPage, perPage: PER_PAGE, contentFilter } : SKIP,
    { keepPrevious: scope },
  );
  const uploads = uploadsRead.data?.images ?? [];
  const uploadsTotal = uploadsRead.data?.total ?? 0;
  const uploadsError = uploadsRead.error instanceof Error ? uploadsRead.error.message : '上传记录加载失败';
  const totalPages = Math.ceil(uploadsTotal / PER_PAGE);

  // --- Loading skeleton ---
  /* Not a sidebar destination, so it carries the shared back affordance — see
     the rule in AGENTS.md. Drawn in all three states, which is what makes the
     error branch's claim below true: it dropped its own 返回上一页 button on the
     strength of "the leading back affordance is already chrome on this route",
     and until now this route never rendered one — so a Derpibooru profile that
     failed to load had no way out at all. */
  const handleBack = useCallback(() => router.back(), [router]);
  useEscapeBack(handleBack);

  if (profile === undefined && profileRead.error === undefined) {
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div>
        <div className="@container max-w-5xl mx-auto">
          <div className="pb-8 pt-14">
            <div className="flex items-center gap-4">
              <Skeleton className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-surface shrink-0" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-8 w-1/3 sm:h-9" />
                <p className="mt-1 text-body-m text-on-surface-variant">Derpibooru 用户</p>
              </div>
            </div>
            <ProfileStats loading />
            <div className="mt-6 flex flex-col gap-3 @lg:flex-row">
              <Skeleton className="h-14 @lg:flex-1 rounded-full" />
              <Skeleton className="h-14 @lg:flex-1 rounded-full" />
            </div>
            <div className="mt-10">
              <SectionHeading icon={<MdImage size={ICON.control} />}>最近上传</SectionHeading>
              <ImageGridSkeleton count={PER_PAGE} />
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  // --- Error state ---
  if (!profile) {
    /* One action, and it is the one this screen alone can offer — the source
       profile on Derpibooru. 返回上一页 is dropped because the leading back
       affordance is already chrome on this route, the same call the forum
       thread's error state makes. */
    return (
      <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      {/* `ErrorRetry`, not `StatusView` directly: it re-typed the preset's glyph and
          its default title because `ErrorRetry` took only `onRetry`, and it has an
          `action` slot now.
          `fill`, the third and last screen that takes it. `PageBack` portals out to a
          slot beside the scroller, so this block is the route's entire content — the
          same case as the 404 and the error boundary, and the three should land in the
          same place rather than one being centred and two sitting high. */}
      <ErrorRetry
        fill
        message={error}
        onRetry={profileRead.refresh}
        action={
          userId && (
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(userId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'filled' })}
            >
              <MdOpenInNew /><span className="min-w-0 truncate">在 Derpibooru 查看</span>
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
      {/* No entrance animation. The route transition already fades this page in
          (`playRouteCrossFade`, 400ms `decelerate`); an `animate-fade-in` here was a
          second 400ms fade nested inside the first, i.e. the arrival happening twice
          on two clocks. Only two routes in the app did this. */}
      <div>
      {/* ===== Main Content ===== */}
      <div className="@container max-w-5xl mx-auto">
        <div className="pb-8 pt-14">
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
                size="hero"
                className="border-4 border-surface"
              />
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-headline-s sm:text-headline-m text-on-surface flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="min-w-0 max-w-full wrap-anywhere">{profile.name}</span>
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
                  /* The `alt` carries the award's name. It was `alt=""` with the
                     name in a `title`, and `alt=""` marks an image presentational —
                     so it leaves the accessibility tree entirely and a `title` on it
                     is ignored. The image *is* the content here. */
                  // eslint-disable-next-line @next/next/no-img-element -- remote badge image
                  <img
                    key={i}
                    src={badgeUrl}
                    className="h-8 rounded-xs"
                    alt={award.title || '勋章'}
                  />
                ) : null;
              })}
            </div>
          )}

          {/* Stats row */}
          <ProfileStats
            uploads={profile.uploads_count}
            comments={profile.comments_count}
            posts={profile.posts_count}
          />

          {/* Description */}
          {profile.description && (
            <div className="mt-6">
              <SectionHeading as="h3" className="mb-2">个人简介</SectionHeading>
              <Card className="text-body-m text-on-surface-variant whitespace-pre-wrap wrap-anywhere popover-scrollbar max-h-40 overflow-y-auto">
                {profile.description}
              </Card>
            </div>
          )}

          {/* The sidebar can leave less than half a tablet's width for this page.
              Pair the actions only once their own container can hold both labels. */}
          <div className="flex flex-col @lg:flex-row gap-3 mt-6">
            <Button
              onClick={() => router.push(`/search?q=${encodeURIComponent(uploaderQuery)}`, { scroll: false })}
              variant="filled"
              size="lg"
              className="@lg:flex-1"
              icon={<MdSearch />}
            >
              搜搜 TA 的所有作品
            </Button>
            <a
              href={`https://derpibooru.org/profiles/${encodeURIComponent(profile.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'tonal', size: 'lg', className: '@lg:flex-1' })}
            >
              <MdOpenInNew /><span className="min-w-0 truncate">在 Derpibooru 查看主页</span>
            </a>
          </div>

          {/* ===== Uploads Tab ===== */}
          <div className="mt-10">
            <SectionHeading
              icon={<MdImage size={ICON.control} />}
              aside={
                uploadsTotal > 0 ? `（共 ${uploadsTotal.toLocaleString()} 张）` : undefined
              }
            >
              最近上传
            </SectionHeading>

            {Boolean(uploadsRead.error) && <ErrorRetry size="inline" title={uploadsError} onRetry={uploadsRead.refresh} />}
            {uploadsRead.data === undefined && uploadsRead.error === undefined ? (
              <ImageGridSkeleton count={PER_PAGE} />
            ) : uploads.length > 0 ? (
              /* The anchor wraps the grid *and* its pager: `Pagination` reaches it with
                 `closest()`, so one that sits beside the pager is one it cannot see. */
              <div data-pagination-anchor aria-busy={uploadsRead.isLoading}>
                <MasonryGrid images={uploads} />

                {totalPages > 1 && (
                  <Pagination
                    currentPage={uploadsPage}
                    totalPages={totalPages}
                    onPageChange={setUploadsPage}
                  />
                )}
              </div>
            ) : !uploadsRead.error ? (
              <EmptyState
                size="pane"
                icon={<MdImage size={ICON.display} />}
                title="暂无上传"
                description="该用户尚未上传任何图片"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
