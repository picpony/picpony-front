'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import { apiErrorMessage } from '@/lib/api/errors';
import type { FaveFolder } from '@/lib/api/favorites';
import { folderLabel } from '@/lib/favorites';
import { cn } from '@/lib/utils';
import { ProgressBody, StopButton, type ProgressState } from './ProgressDialog';

/**
 * 导入到云端收藏 — the original front end's 导入本页到云端 confirm, with the one thing it lacked: the
 * folder the pictures go into (the default folder, preselected). It states how many of the page's
 * pictures are not favourited yet; the run itself is the caller's.
 *
 * **One dialog, two faces** (M1-010): 导入 turns the question into the run's meter in place — the
 * run's face fading in over the question's on the pane swap's keyframe, as `AuthModal` swaps its
 * steps. It used to be two dialogs crossing on separate clocks, two scrims stacked darker than one
 * and the leaving one reading 本页有 0 张…. Both faces share one grid cell, so the dialog keeps the
 * question's height for the run and never moves on the screen. While the run is up it is not
 * dismissed any way but 停止 (`ProgressDialog`'s rule). It leaves showing what it showed: the
 * count, the choice and the run's last state are held through the exit and let go after it.
 */
export default function ImportDialog({
  open,
  count,
  folders,
  loading = false,
  error,
  onRetry,
  defaultFolderId,
  progress,
  onStop,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** The page's pictures that are not favourited yet. */
  count: number;
  folders: readonly FaveFolder[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  defaultFolderId: number;
  /** The run, once 导入 has started it. */
  progress: ProgressState | null;
  onStop: () => void;
  onClose: () => void;
  onConfirm: (folderId: number) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(count);
  if (open && count !== shownCount) setShownCount(count);
  const [run, setRun] = useState(progress);
  if (progress && progress !== run) setRun(progress);
  /* The run's face once it has started, until the dialog has gone. */
  const running = run !== null;
  const fallback = folders.some((folder) => folder.id === defaultFolderId)
    ? String(defaultFolderId)
    : String(folders.find((folder) => folder.isMain)?.id ?? folders[0]?.id ?? '');
  const value = chosen !== null && folders.some((folder) => String(folder.id) === chosen) ? chosen : fallback;
  const exited = () => {
    setChosen(null);
    setRun(null);
  };

  return (
    <Modal
      isOpen={open}
      onClose={running ? () => {} : onClose}
      onExited={exited}
      title="导入到云端收藏"
      /* Its dismiss is 取消, then 停止: never a ✕ that a run would have to take away. */
      hideCloseButton
      closeOnEscape={!running}
      closeOnOverlayClick={!running}
      maxWidth="sm"
      footer={
        running ? (
          <StopButton key="stop" state={run} onStop={onStop} autoFocus className="animate-page-transition" />
        ) : (
          <>
            <Button key="cancel" variant="text" onClick={onClose}>
              取消
            </Button>
            <Button
              key="import"
              variant="filled"
              disabled={!value || loading || Boolean(error)}
              onClick={() => onConfirm(Number(value))}
            >
              导入
            </Button>
          </>
        )
      }
    >
      <div className="grid">
        <div
          inert={running}
          aria-hidden={running || undefined}
          className={cn('col-start-1 row-start-1 transition-opacity spring-fast-effects', running && 'opacity-0')}
        >
          <p className="mb-4 text-body-m text-on-surface-variant">
            本页有 {shownCount} 张图片尚未收藏到云端，确定要导入吗？导入会逐张进行，可随时停止。
          </p>
          {error ? (
            <ErrorRetry size="inline" title="收藏夹加载失败" message={apiErrorMessage(error)} onRetry={onRetry} />
          ) : loading ? (
            <Skeleton className="h-14 w-full" />
          ) : folders.length === 0 ? (
            <EmptyState size="inline" title="请先在收藏夹中创建一个收藏夹" />
          ) : (
            <Select
              label="收藏到"
              value={value}
              onChange={setChosen}
              options={folders.map((folder) => ({ value: String(folder.id), label: folderLabel(folder) }))}
            />
          )}
        </div>
        {run && (
          <div key="run" className="col-start-1 row-start-1 self-center animate-page-transition">
            <ProgressBody state={run} />
          </div>
        )}
      </div>
    </Modal>
  );
}
