'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MdChecklist,
  MdDeselect,
  MdDownload,
  MdDriveFileMove,
  MdFileCopy,
  MdLock,
  MdPhotoLibrary,
  MdRemoveCircleOutline,
  MdSelectAll,
  MdSend,
} from 'react-icons/md';
import { useResource } from '@/lib/resource';
import { faveFolders, faveIds, useBrowsingFingerprint } from '@/lib/resources';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { FAVE_PAGE_SIZE, faveFolderHref, favoritesHref, folderLabel } from '@/lib/favorites';
import { useSelectionMode } from '@/lib/favoritesSelection';
import { useDefaultFaveFolder } from '@/lib/favoritesSettings';
import { useFolderPage } from '@/lib/folderTransit';
import { useBackOrParent } from '@/lib/backNavigation';
import { useEscapeBack, useSession } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { PonyImage } from '@/lib/types/image';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import SelectionBar, { type SelectionCommand } from '@/components/favorites/SelectionBar';
import { FolderBadges } from '@/components/favorites/FolderCard';
import { FaveGridView, useFavePage } from '@/components/favorites/FaveGrid';
import { FolderMenuButton, isFolderPublic, useFolderCommands } from '@/components/favorites/useFolderCommands';
import { usePictureBatch } from '@/components/favorites/usePictureBatch';
import { useAddressPage } from '@/components/favorites/useAddressPage';

/** The route's own shape while the session is unknown: the header, then the grid. */
function FolderSkeleton() {
  return (
    <div className="mx-auto max-w-7xl page-back-room-7xl" data-page-loading="">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>
      <ImageGridSkeleton count={FAVE_PAGE_SIZE} />
    </div>
  );
}

/**
 * One of your own folders — its pictures, a page of fifty at a time in the order they were
 * favourited, through the device's content settings (C11). The address names the folder and its
 * page (`/favorites/folder/<id>?page=<n>`), so a reload and Back land on it; Back from here
 * returns to the folder grid at its offset. 上一张 / 下一张 in the detail walk this folder.
 *
 * 选择 (or a long press on a picture, under a finger) turns the grid into the picture batch mode:
 * 全选, 移动到…, 复制到…, 移出收藏夹, 移入隐私空间, 下载 and 分享 (`usePictureBatch`). The folder's own
 * commands — 设为默认收藏夹, 在个人主页公开, 分享, 复制链接, 删除 — are its ⋮.
 *
 * Opened from its card, the page grows out of it, and Back shrinks it into it again
 * (`lib/folderTransit.ts`): the column is the container's far end. Its header is in its final
 * shape in the frame it mounts — the folder list the card was drawn from is the one read here.
 */
export default function FolderScreen({ folderId }: { folderId: number }) {
  const { ready, token } = useSession();
  const back = useBackOrParent(favoritesHref());

  if (!ready) {
    return (
      <>
        <PageBack onClick={back} />
        <FolderSkeleton />
      </>
    );
  }
  if (!token) {
    return (
      <>
        <PageBack onClick={back} />
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl">
          <SignInRequired description="登录后即可查看你的收藏夹" />
        </div>
      </>
    );
  }
  return <Folder key={token} folderId={folderId} token={token} back={back} />;
}

function Folder({ folderId, token, back }: { folderId: number; token: string; back: () => void }) {
  const router = useRouter();
  const route = faveFolderHref(folderId);
  const pageRef = useFolderPage(route);
  const list = useResource(faveFolders, { token });
  const index = useResource(faveIds, { token, folderId });
  const showPrivacy = useSyncedSetting('showPrivacyFaves');
  const folders = list.data?.folders;
  const folder = folders?.find((each) => each.id === folderId);
  const defaultFolder = useDefaultFaveFolder(token, folders);
  const commands = useFolderCommands({
    token,
    folders: folders ?? [],
    defaultFolder,
    onDeleted: () => router.replace(favoritesHref(), { scroll: false }),
  });
  useDocumentTitle(folder ? `${folderLabel(folder)} - 我的收藏 - PicPony` : null);

  const selectRef = useRef<HTMLButtonElement>(null);
  const ids = index.data?.ids;
  const listKey = `fave-folder:${token}:${folderId}`;
  const fp = useBrowsingFingerprint();

  /* The selection is of ids; the pictures behind them are every page the mode has seen, so a
     selection may run across a page turn. The page on screen is the order a Shift range runs
     through, and what 全选 selects. */
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [known, setKnown] = useState<ReadonlyMap<number, PonyImage>>(() => new Map());
  const selection = useSelectionMode({ order: pageOrder, restoreFocus: () => selectRef.current });
  const [page, setPage] = useAddressPage(route, selection.active);
  const state = useFavePage({ ids, page, setPage, listKey });
  const shown = state.shown?.images;
  const [seenShown, setSeenShown] = useState<PonyImage[] | undefined>(undefined);
  if (shown !== seenShown) {
    setSeenShown(shown);
    setPageOrder((shown ?? []).map((image) => image.id));
    if (shown?.length) {
      setKnown((current) => {
        const next = new Map(current);
        for (const image of shown) next.set(image.id, image);
        return next;
      });
    }
  }

  /* A page past the end — a stale link, the last page emptied — is the last page. */
  if (ids && page > state.totalPages) setPage(state.totalPages);

  useEscapeBack(back, !selection.active);

  const { exit, forget, enter } = selection;
  useEffect(() => {
    exit();
  }, [fp, exit]);
  useEffect(() => {
    if (ids) forget([...selection.selected].filter((id) => !ids.includes(id)));
  }, [ids, selection.selected, forget]);
  const settled = useCallback(
    (left: number[]) => {
      forget(left);
      exit();
    },
    [forget, exit],
  );
  const batch = usePictureBatch({ token, source: { kind: 'folder', folderId }, onSettled: settled });

  const gridSelection = useMemo(
    () => ({ active: selection.active, selected: selection.selected, onToggle: selection.toggle, onLongPress: enter }),
    [selection.active, selection.selected, selection.toggle, enter],
  );

  if (folders === undefined || (folder && ids === undefined && !index.error)) {
    if (list.error) {
      return (
        <>
          <PageBack onClick={back} />
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl">
            <ErrorRetry
              fill
              title="收藏夹加载失败"
              message={apiErrorMessage(list.error)}
              onRetry={isRetryable(list.error) ? list.refresh : undefined}
            />
          </div>
        </>
      );
    }
    if (!folders || !folder) {
      return (
        <>
          <PageBack onClick={back} />
          <FolderSkeleton />
        </>
      );
    }
  }

  if (!folder) {
    return (
      <>
        <PageBack onClick={back} />
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl">
          <EmptyState
            fill
            title="收藏夹不存在或已被删除"
            action={
              <Button variant="tonal" onClick={() => router.replace(favoritesHref(), { scroll: false })}>
                返回我的收藏
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const name = folderLabel(folder);
  const count = ids?.length ?? folder.itemCount;
  const selected = [...selection.selected].map((id) => known.get(id)).filter((image): image is PonyImage => Boolean(image));
  const pageIds = pageOrder;
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.selected.has(id));
  const none = selected.length === 0 || batch.busy;

  const barCommands: SelectionCommand[] = [
    {
      value: 'all',
      label: allSelected ? '取消全选' : '全选',
      icon: allSelected ? <MdDeselect /> : <MdSelectAll />,
      onSelect: () => selection.setMany(pageIds, !allSelected),
      disabled: pageIds.length === 0,
    },
    { value: 'move', label: '移动到…', icon: <MdDriveFileMove />, onSelect: () => batch.openTransfer('move', selected), disabled: none },
    { value: 'copy', label: '复制到…', icon: <MdFileCopy />, onSelect: () => batch.openTransfer('copy', selected), disabled: none },
    {
      value: 'remove',
      label: '移出收藏夹',
      icon: <MdRemoveCircleOutline />,
      destructive: true,
      onSelect: () => void batch.remove(selected),
      disabled: none,
    },
    ...(showPrivacy
      ? [{ value: 'privacy', label: '移入隐私空间', icon: <MdLock />, onSelect: () => void batch.toPrivacy(selected), disabled: none }]
      : []),
    { value: 'download', label: '下载', icon: <MdDownload />, onSelect: () => void batch.download(selected), disabled: none },
    {
      value: 'share',
      label: '分享',
      icon: <MdSend />,
      onSelect: () => selected[0] && batch.shareOne(selected[0]),
      disabled: selected.length !== 1 || batch.busy,
    },
  ];

  return (
    <>
      {/* **Mounted through the mode** (G3-004, M1-002). Taken away for it, the back affordance
          vanished in a frame and back in a frame, and the room the page keeps for it stood empty
          over a column that must not move under the long press that started the mode. In the
          mode it is still Back — which peels the mode first (decision 1) — and says so. */}
      <PageBack
        onClick={selection.active ? exit : back}
        label={selection.active ? '退出选择' : '返回我的收藏'}
      />
      <div ref={pageRef} data-folder-page={route} className="mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl">
        <PageHeader
          title={name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular-nums">共 {formatCount(count)} 张</span>
              <FolderBadges
                isDefault={folder.id === defaultFolder.id}
                isPublic={commands.showFaves && isFolderPublic(folder.id, commands.publicIds)}
              />
            </span>
          }
          actions={
            /* Out of the mode's way on the bar's own clock, never in one frame (M1-002). */
            <div
              inert={selection.active}
              className={cn('flex items-center gap-2 transition-opacity spring-fast-effects', selection.active && 'opacity-0')}
            >
              <Button ref={selectRef} variant="text" icon={<MdChecklist />} onClick={() => enter()} disabled={count === 0}>
                选择
              </Button>
              <FolderMenuButton
                folder={folder}
                items={commands.itemsFor(folder)}
                onSelect={(command) => void commands.run(folder, command)}
              />
            </div>
          }
        />
        {Boolean(index.error) && ids !== undefined && <ErrorRetry size="inline" title="收藏更新失败" message={apiErrorMessage(index.error)}
          onRetry={isRetryable(index.error) ? index.refresh : undefined} />}
        {index.error && ids === undefined ? (
          <ErrorRetry
            size="pane"
            title="收藏加载失败"
            message={apiErrorMessage(index.error)}
            onRetry={isRetryable(index.error) ? index.refresh : undefined}
          />
        ) : (
          <div data-pagination-anchor="">
            <FaveGridView
              state={state}
              page={page}
              setPage={setPage}
              listKey={listKey}
              selection={gridSelection}
              failureTitle="收藏加载失败"
              empty={
                <EmptyState
                  size="pane"
                  icon={<MdPhotoLibrary size={ICON.display} />}
                  title="此收藏夹还没有图片"
                  description="在图片详情页点收藏到…，就能把图片放进来"
                />
              }
            />
          </div>
        )}
        <SelectionBar
          active={selection.active}
          count={selection.count}
          unit="张"
          label="图片多选"
          commands={barCommands}
          onExit={exit}
        />
      </div>
      {batch.dialogs}
      {commands.dialogs}
    </>
  );
}
