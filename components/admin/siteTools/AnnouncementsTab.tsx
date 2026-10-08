'use client';

import { useState, type CSSProperties } from 'react';
import { MdDeleteOutline, MdVisibility } from 'react-icons/md';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import Modal from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { formatDateTime } from '@/lib/format';
import type { Announcement } from '@/lib/types/message';
import { announcementPayload, type Values } from '@/lib/adminSiteTools/model';
import * as adminApi from '@/lib/api/admin';
import { announcementHistory } from '@/lib/resources';
import { AdminForm, AdminNote, FormActions, FormGrid } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { AdminListAnchor, AdminPager } from '../paging';
import { tableError } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import type { AdminPanelProps } from '../registry';
import { fieldErrors, protectedPanel } from './common';
import { announcementsQuery, useToolPage } from './queries';

function AnnouncementsTab({ token }: AdminPanelProps) {
  const [draft, setDraft] = useState<Values>({ version: '', title: '', content: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  /* The previewed notice stays put while its dialog leaves: closing clears `open` alone, so the
     title and the body hold through the exit rather than turning into 公告 and an empty panel in
     the commit that closes it (M1-009). The next preview replaces it. */
  const [preview, setPreview] = useState<{ announcement: Announcement; open: boolean } | null>(null);
  const history = useToolPage(announcementsQuery, token, { page }, 'history');
  if (history.data && !history.isPrevious && !history.isLoading && !history.error && page > history.data.totalPages) setPage(history.data.totalPages);
  const publish = useAdminMutation(token), remove = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const refresh = () => { announcementsQuery.invalidate(); announcementHistory.invalidate(); };
  const submit = () => {
    if (publish.isPending()) return;
    let payload: ReturnType<typeof announcementPayload>;
    try { payload = announcementPayload(draft); } catch (error) { setErrors(fieldErrors(error)); return; }
    setErrors({});
    confirmThen('确认发布公告', `确定要向全站用户发布「${payload.title}」（${payload.version}）吗？相同版本会覆盖原公告，并提醒所有用户。`, () => void publish.run(
      () => adminApi.saveAnnouncement(token, payload), () => { setDraft({ ...draft, content: '' }); showToast('已发布公告', 'success'); }, '公告发布失败', { onCommitted: refresh },
    ));
  };
  const columns: Column<Announcement>[] = [
    { key: 'title', header: '标题', primary: true, render: (r) => r.title },
    { key: 'version', header: '版本', render: (r) => r.version },
    { key: 'date', header: '时间', render: (r) => formatDateTime(r.date) },
    { key: 'actions', header: '操作', actions: true, render: (r) => <>
      <IconButton size="sm" icon={<MdVisibility />} aria-label={`查看公告「${r.title}」`} onClick={() => setPreview({ announcement: r, open: true })} />
      <IconButton size="sm" variant="danger-text" icon={<MdDeleteOutline />} aria-label={`删除公告「${r.title}」`} loading={remove.pendingKeys.has(r.id)} onClick={() => confirmThen('确认删除公告', `确定要删除公告「${r.title}」（#${r.id}）吗？删除后无法恢复。`, () => void remove.run(() => adminApi.adminDeleteAnnouncement(token, Number(r.id)), () => showToast('已删除公告', 'success'), '公告删除失败', { key: r.id, onCommitted: refresh }))} />
    </> },
  ];
  return <div className="space-y-6">
    <SectionHeader section="announcement" onRefresh={history.refresh} isLoading={history.refreshing} />
    <AdminNote>发布后，公告会出现在全站用户的信箱中。正文支持 HTML，换行会保留。</AdminNote>
    <AdminForm aria-label="发布公告" onSubmit={submit}>
      <FormGrid>{['version', 'title'].map((key) => <Input key={key} label={key === 'version' ? '版本' : '标题'} value={String(draft[key])} error={errors[key]} readOnly={publish.busy} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setErrors({}); }} />)}</FormGrid>
      <Textarea label="公告正文" rows={7} value={String(draft.content)} error={errors.content} readOnly={publish.busy} onChange={(e) => { setDraft({ ...draft, content: e.target.value }); setErrors({}); }} />
      <FormActions><Button type="submit" loading={publish.busy}>发布公告</Button></FormActions>
    </AdminForm>
    <AdminListAnchor>
      <DataTable columns={columns} rows={history.data?.announcements ?? []} listKey={history.listKey} rowKey={(r) => r.id} loading={history.loading} {...tableError(history.isPrevious ? `第 ${page} 页加载失败` : '公告记录加载失败', history.message)} onRetry={history.retry} empty="暂无公告" />
      <AdminPager page={page} totalPages={history.data?.totalPages ?? 1} onPageChange={setPage} disabled={history.isLoading} />
    </AdminListAnchor>
    {/* The same treatment the readers get, copied from `AnnouncementModal`: this is the only tool
        for proofreading a site-wide notice, and it was styled `prose-content` — a class defined
        nowhere, so paragraphs touched and list markers were gone (Tailwind's preflight zeroes both),
        i.e. the admin saw something no visitor would. `--rt-quote-surface` comes with it because
        this preview is also inside a `Modal`, the quote's own default step. Already sanitised at
        read (`sanitizeAnnouncements`). */}
    <Modal isOpen={Boolean(preview?.open)} onClose={() => setPreview((current) => current && { ...current, open: false })} title={preview?.announcement.title ?? '公告'}>{preview && <div className="rich-text-content wrap-anywhere text-body-m text-on-surface-variant" style={{ '--rt-quote-surface': 'var(--md-sys-color-surface-container-highest)' } as CSSProperties} dangerouslySetInnerHTML={{ __html: preview.announcement.content }} />}</Modal>
    {confirmDialog}
  </div>;
}
export default protectedPanel(AnnouncementsTab);
