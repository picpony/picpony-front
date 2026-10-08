'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MdCloudUpload, MdLinkOff, MdSearch, MdSettings, MdUpload } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { useBrowsingFingerprint, userUploads } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { createPagedSequence } from '@/lib/imageSequence';
import { useListReveal } from '@/lib/listReveal';
import { hiddenFromVisitors, tabVisible, uploaderTerm } from '@/lib/profiles';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import MasonryGrid from '@/components/MasonryGrid';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import FailedTurnHold from '@/components/FailedTurnHold';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import { OwnerHiddenNote, PaneFailure, PaneHidden, useVisited, type ProfilePaneProps } from './ProfilePaneStates';

/** A page of the grid — also `lib/prefetchRoute.ts`'s `PROFILE_PER_PAGE`, which warms page 1. */
export const UPLOADS_PER_PAGE = 12;

/**
 * 上传记录 — the bound Derpibooru account's uploads (decision 8: PicPony has no uploads action; the
 * original front end searched Derpibooru by the account, and so does `userUploads`).
 *
 * Every answer that is not a list is its own state rather than a failing tab: an account not
 * bound (the owner is told where to bind one), a tab the owner hides, a refusal, a page past the
 * end. The grid is the gallery's — `MasonryGrid`, its pages a `createPagedSequence` source so the
 * detail's 上一张 / 下一张 cross them, and the return flight turns this list to the picture's page.
 */
export default function UploadsPane({ profile, id, own, ready, active, token }: ProfilePaneProps) {
  const visited = useVisited(active);
  const fp = useBrowsingFingerprint();
  const [page, setPage] = useScreenStateFor('profile:uploads', id, 1);
  const visible = tabVisible(profile, 'uploads', own);
  /* Retention is scoped to the owner, the session and the viewer's exclusions: a page turn keeps
     its rows, a filter change never shows the rows it just asked to hide. */
  const read = useResource(
    userUploads,
    ready && visited && visible ? { id, page, perPage: UPLOADS_PER_PAGE, token, fp } : SKIP,
    { keepPrevious: `${id}\n${token ?? ''}\n${fp}` },
  );

  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);

  /* The page the rows on screen belong to: while a turn is in flight or has failed the rows are
     the previous page's (`isPrevious`), and 上一张 / 下一张 must walk the page they show. */
  const [dataPage, setDataPage] = useState(page);
  if (read.data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);

  const listKey = `profile-uploads:${id}:${fp}`;
  const readPage = useCallback(
    async (target: number) =>
      (await userUploads.read({ id, page: target, perPage: UPLOADS_PER_PAGE, token, fp })).uploads.map((image) => image.id),
    [id, token, fp],
  );
  const reveal = useListReveal(readPage, page, setPage, () => pane);
  const uploads = read.data?.uploads;
  const totalPages = read.data?.totalPages ?? null;
  const sequence = useMemo(
    () =>
      uploads && uploads.length > 0
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: uploads.map((image) => image.id), previews: uploads, totalPages },
            pageSize: UPLOADS_PER_PAGE,
            fetchPage: async (target) => {
              const result = await userUploads.read({ id, page: target, perPage: UPLOADS_PER_PAGE, token, fp });
              return { ids: result.uploads.map((image) => image.id), previews: result.uploads, totalPages: result.totalPages };
            },
            reveal,
          })
        : undefined,
    [uploads, dataPage, totalPages, listKey, id, token, fp, reveal],
  );

  if (!ready) return <ImageGridSkeleton count={UPLOADS_PER_PAGE} entrance={false} />;
  if (!visible) return <PaneHidden />;

  const data = read.data;
  if (data === undefined) {
    if (read.error) return <PaneFailure error={read.error} title="上传记录加载失败" onRetry={read.refresh} />;
    return <ImageGridSkeleton count={UPLOADS_PER_PAGE} entrance={false} />;
  }
  if (data.binding === 'hidden') return <PaneHidden />;
  if (data.binding === 'unbound') {
    return own ? (
      <EmptyState
        size="pane"
        icon={<MdLinkOff size={ICON.display} />}
        title="你还没有绑定 API Key"
        description="绑定 Derpibooru 的 API Key 后，你上传的作品会显示在这里"
        action={
          <Link scroll={false} href="/settings" className={buttonClasses({ variant: 'tonal' })}>
            <MdSettings aria-hidden="true" />
            前往设置
          </Link>
        }
      />
    ) : (
      <EmptyState
        size="pane"
        icon={<MdLinkOff size={ICON.display} />}
        title="该用户未绑定 API Key"
        description="绑定 Derpibooru 账户后，这里会显示 TA 上传的作品"
      />
    );
  }

  const failedTurn = read.isPrevious && Boolean(read.error);
  if (data.uploads.length === 0 && !read.isPrevious) {
    if (page > 1) {
      return (
        <EmptyState
          size="pane"
          title="这一页没有图片"
          action={<Button variant="tonal" onClick={() => setPage(1)}>回到第一页</Button>}
        />
      );
    }
    return own ? (
      <EmptyState
        size="pane"
        icon={<MdCloudUpload size={ICON.display} />}
        title="暂无上传记录"
        description="在当前的内容筛选设置下没有可显示的作品"
        action={
          <Link scroll={false} href="/upload" className={buttonClasses({ variant: 'tonal' })}>
            <MdUpload aria-hidden="true" />
            上传作品
          </Link>
        }
      />
    ) : (
      <EmptyState
        size="pane"
        icon={<MdCloudUpload size={ICON.display} />}
        title="暂无上传记录"
        description="在当前的内容筛选设置下，该用户没有可显示的作品"
      />
    );
  }

  const term = uploaderTerm(profile);
  return (
    <div ref={setPane} aria-busy={read.isLoading || undefined}>
      {own && hiddenFromVisitors(profile, 'uploads') && <OwnerHiddenNote tab="uploads" />}
      {/* The count is the viewer's: the search runs inside their content settings. The search
          link opens the same pictures in /search, where they can be sorted and filtered. */}
      <div className="mb-4 flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-body-m text-on-surface-variant tabular-nums">共 {formatCount(data.total)} 张</p>
        {term && (
          <Link
            scroll={false}
            href={`/search?q=${encodeURIComponent(term)}`}
            className={buttonClasses({ variant: 'text', size: 'xs' })}
          >
            <MdSearch aria-hidden="true" />
            {own ? '搜索我的作品' : '搜索 TA 的作品'}
          </Link>
        )}
      </div>
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
        {/* The pane already owns its entrance; the card still owns opening the image. */}
        <MasonryGrid images={data.uploads} entrance={false} sequence={sequence} listKey={listKey} />
      </div>
      {data.totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => userUploads.prefetch({ id, page: next, perPage: UPLOADS_PER_PAGE, token, fp })}
          disabled={read.isLoading}
          className="mt-8 mb-4"
        />
      )}
      <FailedTurnHold failed={failedTurn} rows={rows} failure={failureRef} />
    </div>
  );
}
