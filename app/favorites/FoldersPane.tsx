'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdChecklist, MdCreateNewFolder, MdDeleteOutline, MdDeselect, MdFolder, MdMerge, MdSelectAll, MdTune } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders, folderCovers, useBrowsingFingerprint } from '@/lib/resources';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { FaveFolder } from '@/lib/api/favorites';
import { faveFolderHref, folderLabel, settled } from '@/lib/favorites';
import { createFolder, deleteFolders, mergeFolders } from '@/lib/favoritesActions';
import { useSelectionMode } from '@/lib/favoritesSelection';
import { useFolderReturn } from '@/lib/folderTransit';
import { useDefaultFaveFolder } from '@/lib/favoritesSettings';
import { readToken } from '@/lib/hooks';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import PresenceList from '@/components/PresenceList';
import { showToast } from '@/components/Toast';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import SelectionBar, { type SelectionCommand } from '@/components/favorites/SelectionBar';
import { FOLDER_GRID, FolderBadges, FolderCard, FolderGridSkeleton } from '@/components/favorites/FolderCard';
import { MergeDialog } from '@/components/favorites/FolderDialogs';
import { FolderMenuButton, isFolderPublic, useFolderCommands } from '@/components/favorites/useFolderCommands';
import { settingsHref } from '@/app/settings/tabs';

/**
 * 收藏夹 — your folders, each a card with its newest picture for a cover, its count and its marks
 * (默认, 不公开), opening the folder's own page. 新建收藏夹 and 选择 head the grid; in the folder
 * batch mode the cards are checkboxes (the main folder is protected and cannot be chosen) and the
 * bar offers 全选, 合并到… and 删除 — the original front end's folder batch mode.
 *
 * A folder page left with Back shrinks back into its card here (`useFolderReturn`).
 */
export default function FoldersPane({ token, active }: { token: string; active: boolean }) {
  const router = useRouter();
  const list = useResource(faveFolders, { token });
  const fp = useBrowsingFingerprint();
  const folders = list.data?.folders;
  const defaultFolder = useDefaultFaveFolder(token, folders);

  const coverIds = folders
    ? [...new Set(folders.map((folder) => folder.latestImageId).filter((cover): cover is number => cover !== null))]
    : [];
  const covers = useResource(folderCovers, coverIds.length > 0 ? { ids: coverIds, fp } : SKIP, { keepPrevious: fp });

  const selectRef = useRef<HTMLButtonElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const presence = useRef<PresenceList<FaveFolder>>(null);
  /* A folder deleted from its own ⋮ is the user's removal: the grid places a focus the
     confirmation has not returned to the card yet (`PresenceList`'s `claimFocus`). Claimed as the
     delete lands — its cache write publishes on the next paint, after this. A batch delete or a
     merge ends the selection mode, which puts the focus back on 选择 itself. */
  const commands = useFolderCommands({
    token,
    folders: folders ?? [],
    defaultFolder,
    onDeleted: (ids) => {
      presence.current?.claimFocus(ids);
    },
  });
  const { confirm, confirmDialog } = useConfirm();

  const rootRef = useRef<HTMLDivElement>(null);
  useFolderReturn(rootRef);
  const { prompt, promptDialog } = usePrompt();
  const order = useMemo(() => (folders ?? []).filter((folder) => !folder.isMain).map((folder) => folder.id), [folders]);
  const selection = useSelectionMode({ order, restoreFocus: () => selectRef.current?.disabled ? createRef.current : selectRef.current });
  const [creating, setCreating] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* The mode belongs to the pane on screen: a switch to another tab ends it. */
  const { active: selecting, exit, forget } = selection;
  useEffect(() => {
    if (!active && selecting) exit();
  }, [active, selecting, exit]);
  /* A folder that went (deleted here or elsewhere) is not selected any more. */
  useEffect(() => {
    if (!folders) return;
    const known = new Set(folders.map((folder) => folder.id));
    forget([...selection.selected].filter((id) => !known.has(id)));
  }, [folders, forget, selection.selected]);

  if (folders === undefined) {
    if (list.error) {
      return (
        <ErrorRetry
          size="pane"
          title="收藏夹加载失败"
          message={apiErrorMessage(list.error)}
          onRetry={isRetryable(list.error) ? list.refresh : undefined}
        />
      );
    }
    return <FolderGridSkeleton />;
  }

  const chosen = folders.filter((folder) => selection.selected.has(folder.id));
  const allSelected = order.length > 0 && order.every((id) => selection.selected.has(id));

  const removeChosen = async () => {
    if (chosen.length === 0 || busy) return;
    const ok = await confirm({
      title: '确认删除收藏夹',
      message: `确定要删除选中的 ${chosen.length} 个收藏夹及其中的收藏记录吗？此操作不可撤销。`,
    });
    if (!ok || readToken() !== token) return;
    setBusy(true);
    const outcome = await settled(deleteFolders(token, chosen.map((folder) => folder.id)));
    setBusy(false);
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, '删除失败'), 'error');
      return;
    }
    showToast(`已删除 ${chosen.length} 个收藏夹`);
    exit();
  };

  const merge = async (targetId: number) => {
    const target = folders.find((folder) => folder.id === targetId);
    if (!target) return false;
    const ok = await confirm({ title: '确认合并收藏夹', message: `确定要将选中的 ${chosen.length} 个收藏夹合并到「${folderLabel(target)}」吗？其余 ${chosen.length - 1} 个收藏夹将被删除。` });
    if (!ok || readToken() !== token) return false;
    const outcome = await settled(
      mergeFolders(
        token,
        chosen.filter((folder) => folder.id !== targetId).map((folder) => folder.id),
        { id: target.id, name: folderLabel(target) },
      ),
    );
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, '合并失败'), 'error');
      return false;
    }
    showToast(`已合并到「${folderLabel(target)}」`);
    setMergeOpen(false);
    exit();
    return true;
  };

  const create = async () => {
    if (creating) return;
    const name = await prompt({ title: '新建收藏夹', label: '名称', rows: 1, confirmLabel: '创建' });
    if (!name || readToken() !== token) return;
    setCreating(true);
    const result = await settled(createFolder(token, name));
    setCreating(false);
    if (readToken() !== token) return;
    if (!result.ok) showToast(apiErrorMessage(result.error, '创建失败'), 'error');
    else showToast(result.value ? `已创建「${name}」` : `已创建「${name}」，收藏夹列表更新失败`, result.value ? 'success' : 'warning');
  };

  const barCommands: SelectionCommand[] = [
    {
      value: 'all',
      label: allSelected ? '取消全选' : '全选',
      icon: allSelected ? <MdDeselect /> : <MdSelectAll />,
      onSelect: () => selection.setMany(order, !allSelected),
      disabled: order.length === 0,
    },
    {
      value: 'merge',
      label: '合并到…',
      icon: <MdMerge />,
      onSelect: () => setMergeOpen(true),
      disabled: chosen.length < 2 || busy,
    },
    {
      value: 'delete',
      label: '删除',
      icon: <MdDeleteOutline />,
      destructive: true,
      onSelect: () => void removeChosen(),
      disabled: chosen.length === 0 || busy,
    },
  ];

  return (
    <div ref={rootRef}>
      {/* One row at every width: the summary takes what the actions leave and wraps inside its own
          column, and below `sm` the actions are their glyphs. Wrapped onto a row of their own on a
          phone, they left a blank band a button tall while the mode hid them (D1-014). */}
      <div className="mb-4 flex min-h-10 items-center gap-4">
        <p className="min-w-0 flex-1 text-body-m text-on-surface-variant tabular-nums">
          共 {formatCount(folders.length)} 个收藏夹 · 默认收藏到「{defaultFolder.name}」
        </p>
        {/* Out of the mode's way on the effects spring, on the bar's own clock — never in one
            frame beside a bar that glides (M1-002). */}
        <div
          inert={selection.active}
          className={cn('flex shrink-0 items-center gap-2 transition-opacity spring-fast-effects', selection.active && 'opacity-0')}
        >
          <Button
            ref={createRef}
            variant="tonal"
            icon={<MdCreateNewFolder />}
            loading={creating}
            onClick={() => void create()}
            responsiveLabel
          >
            新建收藏夹
          </Button>
          <Button
            ref={selectRef}
            variant="text"
            icon={<MdChecklist />}
            onClick={() => selection.enter()}
            disabled={order.length === 0}
            responsiveLabel
          >
            选择
          </Button>
        </div>
      </div>
      {!commands.showFaves && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-on-surface-variant">
          <span>公开我的收藏已关闭，个人主页不显示任何收藏夹</span>
          <Button variant="text" size="xs" icon={<MdTune />} onClick={() => router.push(settingsHref('account'), { scroll: false })}>
            前往设置
          </Button>
        </div>
      )}
      {Boolean(list.error) && <ErrorRetry size="inline" title="收藏夹更新失败" message={apiErrorMessage(list.error)}
        onRetry={isRetryable(list.error) ? list.refresh : undefined} />}
      {folders.length === 0 ? (
        <EmptyState
          size="pane"
          icon={<MdFolder size={ICON.display} />}
          title="还没有收藏夹"
          description="在图片详情页点一下收藏，就会出现在这里"
        />
      ) : (
        /* A folder deleted or merged away fades where it was while the cards after it glide into
           their new cells, and a new one grows into its own — the grid never reflows in a frame
           (M1-006). */
        <PresenceList
          ref={presence}
          items={folders}
          getKey={(folder: FaveFolder) => folder.id}
          variant="grid"
          /* The main folder cannot be deleted, so a card is always left; should none be, 新建. */
          fallbackFocus={() => createRef.current}
        >
          {(entries, ref) => (
            <ul ref={ref} className={FOLDER_GRID}>
              {entries.map(({ item: folder, key }) => (
                <li key={key} data-presence-key={key} className="min-w-0">
                  <FolderCard
                    folder={folder}
                    href={faveFolderHref(folder.id)}
                    cover={folder.latestImageId !== null ? covers.data?.[folder.latestImageId] : undefined}
                    coverPending={folder.latestImageId !== null && covers.data === undefined && !covers.error}
                    badges={
                      <FolderBadges
                        isDefault={folder.id === defaultFolder.id}
                        isPublic={commands.showFaves && isFolderPublic(folder.id, commands.publicIds)}
                      />
                    }
                    menu={
                      <FolderMenuButton
                        folder={folder}
                        items={commands.itemsFor(folder)}
                        onSelect={(command) => void commands.run(folder, command)}
                      />
                    }
                    selection={{
                      active: selection.active,
                      selected: selection.selected.has(folder.id),
                      selectable: !folder.isMain,
                      onToggle: selection.toggle,
                      onLongPress: selection.enter,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </PresenceList>
      )}
      <SelectionBar
        active={selection.active}
        count={selection.count}
        unit="个"
        label="收藏夹多选"
        commands={barCommands}
        onExit={exit}
      />
      {promptDialog}
      <MergeDialog open={mergeOpen} folders={chosen} onClose={() => setMergeOpen(false)} onConfirm={merge} />
      {commands.dialogs}
      {confirmDialog}
    </div>
  );
}
