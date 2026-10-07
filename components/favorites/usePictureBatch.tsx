'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { showToast, type ToastType } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useShareToContact } from '@/components/ShareToContactDialog';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders } from '@/lib/resources';
import { apiErrorMessage, isAborted, isRetryable } from '@/lib/api/errors';
import type { TransferMode } from '@/lib/api/favorites';
import { shareThumbUrl } from '@/lib/api/messages';
import { downloadOriginal } from '@/lib/download';
import { favoritesHref, settled, transferSummary } from '@/lib/favorites';
import {
  NoPrivacyPasswordError,
  moveToPrivacy,
  removeFromFolder,
  setImageFolders,
  transferFromPrivacy,
  transferPictures,
} from '@/lib/favoritesActions';
import { archiveName, packArchives, packedSentence, originalUrl, saveArchive } from '@/lib/favoritesDownload';
import { addPrivacyPictures, reloadPrivacy, removeFromPrivacy, restoreToPrivacy } from '@/lib/favoritesPrivacy';
import { readToken } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import type { PonyImage } from '@/lib/types/image';
import ProgressDialog, { completeProgress, progressLanding, runSummary, type ProgressState } from './ProgressDialog';
import { TransferDialog } from './FolderDialogs';

/**
 * Where the pictures are: one of your folders, your privacy space — or somebody's privacy space
 * shared with you, which can be downloaded and nothing else (G3-020): every write here goes to the
 * signed-in account's own space, so on someone else's it would have moved your pictures while
 * you looked at theirs.
 */
export type BatchSource = { kind: 'folder'; folderId: number } | { kind: 'privacy' } | { kind: 'shared-privacy' };
type OwnSource = Exclude<BatchSource, { kind: 'shared-privacy' }>;

type Progress = (done: number, total: number) => void;

/** What a removal of several pictures ended with, one request a picture. */
interface RemovalReport {
  /** The ids that left the list. */
  left: number[];
  failed: unknown[];
  /** 撤销 for a single removal: puts that one picture back. */
  undo: (() => Promise<unknown>) | null;
}

/*
 * The runs themselves, at module scope: the React Compiler lowers no `try` with a `finally` (nor
 * a conditional inside a `try`) in a component or hook, and skips the whole function for one.
 */

async function runRemoval(
  token: string,
  source: OwnSource,
  images: readonly PonyImage[],
  signal: AbortSignal,
  onProgress: Progress,
): Promise<RemovalReport> {
  if (source.kind === 'folder') {
    const outcome = await removeFromFolder(
      token,
      images.map((image) => image.id),
      source.folderId,
      { signal, onProgress },
    );
    const only = images.length === 1 && outcome.succeeded.length === 1 ? outcome.succeeded[0] : null;
    const previous = only !== null ? (outcome.previous.get(only) ?? [source.folderId]) : [];
    return {
      left: outcome.succeeded,
      failed: outcome.failed.map((failure) => failure.error),
      undo: only !== null ? () => setImageFolders(token, only, previous) : null,
    };
  }
  const outcome = await removeFromPrivacy(
    token,
    images.map((image) => image.id),
    { signal, onProgress },
  );
  const only = images.length === 1 && outcome.removed.length === 1 ? images[0] : null;
  return {
    left: outcome.removed,
    failed: outcome.failed.map((failure) => failure.error),
    undo: only ? () => restoreToPrivacy(token, only) : null,
  };
}

/** `已移出 3 张，1 张失败`, the tone it is said in, and whether it is the backend's own refusal. */
function countSentence(done: number, failed: unknown[], verb: string, fallback: string): { text: string; tone: ToastType } {
  if (done === 0 && failed.length > 0) return { text: apiErrorMessage(failed[0], fallback), tone: 'error' };
  const text = `${verb} ${done} 张${failed.length > 0 ? `，${failed.length} 张失败` : ''}`;
  return { text, tone: failed.length > 0 ? 'warning' : 'success' };
}

/**
 * What the picture batch mode does with its selection — on a folder's page and in the privacy
 * space — and the dialogs it needs. Render `dialogs` once.
 *
 * - **移动到… / 复制到…** — one `batch_transfer_faves` (or `batch_transfer_privacy_faves`) with
 *   every picture and every target folder, ending with the backend's own per-folder summary.
 * - **移出收藏夹** (a folder) and **移出隐私空间** (the space) — one request a picture. Several
 *   confirm with the count first and show their progress, with 停止; a single one does not ask,
 *   and its toast offers 撤销 instead.
 * - **移入隐私空间** — the original front end's move (its record into the space, then out of
 *   favourites), confirmed with the count; refused, with a way there, while the space has no
 *   password.
 * - **下载** — one picture as its original file; several as ZIP archives of at most a page each
 *   (`lib/favoritesDownload.ts`).
 * - **分享** — one picture, to a contact (`useShareToContact`).
 *
 * `onSettled` hears the ids that left the list on screen, so the screen can end the mode.
 *
 * **One run at a time, decided synchronously** (G3-019): `begin` claims the run in a ref before
 * anything awaits, as the shop's checkout does — React state could let a second press through
 * before the first one's render, and the second run orphaned the first one's 停止.
 *
 * **A run that went to its end is shown at its end**: the meter fills and lands before the dialog
 * leaves (M1-007); one that was stopped leaves where it stopped.
 */
export function usePictureBatch({
  token,
  source,
  onSettled,
}: {
  token: string;
  source: BatchSource;
  onSettled?: (left: number[]) => void;
}) {
  const router = useRouter();
  const showPrivacy = useSyncedSetting('showPrivacyFaves');
  const [transfer, setTransfer] = useState<{ mode: TransferMode; images: PonyImage[] } | null>(null);
  /* The transfer the dialog shows — held through its exit, let go once it has played, and the
     folder list read for as long (M1-008, M1-009): read only while `transfer` was set, the dialog
     dropped to its loading rows and read 移动 0 张到… on its way out. */
  const [shownTransfer, setShownTransfer] = useState(transfer);
  if (transfer && transfer !== shownTransfer) setShownTransfer(transfer);
  const folderRead = useResource(faveFolders, shownTransfer ? { token } : SKIP);
  const folders = folderRead.data?.folders ?? [];
  const { confirm, confirmDialog } = useConfirm();
  const { share, shareDialog } = useShareToContact();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef<AbortController | null>(null);
  const running = useRef(false);
  useEffect(() => () => { run.current?.abort(); }, []);

  /** Claims the run, or `null` when one is already going. */
  const begin = (title: string, detail: string, total: number, show: boolean) => {
    if (running.current) return null;
    running.current = true;
    const controller = new AbortController();
    run.current = controller;
    setBusy(true);
    if (show) setProgress({ title, detail, done: 0, total });
    return controller;
  };
  const step =
    (detail: string): Progress =>
    (done, total) =>
      setProgress((current) => (current ? { ...current, detail, done, total } : current));
  /**
   * Ends the run. One that went through every step with its dialog up (`summary`, what it did)
   * fills the meter, says what it did, and lets the meter land first; `null` closes at once.
   */
  const end = async (controller: AbortController, summary: string | null) => {
    if (summary !== null && !controller.signal.aborted) {
      setProgress(completeProgress(summary));
      await progressLanding();
    }
    if (run.current === controller) run.current = null;
    running.current = false;
    setBusy(false);
    setProgress(null);
  };
  const stop = () => {
    run.current?.abort();
    setProgress((current) => (current ? { ...current, stopping: true } : current));
  };

  const confirmTransfer = async (targetIds: number[]): Promise<boolean> => {
    if (!transfer || source.kind === 'shared-privacy') return false;
    const { mode, images } = transfer;
    const imageIds = images.map((image) => image.id);
    const outcome = await settled(
      source.kind === 'folder'
        ? transferPictures(token, { imageIds, sourceFolderId: source.folderId, targetFolderIds: targetIds, mode })
        : transferFromPrivacy(token, { imageIds, targetFolderIds: targetIds, mode }),
    );
    if (readToken() !== token) return false;
    if (!outcome.ok) {
      showToast(apiErrorMessage(outcome.error, mode === 'move' ? '移动失败' : '复制失败'), 'error');
      return false;
    }
    const summary = transferSummary(outcome.value, mode, imageIds.length);
    showToast(summary.text, summary.partial ? 'warning' : 'success');
    setTransfer(null);
    if (source.kind === 'privacy' && mode === 'move') void reloadPrivacy(token);
    if (!summary.partial) onSettled?.(mode === 'move' ? imageIds : []);
    return true;
  };

  const remove = async (images: PonyImage[]) => {
    if (running.current || images.length === 0 || source.kind === 'shared-privacy') return;
    const single = images.length === 1;
    const where = source.kind === 'folder' ? '收藏夹' : '隐私空间';
    if (!single) {
      const ok = await confirm({
        title: `确认移出${where}`,
        message:
          source.kind === 'folder'
            ? `确定要将选中的 ${images.length} 张图片移出此收藏夹吗？不在其他收藏夹中的图片将取消收藏。`
            : `确定要将选中的 ${images.length} 张图片移出隐私空间吗？移出后无法从隐私空间找回。`,
      });
      if (!ok || readToken() !== token) return;
    }
    const controller = begin(`正在移出${where}`, '正在移出', images.length, !single);
    if (!controller) return;
    const outcome = await settled(runRemoval(token, source, images, controller.signal, step('正在移出')));
    await end(controller, !single && outcome.ok ? runSummary('已移出', outcome.value.left.length, outcome.value.failed.length) : null);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      if (!isAborted(outcome.error)) showToast(apiErrorMessage(outcome.error, '移出失败'), 'error');
      return;
    }
    const report = outcome.value;
    if (report.failed.length === 0 && !controller.signal.aborted) onSettled?.(report.left);
    const undo = report.undo;
    if (undo) {
      showToast(`已移出${where}`, 'success', {
        action: {
          label: '撤销',
          onClick: () => void settled(undo()).then((result) => !result.ok && showToast(apiErrorMessage(result.error, '撤销失败'), 'error')),
        },
      });
    } else if (report.left.length > 0 || report.failed.length > 0) {
      const sentence = countSentence(report.left.length, report.failed, '已移出', '移出失败');
      showToast(sentence.text, sentence.tone);
    }
  };

  const toPrivacy = async (images: PonyImage[]) => {
    if (running.current || images.length === 0 || source.kind !== 'folder') return;
    const ok = await confirm({
      title: '确认移入隐私空间',
      message: `确定要将选中的 ${images.length} 张图片移入隐私空间吗？移入后它们将从收藏夹中移除。`,
      tone: 'filled',
    });
    if (!ok || readToken() !== token) return;
    const several = images.length > 1;
    const controller = begin('正在移入隐私空间', '正在移入', images.length, several);
    if (!controller) return;
    const outcome = await settled(moveToPrivacy(token, images, { signal: controller.signal, onProgress: step('正在移入') }));
    await end(controller, several && outcome.ok ? runSummary('已移入', outcome.value.succeeded.length, outcome.value.failed.length) : null);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      if (outcome.error instanceof NoPrivacyPasswordError) {
        showToast(outcome.error.message, 'warning', {
          action: showPrivacy
            ? { label: '前往', onClick: () => router.push(favoritesHref('privacy'), { scroll: false }) }
            : { label: '设置', onClick: () => router.push('/settings', { scroll: false }) },
        });
      } else {
        showToast(apiErrorMessage(outcome.error, '移入失败'), 'error');
      }
      return;
    }
    const moved = outcome.value.succeeded;
    // A successful add remains in the space even if the following removal failed.
    addPrivacyPictures(token, images.filter((image) => outcome.value.added.includes(image.id)));
    if (outcome.value.failed.length === 0 && !controller.signal.aborted) onSettled?.(moved);
    const sentence = countSentence(
      moved.length,
      outcome.value.failed.map((failure) => failure.error),
      '已移入隐私空间',
      '移入失败',
    );
    showToast(sentence.text, sentence.tone);
  };

  const download = async (images: PonyImage[]) => {
    if (running.current || images.length === 0) return;
    if (images.length === 1) {
      const image = images[0];
      const controller = begin('正在下载', '正在下载', 1, false);
      if (!controller) return;
      const outcome = await settled(downloadOriginal({ id: image.id, url: originalUrl(image), format: image.format }, controller.signal));
      await end(controller, null);
      if (readToken() !== token || controller.signal.aborted) return;
      if (outcome.ok) showToast('已开始下载');
      else showToast(apiErrorMessage(outcome.error, '下载失败'), 'error');
      return;
    }
    const controller = begin('正在打包下载', '正在下载', images.length, true);
    if (!controller) return;
    const progressed = step('正在下载');
    const stamp = Date.now();
    const outcome = await settled(
      packArchives(images, {
        signal: controller.signal,
        onProgress: (done, _failed, total) => progressed(done, total),
        /* Each archive is saved as soon as it is packed and let go, so a whole space never sits in
           memory at once (G3-013). */
        onArchive: (archive, part, parts) => {
          if (readToken() === token) saveArchive(archive, archiveName(stamp, part, parts));
        },
      }),
    );
    await end(controller, outcome.ok && !outcome.value.cancelled ? runSummary('已打包', outcome.value.packed, outcome.value.failed) : null);
    if (readToken() !== token) return;
    if (!outcome.ok) {
      if (!isAborted(outcome.error)) showToast(apiErrorMessage(outcome.error, '下载失败'), 'error');
      return;
    }
    const packed = outcome.value;
    if (packed.cancelled) {
      showToast(packed.archives > 0 ? `已停止下载，已保存 ${packed.archives} 个压缩包` : '已停止下载', 'info');
    } else if (packed.archives === 0) {
      showToast('所选图片均下载失败，没有生成空压缩包', 'error');
    } else {
      showToast(packedSentence(packed.packed, packed.failed, packed.archives), packed.failed > 0 ? 'warning' : 'success');
    }
  };

  const shareOne = (image: PonyImage) =>
    share({ kind: 'image', imageId: image.id, thumbUrl: shareThumbUrl(image.representations) });

  const targets = source.kind === 'folder' ? folders.filter((folder) => folder.id !== source.folderId) : folders;

  return {
    busy,
    openTransfer: (mode: TransferMode, images: PonyImage[]) => {
      if (!running.current && images.length > 0 && source.kind !== 'shared-privacy') setTransfer({ mode, images });
    },
    remove,
    toPrivacy,
    download,
    shareOne,
    dialogs: (
      <>
        <TransferDialog
          open={transfer !== null}
          mode={shownTransfer?.mode ?? 'move'}
          count={shownTransfer?.images.length ?? 0}
          folders={targets}
          loading={folderRead.data === undefined && !folderRead.error}
          error={folderRead.data === undefined ? folderRead.error : undefined}
          onRetry={isRetryable(folderRead.error) ? folderRead.refresh : undefined}
          token={token}
          onClose={() => setTransfer(null)}
          onExited={() => setShownTransfer(null)}
          onConfirm={confirmTransfer}
        />
        <ProgressDialog state={progress} onStop={stop} />
        {confirmDialog}
        {shareDialog}
      </>
    ),
  };
}
