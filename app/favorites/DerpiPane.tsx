'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdCloudUpload, MdKey, MdStarBorder } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { derpiFaves, faveFolders, sessionUser } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { createPagedSequence } from '@/lib/imageSequence';
import { useListReveal } from '@/lib/listReveal';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { LOOKUP_LIMIT } from '@/lib/api/favorites';
import { freshIndex, importFavourites } from '@/lib/favoritesActions';
import { resolveDefaultFolder, settled } from '@/lib/favorites';
import { useSyncedSetting } from '@/lib/settingsSync';
import { readToken } from '@/lib/hooks';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import FailedTurnHold from '@/components/FailedTurnHold';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import MasonryGrid from '@/components/MasonryGrid';
import Pagination from '@/components/Pagination';
import { showToast } from '@/components/Toast';
import { WithheldNotice, useDeviceRules } from '@/components/favorites/FaveGrid';
import ImportDialog from '@/components/favorites/ImportDialog';
import { completeProgress, progressLanding, runSummary, type ProgressState } from '@/components/favorites/ProgressDialog';
import { settingsHref } from '@/app/settings/tabs';

/** Derpibooru's own page size: one search a page. */
const PER_PAGE = LOOKUP_LIMIT;

/** 已导入 12 张，1 张失败 — and when nothing went in, the backend's own refusal. */
function importSentence(
  result: { imported: number[]; failed: { error: unknown }[] },
  stopped: boolean,
): [string, 'success' | 'warning' | 'error'] {
  const failed = result.failed.length;
  if (failed > 0 && result.imported.length === 0) return [apiErrorMessage(result.failed[0].error, '导入失败'), 'error'];
  const text = `${stopped ? '已停止，' : ''}已导入 ${result.imported.length} 张${failed > 0 ? `，${failed} 张失败` : ''}`;
  return [text, failed > 0 ? 'warning' : 'success'];
}

/**
 * Derpibooru — the account's favourites on Derpibooru itself (`my:faves`, read with its API key),
 * through the device's content settings like every list here (C11, R5-024): the page says how many
 * it withheld. A missing key is its own state, pointing at the binding in 账户.
 *
 * 导入本页到云端 is the original front end's import: the page's pictures that are not PicPony
 * favourites yet, after a confirm with the count, into the default folder or a chosen one, one at
 * a time and spaced as it spaced them, with progress and 停止 (`importFavourites`).
 */
export default function DerpiPane({ token, active }: { token: string; active: boolean }) {
  const router = useRouter();
  const session = useResource(sessionUser, { token });
  const key = session.data?.kind === 'ok' ? session.data.user.api_key : undefined;
  const apiKey = session.data ? (typeof key === 'string' && key ? key : null) : undefined;
  const [page, setPage] = useScreenStateFor('favorites:derpi', token, 1);
  const read = useResource(derpiFaves, apiKey ? { apiKey, page } : SKIP, { keepPrevious: apiKey ?? '' });
  const rules = useDeviceRules();

  const data = read.data;
  const shown = useMemo(() => (data ? rules.withhold(data.images, data.images.map((image) => image.id)) : undefined), [data, rules]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;

  const [dataPage, setDataPage] = useState(page);
  if (data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);

  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const listKey = `fave-derpi:${token}:${rules.fp}`;

  const readPage = useCallback(
    async (target: number) => {
      if (!apiKey) return [];
      const result = await derpiFaves.read({ apiKey, page: target });
      return rules.withhold(result.images, result.images.map((image) => image.id)).images.map((image) => image.id);
    },
    [apiKey, rules],
  );
  const reveal = useListReveal(readPage, page, setPage, () => pane);
  const images = shown?.images;
  const sequence = useMemo(
    () =>
      apiKey && images && images.length > 0
        ? createPagedSequence({
            key: listKey,
            page: dataPage,
            current: { ids: images.map((image) => image.id), previews: images, totalPages },
            pageSize: PER_PAGE,
            fetchPage: async (target) => {
              const result = await derpiFaves.read({ apiKey, page: target });
              const kept = rules.withhold(result.images, result.images.map((image) => image.id)).images;
              return { ids: kept.map((image) => image.id), previews: kept, totalPages: Math.max(1, Math.ceil(result.total / PER_PAGE)) };
            },
            reveal,
          })
        : undefined,
    [apiKey, images, dataPage, totalPages, listKey, rules, reveal],
  );

  /* ---- 导入本页到云端 ---- */
  const folderRead = useResource(faveFolders, active ? { token } : SKIP);
  const folders = folderRead.data?.folders ?? [];
  const stored = useSyncedSetting('defaultFaveFolder');
  const [importIds, setImportIds] = useState<number[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => { run.current?.abort(); }, []);

  const startImport = async () => {
    if (!images || checking || progress) return;
    setChecking(true);
    const outcome = await settled(freshIndex(token));
    setChecking(false);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, '收藏读取失败'), 'error');
      return;
    }
    const known = new Set(outcome.value.ids);
    const missing = images.map((image) => image.id).filter((id) => !known.has(id));
    if (missing.length === 0) showToast('本页的图片都已收藏到云端', 'info');
    else setImportIds(missing);
  };

  /* The confirm turns into the run in place (`ImportDialog`, M1-010); the dialog closes once the
     run is over — after its meter has landed, when it went to the end (M1-007). */
  const runImport = async (folderId: number) => {
    const ids = importIds ?? [];
    if (ids.length === 0 || run.current) {
      setImportIds(null);
      return;
    }
    const controller = new AbortController();
    run.current = controller;
    setProgress({ title: '正在导入到云端收藏', detail: '正在导入', done: 0, total: ids.length });
    const outcome = await settled(
      importFavourites(token, ids, folderId, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress((current) => (current ? { ...current, done, total } : current)),
      }),
    );
    if (outcome.ok && !controller.signal.aborted) {
      setProgress(completeProgress(runSummary('已导入', outcome.value.imported.length, outcome.value.failed.length)));
      await progressLanding();
    }
    run.current = null;
    setImportIds(null);
    setProgress(null);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, '导入失败'), 'error');
      return;
    }
    showToast(...importSentence(outcome.value, controller.signal.aborted));
  };

  const defaultFolderId = folders.length > 0 ? resolveDefaultFolder(folders, stored).id : stored.id;

  if (apiKey === undefined) {
    if (session.error) {
      return (
        <ErrorRetry
          size="pane"
          title="账号信息加载失败"
          message={apiErrorMessage(session.error)}
          onRetry={isRetryable(session.error) ? session.refresh : undefined}
        />
      );
    }
    return <ImageGridSkeleton count={PER_PAGE} entrance={false} />;
  }
  if (apiKey === null) {
    return (
      <EmptyState
        size="pane"
        icon={<MdKey size={ICON.display} />}
        title="未绑定 API Key"
        description="绑定 Derpibooru 的 API Key 后，你在 Derpibooru 上的收藏会显示在这里"
        action={
          <Button variant="tonal" onClick={() => router.push(settingsHref('account'), { scroll: false })}>
            前往设置
          </Button>
        }
      />
    );
  }
  if (shown === undefined || data === undefined) {
    if (read.error) {
      return (
        <ErrorRetry
          size="pane"
          title="Derpibooru 收藏加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      );
    }
    return <ImageGridSkeleton count={PER_PAGE} entrance={false} />;
  }

  const failedTurn = read.isPrevious && Boolean(read.error);
  /* The paging dim, for a turn in flight only: a refresh of the page on screen is not one. */
  const turning = read.isPrevious && read.isLoading;
  return (
    <div ref={setPane} aria-busy={read.isLoading || undefined} data-pagination-anchor="">
      <div className="mb-4 flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-body-m text-on-surface-variant tabular-nums">共 {formatCount(data.total)} 张</p>
        {shown.images.length > 0 && (
          <Button variant="tonal" icon={<MdCloudUpload />} loading={checking} onClick={() => void startImport()}>
            导入本页到云端
          </Button>
        )}
      </div>
      <WithheldNotice filtered={shown.filtered} missing={0} />
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
      {shown.images.length === 0 && !read.isPrevious ? (
        shown.filtered > 0 ? (
          <EmptyState size="pane" title="本页没有可显示的图片" />
        ) : (
          <EmptyState
            size="pane"
            icon={<MdStarBorder size={ICON.display} />}
            title="Derpibooru 上还没有收藏"
            description="在 Derpibooru 上收藏的图片会显示在这里"
          />
        )
      ) : (
        <div
          ref={setRows}
          className={`transition-opacity duration-standard ease-[var(--ease-standard)] ${
            turning ? 'pointer-events-none opacity-50' : 'opacity-100'
          }`}
        >
          <MasonryGrid images={shown.images} entrance={false} sequence={sequence} listKey={listKey} />
        </div>
      )}
      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onPrefetchPage={(next) => derpiFaves.prefetch({ apiKey, page: next })}
          disabled={turning}
          className="mt-8 mb-4"
        />
      )}
      <FailedTurnHold failed={failedTurn} rows={rows} failure={failureRef} />
      <ImportDialog
        open={importIds !== null}
        count={importIds?.length ?? 0}
        folders={folders}
        loading={folderRead.data === undefined && !folderRead.error}
        error={folderRead.data === undefined ? folderRead.error : undefined}
        onRetry={isRetryable(folderRead.error) ? folderRead.refresh : undefined}
        defaultFolderId={defaultFolderId}
        progress={progress}
        onStop={() => {
          run.current?.abort();
          setProgress((current) => (current ? { ...current, stopping: true } : current));
        }}
        onClose={() => setImportIds(null)}
        onConfirm={(folderId) => void runImport(folderId)}
      />
    </div>
  );
}
