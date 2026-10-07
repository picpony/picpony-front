'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MdImage, MdSearch, MdSettings } from 'react-icons/md';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import FailedTurnHold from '@/components/FailedTurnHold';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MasonryGrid from '@/components/MasonryGrid';
import PageBack from '@/components/PageBack';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import { buttonClasses } from '@/components/buttonStyles';
import FollowHeight from '@/components/FollowHeight';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { normaliseTagName } from '@/lib/api/tagSubscriptions';
import { useBackOrParent } from '@/lib/backNavigation';
import { formatCount } from '@/lib/format';
import { useEscapeBack, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { createPagedSequence } from '@/lib/imageSequence';
import { useListReveal } from '@/lib/listReveal';
import { SKIP, useResource } from '@/lib/resource';
import { tagGallery, tagSubscriptions, useBrowsingFingerprint } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { cn } from '@/lib/utils';
import { findSubscription, markSubscriptionSeen } from './actions';
import { SUBSCRIPTION_PER_PAGE, subscriptionPages } from './href';
import NameFade from './NameFade';
import SubscribeButton from './SubscribeButton';
import { useTagNames } from './useTagNames';

/** A page of the gallery: the grid's page size. */
const PER_PAGE = SUBSCRIPTION_PER_PAGE;

/**
 * One subscription opened: the tag's pictures, newest first, as the ordinary gallery
 * (`MasonryGrid`, its pages a `createPagedSequence` source so 上一张 / 下一张 cross them), inside the
 * viewer's content settings like every other list.
 *
 * **Opening it marks its new pictures seen** (`mark_tag_subscription_seen`, as the original front
 * end did on opening one), and the count it had is kept for this visit, so the line above the
 * pictures still says how many arrived while the drawer and the list already read 0. Newest first
 * is what makes the new ones lead: the backend counts a tag's pictures, not which ones are new,
 * so the line says how many, and the order shows them.
 *
 * It answers for any tag, subscribed or not — a notification's link can outlive its subscription
 * — and 订阅 / 已订阅 sits in the header either way.
 */
export default function SubscriptionView({ tag, contentFilter }: { tag: string; contentFilter: string }) {
  const { token, ready } = useSession();
  const back = useBackOrParent('/subscriptions');
  useEscapeBack(back);
  const scope = normaliseTagName(tag);
  const list = useResource(tagSubscriptions, token ? { token } : SKIP);
  const subscription = findSubscription(list.data, tag);
  const nameOf = useTagNames(tag ? [tag] : []);
  /* The Chinese name, `null` for none, `undefined` while the dictionary is still asked. */
  const chinese = nameOf(tag);
  const tagName = subscription?.tagName ?? tag;
  const title = chinese ?? tagName;
  useDocumentTitle(tag ? `${title} - 标签订阅 - PicPony` : null);

  /* What arrived since the last visit, kept for this one: marking seen sets the account's count
     to 0 at once, and the line above the pictures must not lose it while they are looked at. */
  const [arrived, setArrived] = useScreenStateFor<number | null>('subscription:arrived', scope, null);
  const pending = token && subscription && subscription.newCount > 0 ? subscription : null;
  useEffect(() => {
    if (!token || !pending) return;
    setArrived(pending.newCount);
    markSubscriptionSeen(token, pending.tagName);
  }, [token, pending, setArrived]);

  const fp = useBrowsingFingerprint();
  const [page, setPage] = useScreenStateFor('subscription:page', `${scope}\n${contentFilter}`, 1);
  const read = useResource(
    tagGallery,
    ready && tag ? { tag, page, perPage: PER_PAGE, contentFilter, fp } : SKIP,
    { keepPrevious: `${scope}\n${contentFilter}\n${fp}` },
  );

  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const [dataPage, setDataPage] = useState(page);
  if (read.data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);

  const listKey = `subscription:${scope}:${contentFilter}:${fp}`;
  const readPage = useCallback(
    async (target: number) =>
      (await tagGallery.read({ tag, page: target, perPage: PER_PAGE, contentFilter, fp })).images.map((image) => image.id),
    [tag, contentFilter, fp],
  );
  const reveal = useListReveal(readPage, page, setPage, () => grid);
  const images = read.data?.images;
  const total = read.data?.total ?? 0;
  const totalPages = subscriptionPages(total);
  const sequence = useMemo(
    () =>
      images && images.length > 0
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: images.map((image) => image.id), previews: images, totalPages },
            pageSize: PER_PAGE,
            fetchPage: async (target) => {
              const result = await tagGallery.read({ tag, page: target, perPage: PER_PAGE, contentFilter, fp });
              return {
                ids: result.images.map((image) => image.id),
                previews: result.images,
                totalPages: subscriptionPages(result.total),
              };
            },
            reveal,
          })
        : undefined,
    [images, listKey, dataPage, totalPages, tag, contentFilter, fp, reveal],
  );

  /* The line under the heading: what the subscription knows, or that there is none. */
  let status: React.ReactNode;
  if (!ready || (token && list.data === undefined && list.error === undefined)) {
    /* Inline, inside the line it stands in for, so the line keeps its own height. */
    status = <Skeleton className="inline-block h-4 w-48 align-middle" />;
  } else if (subscription) {
    const fresh = arrived ?? subscription.newCount;
    status = fresh > 0
      ? `自上次查看新增 ${formatCount(fresh)} 张 · 记录 ${formatCount(subscription.imageCount)} 张`
      : `暂无新图片 · 记录 ${formatCount(subscription.imageCount)} 张`;
  } else {
    status = token ? '未订阅此标签，订阅后有新图片时会通知你' : '登录并订阅后，有新图片时会通知你';
  }

  const failedTurn = read.isPrevious && Boolean(read.error);
  let gallery: React.ReactNode;
  if (read.data === undefined) {
    gallery = read.error ? (
      <ErrorRetry
        size="pane"
        title="图片加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    ) : (
      <div data-page-loading>
        <ImageGridSkeleton count={PER_PAGE} />
      </div>
    );
  } else if (read.data.images.length === 0 && !read.isPrevious) {
    gallery =
      page > 1 ? (
        <EmptyState
          size="pane"
          title="这一页没有图片"
          action={<Button variant="tonal" onClick={() => setPage(1)}>回到第一页</Button>}
        />
      ) : (
        <EmptyState
          size="pane"
          icon={<MdImage size={ICON.display} />}
          title="暂无可显示的图片"
          description="此标签下没有图片，或者都在当前的内容筛选设置之外"
          action={
            <Link scroll={false} href="/settings" className={buttonClasses({ variant: 'tonal' })}>
              <MdSettings aria-hidden="true" />
              前往设置
            </Link>
          }
        />
      );
  } else {
    gallery = (
      /* The anchor wraps the grid *and* its pager: `Pagination` reaches it with `closest()`. */
      <div ref={setGrid} data-pagination-anchor aria-busy={read.isLoading || undefined}>
        {failedTurn && (
          <div ref={failureRef} className="mb-4">
            <ErrorRetry
              size="inline"
              title={`第 ${page} 页加载失败`}
              message={apiErrorMessage(read.error)}
              onRetry={isRetryable(read.error) ? read.refresh : undefined}
            />
          </div>
        )}
        <div
          ref={setRows}
          className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
            read.isLoading ? 'pointer-events-none opacity-50' : 'opacity-100'
          }`}
        >
          <MasonryGrid images={read.data.images} sequence={sequence} listKey={listKey} />
        </div>
        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            onPrefetchPage={(next) => tagGallery.prefetch({ tag, page: next, perPage: PER_PAGE, contentFilter, fp })}
            disabled={read.isLoading}
          />
        )}
        <FailedTurnHold failed={failedTurn} rows={rows} failure={failureRef} />
      </div>
    );
  }

  return (
    <>
      <PageBack onClick={back} />
      <div className="@container mx-auto w-full max-w-7xl page-back-room-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {/* The heading always holds text (it names the page), so while the dictionary is asked
              it is the tag itself, and the line under it — where the tag goes once a Chinese name
              takes the heading — is held open, so a name arriving moves nothing below it; the name
              then fades in over the tag. When the answer is that there is no name (a cold visit:
              arriving from the list, the answer is already cached), the held line goes, and the
              block's height follows rather than pulling the pictures up a line in a frame. */}
          <FollowHeight
            className="min-w-0 flex-auto"
            watch={`${chinese === undefined ? 'asking' : chinese === null ? 'none' : 'named'}|${typeof status === 'string' ? status : ''}`}
          >
            <h1 className="text-headline-s wrap-anywhere text-on-surface">
              <NameFade name={title}>{title}</NameFade>
            </h1>
            {chinese !== null && (
              <p className="mt-0.5 text-body-m text-on-surface-variant wrap-anywhere">
                {/* Held open by the very text it will show, unseen, so it is exactly that tall. */}
                <NameFade name={chinese === undefined ? undefined : tagName}>
                  <span aria-hidden={chinese === undefined || undefined} className={cn(chinese === undefined && 'invisible')}>
                    {tagName}
                  </span>
                </NameFade>
              </p>
            )}
            {/* A block rather than a paragraph: while the list loads it holds a placeholder. */}
            <div className="mt-1 text-body-m text-on-surface-variant tabular-nums">{status}</div>
          </FollowHeight>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              scroll={false}
              href={`/search?q=${encodeURIComponent(tagName)}`}
              className={buttonClasses({ variant: 'text' })}
            >
              <MdSearch aria-hidden="true" />
              在搜索中查看
            </Link>
            <SubscribeButton tag={tagName} />
          </div>
        </div>
        {gallery}
      </div>
    </>
  );
}
