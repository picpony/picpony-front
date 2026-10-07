'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import ProgressBar from '@/components/ProgressBar';
import { showToast } from '@/components/Toast';
import { readToken } from '@/lib/hooks';
import { requireAdminSuccess } from '@/lib/adminMutations';
import { apiErrorMessage } from '@/lib/api/errors';
import { getDerpiPopularTags } from '@/lib/api/derpi';
import * as adminApi from '@/lib/api/admin';
import { AdminForm, AdminNote, FormGrid } from '../AdminForm';
import { reportedCount, syncRange, syncTasks } from './model';

const FORM_ID = 'glossary-sync-form';
/** Between two pages, so a long run does not hammer Derpibooru (the relay shares one IP). */
const PAGE_PAUSE_MS = 1000;

export interface SyncResult {
  created: number;
  skipped: number;
  failedTags: number;
  failedPages: number;
  stopped: boolean;
  /** A page was written whose answer did not say how many it created or skipped: the two sums are
   *  then a floor, and the tally says 至少 rather than presenting them as exact (G4-015's rule). */
  uncounted: boolean;
}

/**
 * One run's pages, one batch write each, into `result` — until the range ends, a page comes back
 * empty, or `current()` says the run was stopped or the account changed. A failed page is counted
 * and the run goes on; nothing is retried.
 */
async function syncPages(range: { from: number; to: number }, token: string, current: () => boolean, result: SyncResult,
  onPage: (page: number) => void, controller: { current: AbortController | null }) {
  for (let page = range.from; page <= range.to; page++) {
    if (!current()) break;
    onPage(page);
    const pageController = new AbortController();
    controller.current = pageController;
    try {
      const data = await getDerpiPopularTags(page, pageController.signal);
      if (!current()) break;
      const tasks = syncTasks(data.tags);
      if (tasks.length === 0) break;
      const answer = await requireAdminSuccess(await adminApi.batchImportDictionaryTags(token, tasks), '同步失败');
      const created = reportedCount(answer.created), skipped = reportedCount(answer.skipped);
      if (created === null || skipped === null) result.uncounted = true;
      result.created += created ?? 0;
      result.skipped += skipped ?? 0;
      /* An absent `failed` is "none reported", as `importStatus` reads `failed_count`. */
      result.failedTags += reportedCount(answer.failed) ?? 0;
    } catch (error) {
      if (!current()) break;
      result.failedPages += 1;
      /* One sentence for the first failed page; the tally says how many. */
      if (result.failedPages === 1) showToast(apiErrorMessage(error, `第 ${page} 页同步失败`), 'error');
    }
    if (page < range.to && current()) await new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS));
  }
}

/**
 * 同步热门: Derpibooru's tags by image count, a page of fifty at a time, written as new
 * untranslated entries — **one** `batch_import_dictionary_tags` per page, which skips what the
 * dictionary holds (it was an existence read and a save per tag, 40ms apart). The run shows its
 * page count on a `ProgressBar`, and 停止同步 ends it after the page in hand, abandoning that
 * page's read; the dialog cannot be dismissed while it runs.
 */
export default function SyncDialog({
  open,
  token,
  onClose,
  onRunningChange,
  onFinished,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onRunningChange: (running: boolean) => void;
  /** Called once per run that wrote anything, or was stopped or failed, with its tally. */
  onFinished: (result: SyncResult, visible: boolean) => void;
}) {
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState('20');
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});
  const [progress, setProgress] = useState<{ done: number; total: number; page: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const run = useRef(0);
  const locked = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const running = progress !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      run.current += 1;
      controller.current?.abort();
    };
  }, []);

  const stop = () => {
    run.current += 1;
    controller.current?.abort();
    setStopping(true);
  };

  const submit = async () => {
    if (locked.current || readToken() !== token) return;
    const range = syncRange(start, end);
    if ('error' in range) {
      setErrors({ [range.field]: range.error });
      return;
    }
    locked.current = true;
    const ticket = ++run.current;
    const current = () => run.current === ticket && readToken() === token;
    const total = range.to - range.from + 1;
    const result: SyncResult = { created: 0, skipped: 0, failedTags: 0, failedPages: 0, stopped: false, uncounted: false };
    setStopping(false);
    setProgress({ done: 0, total, page: range.from });
    onRunningChange(true);
    /* The cleanup is the promise's `finally`, not a `try` statement's: the React Compiler cannot
       lower a `try` without a `catch`, and skipped this whole dialog for it. */
    await syncPages(range, token, current, result, (page) => setProgress({ done: page - range.from, total, page }), controller).finally(() => {
      result.stopped = run.current !== ticket;
      controller.current = null;
      locked.current = false;
      if (readToken() === token) onFinished(result, mounted.current);
      if (mounted.current) {
        setProgress(null);
        setStopping(false);
        onRunningChange(false);
      }
    });
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => { if (!locked.current) onClose(); }}
      closeOnEscape={!running}
      hideCloseButton={running}
      title="同步原站热门标签"
      maxWidth="md"
      footer={
        running ? (
          <Button type="button" variant="danger" onClick={stop} loading={stopping}>
            停止同步
          </Button>
        ) : (
          <>
            <Button type="button" variant="text" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form={FORM_ID} variant="filled">
              开始同步
            </Button>
          </>
        )
      }
    >
      <AdminForm id={FORM_ID} onSubmit={() => void submit()} className="max-w-none" aria-label="同步原站热门标签">
        <AdminNote>按原站图片数量从高到低拉取标签，每页 50 个；词库中已有的标签会跳过，新标签记为未翻译。</AdminNote>
        {running ? (
          <div className="space-y-2" aria-live="polite">
            <ProgressBar value={(progress.done / progress.total) * 100} label="同步进度" />
            <p className="text-body-m text-on-surface-variant">
              {stopping ? '正在停止…' : `正在同步第 ${progress.page} 页 · 已完成 ${progress.done} / ${progress.total} 页`}
            </p>
          </div>
        ) : (
          <FormGrid>
            <Input
              label="起始页"
              inputMode="numeric"
              autoComplete="off"
              value={start}
              error={errors.start}
              onChange={(event) => {
                setStart(event.target.value);
                setErrors({});
              }}
            />
            <Input
              label="结束页"
              inputMode="numeric"
              autoComplete="off"
              value={end}
              error={errors.end}
              helper="一次最多 100 页"
              onChange={(event) => {
                setEnd(event.target.value);
                setErrors({});
              }}
            />
          </FormGrid>
        )}
      </AdminForm>
    </Modal>
  );
}
