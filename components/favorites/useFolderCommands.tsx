'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdContentCopy, MdDeleteOutline, MdMoreVert, MdPublic, MdPublicOff, MdSend, MdStar } from 'react-icons/md';
import IconButton from '@/components/IconButton';
import Menu, { type MenuAction } from '@/components/Menu';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useShareToContact } from '@/components/ShareToContactDialog';
import { apiErrorMessage } from '@/lib/api/errors';
import type { FaveFolder } from '@/lib/api/favorites';
import { favoritesHref, folderLabel, settled, type DefaultFolder } from '@/lib/favorites';
import { deleteFolders } from '@/lib/favoritesActions';
import { readToken, readUserInfo } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { readFavouriteSetting, setDefaultFaveFolder, setFolderPublic } from '@/lib/favoritesSettings';
import { copyFolderLink } from '@/lib/favoritesShare';
import { settingsHref } from '@/app/settings/tabs';

export type FolderCommand = 'default' | 'public' | 'share' | 'copy' | 'delete';

/** Whether a folder shows on your profile: `null` is the original front end's "every folder". */
export function isFolderPublic(folderId: number, publicIds: readonly number[] | null): boolean {
  return publicIds === null || publicIds.includes(folderId);
}

/**
 * A folder's own commands — what its ⋮ menu offers, on the folder grid and on the folder's page:
 * 设为默认收藏夹, 在个人主页公开 / 隐藏, 分享给联系人, 复制链接, 删除收藏夹 (never the main folder,
 * which the backend protects). Render `dialogs` once.
 *
 * The public list (`publicFaveFolderIds`) and the default folder (`defaultFaveFolder`) are
 * settings that follow the account (C3), so a change here is the account's on every device — and
 * what `get_profile_fave_folders` and `get_shared_faves` answer visitors with. A folder is public
 * only while 公开我的收藏 (`showFaves`) is on as well.
 */
export function useFolderCommands({
  token,
  folders,
  defaultFolder,
  onDeleted,
}: {
  token: string;
  /** Every folder of the account, for the public list. */
  folders: readonly FaveFolder[];
  defaultFolder: DefaultFolder;
  /** After a deletion went through — the folder's own page leaves for the grid. */
  onDeleted?: (ids: number[]) => void;
}) {
  const router = useRouter();
  const publicIds = useSyncedSetting('publicFaveFolderIds');
  const showFaves = useSyncedSetting('showFaves');
  const { confirm, confirmDialog } = useConfirm();
  const { share, shareDialog } = useShareToContact();

  const setPublic = (folder: FaveFolder, on: boolean) => setFolderPublic(token, folders, folder.id, on);

  const run = async (folder: FaveFolder, command: FolderCommand) => {
    if (readToken() !== token) return;
    const name = folderLabel(folder);
    const username = readUserInfo()?.username;
    switch (command) {
      case 'default':
        setDefaultFaveFolder(token, folder);
        showToast(`已将「${name}」设为默认收藏夹`);
        return;
      case 'public': {
        const on = !isFolderPublic(folder.id, readFavouriteSetting('publicFaveFolderIds'));
        setPublic(folder, on);
        if (on && !showFaves) {
          /* Public, and still shown to nobody: 公开我的收藏 is the switch above every folder's. */
          showToast(`「${name}」已设为公开，开启公开我的收藏后才会显示在个人主页`, 'info', {
            action: { label: '前往设置', onClick: () => router.push(settingsHref('account'), { scroll: false }) },
          });
        } else {
          showToast(on ? `「${name}」已在个人主页公开` : `「${name}」已在个人主页隐藏`, 'success', {
            action: { label: '撤销', onClick: () => setPublic(folder, !on) },
          });
        }
        return;
      }
      case 'share':
      case 'copy': {
        if (typeof username !== 'string' || !username) return;
        /* 公开我的收藏 is off: no folder can be opened by anyone, and there is nothing to ask —
           the way there is a toast's action, as for the same condition one case above (G3-005). */
        if (!showFaves) {
          showToast('公开我的收藏已关闭，对方打开链接时将无法查看', 'info', {
            action: { label: '前往设置', onClick: () => router.push(settingsHref('account'), { scroll: false }) },
          });
          return;
        }
        /* A folder nobody else can open is not worth sending: offer to make it public first. */
        if (!isFolderPublic(folder.id, publicIds)) {
          const ok = await confirm({
            title: '确认公开收藏夹',
            message: `「${name}」未在个人主页公开，对方打开链接时将无法查看。确定要公开该收藏夹吗？`,
            confirmLabel: '公开',
            tone: 'filled',
          });
          if (!ok || readToken() !== token) return;
          setPublic(folder, true);
        }
        if (command === 'share') {
          share({ kind: 'fave-folder', ownerUsername: username, folderId: folder.id, folderName: name });
        } else {
          const copied = await copyFolderLink(token, username, folder.id, name);
          if (readToken() !== token) return;
          showToast(copied ? '已复制链接' : '复制失败', copied ? 'success' : 'error');
        }
        return;
      }
      case 'delete': {
        if (folder.isMain) return;
        const ok = await confirm({
          title: '确认删除收藏夹',
          message: `确定要删除收藏夹「${name}」及其中的收藏记录吗？此操作不可撤销。`,
        });
        if (!ok || readToken() !== token) return;
        /* The settings it rewrites are read as it rewrites them, not from this render (G3-007). */
        const outcome = await settled(deleteFolders(token, [folder.id]));
        if (!outcome.ok) {
          showToast(apiErrorMessage(outcome.error, '删除失败'), 'error');
          return;
        }
        showToast(`已删除「${name}」`);
        if (onDeleted) onDeleted([folder.id]);
        return;
      }
    }
  };

  const itemsFor = (folder: FaveFolder): MenuAction[] => {
    const isDefault = folder.id === defaultFolder.id;
    const shown = isFolderPublic(folder.id, publicIds);
    return [
      { value: 'default', label: isDefault ? '已是默认收藏夹' : '设为默认收藏夹', icon: <MdStar />, disabled: isDefault },
      { value: 'public', label: shown ? '在个人主页隐藏' : '在个人主页公开', icon: shown ? <MdPublicOff /> : <MdPublic /> },
      { value: 'share', label: '分享给联系人', icon: <MdSend /> },
      { value: 'copy', label: '复制链接', icon: <MdContentCopy /> },
      ...(folder.isMain ? [] : [{ value: 'delete', label: '删除收藏夹', icon: <MdDeleteOutline />, destructive: true }]),
    ];
  };

  return {
    run,
    itemsFor,
    publicIds,
    showFaves,
    dialogs: (
      <>
        {confirmDialog}
        {shareDialog}
      </>
    ),
  };
}

/** The ⋮ that opens a folder's commands. */
export function FolderMenuButton({
  folder,
  items,
  onSelect,
}: {
  folder: FaveFolder;
  items: MenuAction[];
  onSelect: (command: FolderCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const name = folderLabel(folder);
  return (
    <>
      <IconButton
        ref={anchorRef}
        icon={<MdMoreVert />}
        aria-label={`「${name}」的更多操作`}
        tooltip="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        aria-label={`「${name}」的更多操作`}
        items={items}
        onSelect={(value) => onSelect(value as FolderCommand)}
      />
    </>
  );
}

/** Where a folder's page goes back to, and where a deleted folder's page lands. */
export const FOLDERS_HOME = favoritesHref();
