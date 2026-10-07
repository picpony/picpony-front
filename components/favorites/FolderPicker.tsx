'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders, faveIds } from '@/lib/resources';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { folderLabel, settled } from '@/lib/favorites';
import { restoreFavourite, setImageFolders } from '@/lib/favoritesActions';
import { readToken } from '@/lib/hooks';
import { useDefaultFaveFolder } from '@/lib/favoritesSettings';
import { ChoiceSurface, FolderChecklist, NewFolderRow } from './FolderDialogs';

/**
 * 收藏到… — which of your folders a picture is in, as checkboxes (`set_image_fave_folders`, one
 * write for the whole choice). A sheet on a phone, a dialog from `sm` up.
 *
 * - **Opens on** the folders the picture is in; a picture not yet favourited opens on the default
 *   folder (the original front end opened on the main folder, which is the default until one is
 *   chosen), and one favourited without a folder on record on the main folder, where the backend
 *   keeps it.
 * - **新建收藏夹** at the foot creates a folder and checks it.
 * - **Clearing every box** unfavourites the picture — the backend's rule for an empty list — so
 *   保存 says 取消收藏 then, and the toast offers 撤销.
 */
export default function FolderPicker({
  open,
  token,
  imageId,
  onClose,
}: {
  open: boolean;
  token: string;
  imageId: number;
  onClose: () => void;
}) {
  /* **Read from the open until the exit has played**, not while `open` (M1-008): gated on it, the
     reads went to `SKIP` in the commit that closed the dialog — which also drops their retained
     answers — and the picker collapsed to its loading rows as it left. The boxes the user ticked
     are kept for the exit the same way, and both are let go once it is over. */
  const [live, setLive] = useState(open);
  if (open && !live) setLive(true);
  const list = useResource(faveFolders, live ? { token } : SKIP);
  const index = useResource(faveIds, live ? { token } : SKIP);
  const defaultFolder = useDefaultFaveFolder(live ? token : null, list.data?.folders);
  const [edited, setEdited] = useState<ReadonlySet<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const exited = () => {
    setLive(false);
    setEdited(null);
  };

  const folders = list.data?.folders;
  const faved = index.data?.ids.includes(imageId) ?? false;
  const ready = folders !== undefined && index.data !== undefined;

  /* What the picture is in now, as the boxes open on it. */
  const initial = (() => {
    if (!folders || !index.data) return new Set<number>();
    const main = folders.find((folder) => folder.isMain)?.id;
    if (faved) {
      const known = (index.data.folders[imageId] ?? []).filter((id) => folders.some((folder) => folder.id === id));
      return new Set(known.length > 0 ? known : main !== undefined ? [main] : []);
    }
    const target = defaultFolder.id;
    return new Set(target > 0 ? [target] : main !== undefined ? [main] : []);
  })();
  const checked = edited ?? initial;
  const clearing = faved && checked.size === 0;
  const unchanged = !edited || (edited.size === initial.size && [...edited].every((id) => initial.has(id)));

  const close = () => {
    if (busy || creating) return;
    onClose();
  };

  const toggle = (id: number, on: boolean) =>
    setEdited((current) => {
      const next = new Set(current ?? initial);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = async () => {
    if (busy || creating || !ready || !folders || (!faved && checked.size === 0)) return;
    if (unchanged && faved) {
      close();
      return;
    }
    const before = faved ? [...initial] : [];
    const chosen = folders.filter((folder) => checked.has(folder.id)).map((folder) => folder.id);
    setBusy(true);
    const outcome = await settled(setImageFolders(token, imageId, chosen));
    setBusy(false);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, '保存失败'), 'error');
      return;
    }
    onClose();
    if (chosen.length === 0) {
      showToast('已取消收藏', 'success', {
        action: {
          label: '撤销',
          /* The failure in its own words, as the batch's 撤销 says it (G3-012). */
          onClick: () =>
            void restoreFavourite(token, imageId, before, 0).catch((error: unknown) =>
              showToast(apiErrorMessage(error, '撤销失败'), 'error'),
            ),
        },
      });
    } else if (!faved) {
      const names = folders.filter((folder) => checked.has(folder.id)).map((folder) => `「${folderLabel(folder)}」`);
      showToast(names.length <= 2 ? `已收藏到${names.join('')}` : `已收藏到 ${names.length} 个收藏夹`);
    } else {
      showToast('已更新收藏夹');
    }
  };

  const failure = list.error ?? index.error;
  return (
    <ChoiceSurface
      isOpen={open}
      onClose={close}
      onExited={exited}
      title="收藏到…"
      busy={busy || creating}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy || creating}>
            取消
          </Button>
          <Button
            variant={clearing ? 'danger' : 'filled'}
            onClick={save}
            loading={busy}
            disabled={creating || !ready || (!faved && checked.size === 0)}
          >
            {clearing ? '取消收藏' : '保存'}
          </Button>
        </>
      }
    >
      {!ready && failure ? (
        <ErrorRetry
          size="inline"
          title="收藏夹加载失败"
          message={apiErrorMessage(failure)}
          onRetry={
            isRetryable(failure)
              ? () => {
                  if (list.error) list.refresh();
                  if (index.error) index.refresh();
                }
              : undefined
          }
        />
      ) : !ready || !folders ? (
        <ul className="flex flex-col" aria-hidden="true">
          {Array.from({ length: 3 }, (_, row) => (
            <li key={row} className="flex min-h-12 items-center gap-4">
              <Skeleton className="size-4.5 rounded-xs" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3.5 w-10" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <FolderChecklist folders={folders} checked={checked} onChange={toggle} disabled={busy} />
          {faved && (
            <p className="mt-1 text-body-s text-on-surface-variant">不勾选任何收藏夹即取消收藏</p>
          )}
          <NewFolderRow token={token} disabled={busy} onBusyChange={setCreating} onCreated={(folder) => toggle(folder.id, true)} />
        </>
      )}
    </ChoiceSurface>
  );
}
