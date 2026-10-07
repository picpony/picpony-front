'use client';

import { useState } from 'react';
import { MdEdit, MdStar } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders } from '@/lib/resources';
import { folderLabel } from '@/lib/favorites';
import { isRetryable } from '@/lib/api/errors';
import { useDefaultFaveFolder } from '@/lib/favoritesSettings';
import { ICON } from '@/lib/icons';
import { useSession } from '@/lib/hooks';
import { changeSyncedSetting, useSyncedSetting } from '@/lib/settingsSync';
import { FolderChoiceDialog } from '@/components/favorites/FolderDialogs';
import { RowButton, SettingsRow, SettingsSection, SwitchRow } from './SettingsRow';

/**
 * 收藏 — the favourites defaults, where the original front end offered them: on its settings page,
 * beside its privacy options (`默认收藏至【X】` and `显示隐私收藏夹`). Signed in only: all three follow
 * the account (C3, `account` scope) and reset on signing out.
 *
 * - **一键收藏** (`defaultFaveToMain`): a press on 收藏 favourites into the default folder at once;
 *   off, each press asks which folders (收藏到…).
 * - **默认收藏夹** (`defaultFaveFolder`): which folder that is — the main folder until one is
 *   chosen, here or from a folder's own ⋮ (设为默认收藏夹).
 * - **显示隐私空间** (`showPrivacyFaves`): offers the 隐私空间 tab in 我的收藏.
 *
 * The privacy space's own switches — auto-privacy and how long it stays unlocked — live in the
 * space's settings, where the original front end had them too; whether folders show on the
 * profile is each folder's own (在个人主页公开), under 账户's 公开我的收藏.
 */
export default function FavoritesSection() {
  const { token } = useSession();
  const oneTap = useSyncedSetting('defaultFaveToMain');
  const showPrivacy = useSyncedSetting('showPrivacyFaves');
  const [choosing, setChoosing] = useState(false);
  /* The list is read when the choice is opened, not with the screen: the row names the stored
     folder, and /settings costs no request it did not cost before. */
  const list = useResource(faveFolders, token && choosing ? { token } : SKIP);
  const folders = list.data?.folders;
  const resolved = useDefaultFaveFolder(token, folders);

  if (!token) return null;
  return (
    <SettingsSection title="收藏" icon={<MdStar size={ICON.control} />}>
      <SwitchRow
        label="一键收藏"
        description="点收藏时直接存入默认收藏夹；关闭后每次都选择收藏夹"
        checked={oneTap}
        onChange={(on) => changeSyncedSetting('defaultFaveToMain', on)}
      />
      <SettingsRow
        label="默认收藏夹"
        supporting={`「${resolved.name}」`}
        action={
          <RowButton label="更改默认收藏夹" icon={<MdEdit />} onClick={() => setChoosing(true)}>
            更改
          </RowButton>
        }
      />
      <SwitchRow
        label="显示隐私空间"
        description="在我的收藏中显示需要密码才能查看的隐私空间"
        checked={showPrivacy}
        onChange={(on) => changeSyncedSetting('showPrivacyFaves', on)}
      />
      <FolderChoiceDialog
        open={choosing}
        title="默认收藏夹"
        folders={folders ?? []}
        loading={!folders && !list.error}
        error={list.error}
        onRetry={isRetryable(list.error) ? list.refresh : undefined}
        value={resolved.id}
        onClose={() => setChoosing(false)}
        onConfirm={(id) => {
          const folder = folders?.find((each) => each.id === id);
          if (folder) changeSyncedSetting('defaultFaveFolder', { id: folder.id, name: folderLabel(folder) });
          setChoosing(false);
        }}
      />
    </SettingsSection>
  );
}
