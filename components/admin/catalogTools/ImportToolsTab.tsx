'use client';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import ErrorRetry from '@/components/ErrorRetry';
import { formatCount } from '@/lib/format';
import type { AdminPanelProps } from '../registry';
import { retryError, useAdminQuery } from '../queries';
import { translationQuery } from '../sharedQueries';
import SectionHeader from '../SectionHeader';
import { AdminNote } from '../AdminForm';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

/**
 * 数据维护: the image-translation queue (`GET /admin/translation`, counted by status) and its two
 * maintenance writes, after which the counts are read again. The image-tag database and PPSync
 * dictionary-package imports this section used to host have no endpoint on the `/api/v1` backend
 * (`image_tags_importer.php` / `tag_sync_importer.php` were not ported), so they are gone with
 * their `/admin/import-tools/*` proxy routes rather than offered against a server that cannot
 * answer them.
 */
export default function ImportToolsTab({ token }: AdminPanelProps) {
  const queue = useCatalogMutation(token); const failures = useCatalogMutation(token);
  const translation = useAdminQuery(translationQuery, token);
  const counts = translation.data?.queue;
  const { confirmThen, confirmDialog } = useConfirm();
  return <div className="space-y-6">
    <SectionHeader section="data-import" onRefresh={translation.refresh} isLoading={translation.refreshing} />
    {translation.error && <ErrorRetry size="inline" {...retryError('翻译队列加载失败', translation.error)} onRetry={translation.retryable ? translation.refresh : undefined} />}
    {counts && <p role="status" className="text-body-m tabular-nums">{`排队 ${formatCount(counts.pending)} · 翻译中 ${formatCount(counts.translating)} · 已完成 ${formatCount(counts.completed)} · 失败 ${formatCount(counts.failed)}`}</p>}
    <AdminNote>仅在图片翻译队列停滞或需要重新尝试失败任务时维护。清空队列会把排队和翻译中的任务标记为失败。</AdminNote>
    <div className="flex flex-wrap gap-3">
      <Button variant="danger" loading={queue.busy} disabled={queue.uncertain} onClick={() => confirmThen('确认清空翻译队列', '确定要将全部排队和翻译中的任务标记为失败吗？已经提交的清理不能取消。', () => void queue.run(() => api.clearTranslationQueue(token), () => { translationQuery.invalidate(token); showToast('已清空翻译队列', 'success'); }))}>清空翻译队列</Button>
      <Button variant="tonal" loading={failures.busy} disabled={failures.uncertain} onClick={() => confirmThen('确认重置失败计数', '确定要重置全部图片的翻译失败计数吗？系统将可以重新尝试这些任务。', () => void failures.run(() => api.clearTranslationFailures(token), () => { translationQuery.invalidate(token); showToast('已重置翻译失败计数', 'success'); }))}>重置失败计数</Button>
    </div>
    <MutationResult mutation={queue} /><MutationResult mutation={failures} />
    {confirmDialog}
  </div>;
}
