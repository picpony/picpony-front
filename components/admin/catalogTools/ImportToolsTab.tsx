'use client';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { formatCount } from '@/lib/format';
import type { AdminPanelProps } from '../registry';
import { retryError, useAdminQuery } from '../queries';
import { translationQuery } from '../sharedQueries';
import SectionHeader from '../SectionHeader';
import { AdminNote } from '../AdminForm';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

const QUEUE_METRICS = [
  { key: 'pending', label: '排队' },
  { key: 'translating', label: '翻译中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
] as const;

/**
 * 数据维护: the image-translation queue (`GET /admin/translation`, counted by status) and its two
 * maintenance writes, after which the counts are read again. The image-tag database and PPSync
 * dictionary-package imports this section used to host have no endpoint on the `/api/v1` backend
 * (`image_tags_importer.php` / `tag_sync_importer.php` were not ported), so they are gone with
 * their `/admin/import-tools/*` proxy routes rather than offered against a server that cannot
 * answer them.
 */
export default function ImportToolsTab({ token }: AdminPanelProps) {
  const queue = useCatalogMutation(token);
  const failures = useCatalogMutation(token);
  const translation = useAdminQuery(translationQuery, token);
  const counts = translation.data?.queue;
  const { confirmThen, confirmDialog } = useConfirm();
  return (
    <div className="@container space-y-6">
      <SectionHeader section="data-import" onRefresh={translation.refresh} isLoading={translation.refreshing} />
      {translation.error && (
        <ErrorRetry
          size="inline"
          {...retryError('翻译队列加载失败', translation.error)}
          onRetry={translation.retryable ? translation.refresh : undefined}
        />
      )}
      {(counts || !translation.error) && (
        <dl role="status" aria-label="翻译队列状态" className="grid grid-cols-2 gap-3 @md:grid-cols-4">
          {QUEUE_METRICS.map(({ key, label }, index) => (
            <Card key={key} variant="filled" padding="sm" className="space-y-1">
              <dt className="text-body-s text-on-surface-variant">{label}</dt>
              <dd className="text-title-l tabular-nums text-on-surface">
                {counts ? formatCount(counts[key]) : <Skeleton className="h-7 w-16" delay={index * 40} />}
              </dd>
            </Card>
          ))}
        </dl>
      )}
      <AdminNote>
        仅在图片翻译队列停滞或需要重新尝试失败任务时维护。清空队列会把排队和翻译中的任务标记为失败。
      </AdminNote>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          loading={queue.busy}
          disabled={queue.uncertain}
          onClick={() =>
            confirmThen(
              '确认清空翻译队列',
              '确定要将全部排队和翻译中的任务标记为失败吗？已提交的清理无法取消。',
              () =>
                void queue.run(
                  () => api.clearTranslationQueue(token),
                  () => {
                    translationQuery.invalidate(token);
                    showToast('已清空翻译队列', 'success');
                  },
                ),
              { tone: 'danger' },
            )
          }
        >
          清空翻译队列
        </Button>
        <Button
          variant="tonal"
          loading={failures.busy}
          disabled={failures.uncertain}
          onClick={() =>
            confirmThen(
              '确认重置失败计数',
              '确定要重置全部图片的翻译失败计数吗？重置后将重新尝试失败任务。',
              () =>
                void failures.run(
                  () => api.clearTranslationFailures(token),
                  () => {
                    translationQuery.invalidate(token);
                    showToast('已重置翻译失败计数', 'success');
                  },
                ),
              { tone: 'filled' },
            )
          }
        >
          重置失败计数
        </Button>
      </div>
      <MutationResult mutation={queue} />
      <MutationResult mutation={failures} />
      {confirmDialog}
    </div>
  );
}
