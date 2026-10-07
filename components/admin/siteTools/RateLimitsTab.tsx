'use client';

import { useState } from 'react';
import { MdEdit, MdLockOpen } from 'react-icons/md';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import { Input } from '@/components/Input';
import IconButton from '@/components/IconButton';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import Select from '@/components/Select';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { formatDateTime } from '@/lib/format';
import { ratePayload, type RateRule } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import { AdminForm, AdminNote, FormActions, FormGrid } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { useAdminQuery } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import type { AdminPanelProps } from '../registry';
import { protectedPanel, ReadState, fieldErrors } from './common';
import { rateQuery } from './queries';

function RateLimitsTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(rateQuery, token);
  const save = useAdminMutation(token), release = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<RateRule[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ action: string; closing: boolean } | null>(null);
  const rules = draft ?? read.data?.rules ?? [];
  const paged = usePagedRows(rules, null, 20), locks = usePagedRows(read.data?.locks ?? [], null, 20);
  const change = (action: string, name: keyof RateRule, value: string) => { setDraft(rules.map((r) => r.action === action ? { ...r, [name]: value } : r)); setErrors({}); };
  const closeEditor = () => setEditing((current) => current ? { ...current, closing: true } : null);
  const submit = () => {
    if (save.isPending()) return;
    try { ratePayload(rules); } catch (error) { setErrors(fieldErrors(error)); return; }
    const snapshot = rules.map((r) => ({ ...r }));
    confirmThen('确认保存频率规则', `确定要更新全部 ${rules.length} 项接口的请求频率规则吗？所有访客与用户都会受此规则影响。`, () => void save.run(() => api.saveRateLimits(token, snapshot), () => { setDraft(null); showToast('已保存频率规则', 'success'); }, '频率规则保存失败', { onCommitted: () => rateQuery.invalidate() }));
  };
  return <div className="space-y-6">
    <SectionHeader section="rate-management" onRefresh={read.refresh} isLoading={read.refreshing} />
    <ReadState title="频率规则加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
      {read.data && <>
        <AdminForm aria-labelledby="admin-rate-rules-heading" onSubmit={submit} className="max-w-none">
          <SectionHeading as="h3" id="admin-rate-rules-heading">频率规则</SectionHeading>
          <AdminNote>展开一项规则进行编辑，完成后按「保存频率规则」统一提交。</AdminNote>
          <AdminListAnchor>
            <DataTable rows={paged.rows} listKey={paged.listKey} rowKey={(r) => r.action} empty="暂无可配置的接口" expandedRow={(r) => editing?.action === r.action ? <InlineEditorPanel id={`rate-editor-${r.action}`} label={`编辑${r.label}`} isClosing={editing.closing} onEscape={closeEditor} onExitComplete={() => setEditing((current) => current?.action === r.action && current.closing ? null : current)}>
              <div className="max-w-2xl space-y-4">
                <FormGrid>
                  <Input label={`${r.label}次数`} inputMode="numeric" value={r.max} readOnly={save.busy} onChange={(e) => change(r.action, 'max', e.target.value)} />
                  <Input label={`${r.label}窗口（秒）`} inputMode="numeric" value={r.window} readOnly={save.busy} onChange={(e) => change(r.action, 'window', e.target.value)} />
                  <Select label="计数对象" value={r.key_type} options={[{ value: 'ip', label: 'IP 地址' }, { value: 'user', label: '用户' }]} disabled={save.busy} onChange={(v) => change(r.action, 'key_type', v)} />
                </FormGrid>
                <FormActions><Button type="button" variant="text" onClick={closeEditor}>收起编辑</Button></FormActions>
              </div>
            </InlineEditorPanel> : null} columns={[
              { key: 'name', header: '用途', primary: true, render: (r) => r.label },
              { key: 'max', header: '最多次数', render: (r) => r.max },
              { key: 'window', header: '时间窗口', render: (r) => `${r.window} 秒` },
              { key: 'key', header: '计数对象', render: (r) => r.key_type === 'ip' ? 'IP 地址' : '用户' },
              { key: 'actions', header: '操作', actions: true, render: (r) => <IconButton size="sm" icon={<MdEdit />} aria-label={`编辑${r.label}规则`} aria-controls={`rate-editor-${r.action}`} aria-expanded={editing?.action === r.action && !editing.closing} disabled={save.busy} onClick={(event) => { captureInlineEditorLayout(event.currentTarget); setEditing({ action: r.action, closing: false }); }} /> },
            ]} />
            <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
          </AdminListAnchor>
          {Object.values(errors).map((error) => <p key={error} role="alert" className="text-body-s text-error">{error}</p>)}
          <FormActions><Button type="submit" loading={save.busy} disabled={!rules.length}>保存频率规则</Button></FormActions>
        </AdminForm>
        <section className="space-y-4" aria-labelledby="admin-temporary-locks-heading">
          <SectionHeading as="h3" id="admin-temporary-locks-heading">临时封禁</SectionHeading>
          <AdminListAnchor>
            {/* No `tableError` here: 频率规则 and 临时封禁 are two halves of one read, and `ReadState`
                above already prints its failure — passing it again drew the same failure twice,
                under two different nouns. */}
            <DataTable rows={locks.rows} listKey={locks.listKey} rowKey={(r) => r.id} empty="当前没有临时封禁用户" columns={[
              { key: 'name', header: '用户', primary: true, render: (r) => `${r.username}（#${r.id}）` },
              { key: 'attempts', header: '尝试次数', render: (r) => r.attempts },
              { key: 'until', header: '解除时间', render: (r) => formatDateTime(r.until * 1000) },
              { key: 'actions', header: '操作', actions: true, render: (r) => <IconButton size="sm" icon={<MdLockOpen />} aria-label={`解除 ${r.username} 的临时封禁`} loading={release.pendingKeys.has(r.id)} onClick={() => confirmThen('确认解除临时封禁', `确定要解除「${r.username}」（#${r.id}）的临时封禁吗？`, () => void release.run(() => api.releaseLock(token, r.id), () => showToast('已解除临时封禁', 'success'), '临时封禁解除失败', { key: r.id, onCommitted: () => rateQuery.invalidate() }))} /> },
            ]} />
            <AdminPager page={locks.page} totalPages={locks.totalPages} onPageChange={locks.setPage} />
          </AdminListAnchor>
        </section>
      </>}
    </ReadState>
    {confirmDialog}
  </div>;
}
export default protectedPanel(RateLimitsTab);
