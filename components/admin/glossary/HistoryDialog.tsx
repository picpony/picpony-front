'use client';

import { useState } from 'react';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { SKIP, useResource } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { tagCategoryChip } from '@/lib/tagCategories';
import { cn } from '@/lib/utils';
import { retryError } from '../queries';
import { historyAliases, historyTime, type GlossaryTag } from './model';
import { tagHistory } from './resources';

/**
 * 编辑历史: an entry's versions, newest first, and the snapshot of the one chosen. Times are the
 * backend's UTC converted to the app's clock (`historyTime`).
 *
 * **The read outlives `open` by the exit.** Gated on `open` alone, the commit that closes the dialog
 * turned it to `SKIP`, which drops the retained answer, and the leaving dialog collapsed to its
 * skeleton — 496px of records shrinking to a 316px placeholder and re-centring, at full opacity
 * (M1-008). `live` is set by opening and released by `Modal`'s `onExited`.
 *
 * Rows and the snapshot sit one container step *above* the dialog (`surface-container-highest` on
 * its `high`), as every list in a dialog does; on `low` they were a recessed hole two steps down
 * (G4-009).
 */
export default function HistoryDialog({
  token,
  tag,
  open,
  onClose,
}: {
  token: string;
  tag: GlossaryTag | null;
  open: boolean;
  onClose: () => void;
}) {
  const [live, setLive] = useState(open);
  if (open && !live) setLive(true);
  const read = useResource(tagHistory, live && tag && token ? { token, tagId: tag.id } : SKIP);
  const records = read.data ?? [];
  const [chosen, setChosen] = useState(0);
  const selected = records[Math.min(chosen, records.length - 1)] ?? null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      onExited={() => setLive(false)}
      title={tag ? `编辑历史 · ${tag.en}` : '编辑历史'}
      maxWidth="2xl"
    >
      {read.data === undefined && read.error ? (
        <ErrorRetry
          size="inline"
          {...retryError('编辑历史加载失败', apiErrorMessage(read.error))}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      ) : read.data === undefined ? (
        <div aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="m3-row flex flex-col gap-2 bg-surface-container-highest p-4">
              <Skeleton className="h-4 w-1/3" delay={index * 80} />
              <Skeleton className="h-4 w-1/2" delay={index * 80 + 60} />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <EmptyState size="inline" title="暂无编辑记录" />
      ) : (
        <div className="space-y-4">
          <div role="group" aria-label="编辑记录">
            {records.map((record, index) => {
              const active = record === selected;
              return (
                <button
                  key={index}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setChosen(index)}
                  className={cn(
                    'm3-row flex w-full flex-col gap-0.5 p-4 text-left transition-ui focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset',
                    active ? 'bg-secondary-container text-on-secondary-container forced-selected' : 'state-layer bg-surface-container-highest text-on-surface',
                  )}
                >
                  <span className="text-body-m-emphasized">{historyTime(record.created_at) || '时间未知'}</span>
                  <span className={cn('text-body-s', !active && 'text-on-surface-variant')}>
                    {record.editor_username || '未知用户'}
                  </span>
                </button>
              );
            })}
          </div>
          {selected && (
            <dl className="grid gap-x-6 gap-y-3 rounded-md bg-surface-container-highest p-4 text-body-m sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-label-l text-on-surface-variant">英文标签</dt>
                <dd className="font-mono text-on-surface wrap-anywhere">{selected.en_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-label-l text-on-surface-variant">中文翻译</dt>
                <dd className="text-on-surface wrap-anywhere">{selected.cn_name?.trim() ? selected.cn_name : '未翻译'}</dd>
              </div>
              <div>
                <dt className="text-label-l text-on-surface-variant">别名</dt>
                <dd className="text-on-surface wrap-anywhere">{historyAliases(selected.aliases) || '无'}</dd>
              </div>
              <div>
                <dt className="text-label-l text-on-surface-variant">分类</dt>
                <dd className="mt-1">
                  <Badge colors={tagCategoryChip(selected.category || 'general')}>{selected.category || 'general'}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-label-l text-on-surface-variant">图片数</dt>
                <dd className="tabular-nums text-on-surface">{selected.search_count ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-label-l text-on-surface-variant">简介</dt>
                <dd className="whitespace-pre-wrap text-on-surface-variant wrap-anywhere">{selected.description || '无'}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </Modal>
  );
}
