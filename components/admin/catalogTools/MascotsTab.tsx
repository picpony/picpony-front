'use client';
import { useState } from 'react';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import FadeInImage from '@/components/FadeInImage';
import { Input, Textarea } from '@/components/Input';
import Modal from '@/components/Modal';
import ToggleSwitch from '@/components/ToggleSwitch';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { getAssetUrl } from '@/lib/utils';
import * as api from '@/lib/api/adminCatalogTools';
import { adminSaveMascotConfig } from '@/lib/api/admin';
import { mascotPayload, mascotProblems, type Mascot } from '@/lib/adminCatalogTools/model';
import { mascotConfig } from '@/lib/mascot/queries';
import type { AdminPanelProps } from '../registry';
import SectionHeader from '../SectionHeader';
import { AdminForm, AdminNote } from '../AdminForm';
import { defineAdminQuery, useAdminQuery, tableError } from '../queries';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';
import CatalogImageInput from './CatalogImageInput';

const query = defineAdminQuery('catalog-mascots', api.getMascots);
const committed = (token: string) => { query.expire(token); mascotConfig.expire(); };
export default function MascotsTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(query, token);
  const paged = usePagedRows(read.data?.mascots ?? [], token);
  const mutation = useCatalogMutation(token);
  const globalMutation = useCatalogMutation(token);
  const [editing, setEditing] = useState<Mascot | 'new' | null>(null);
  /* Two pieces of state, not one: `editing` drives `isOpen` and `shown` keeps the row the editor was
     opened for *while it leaves*, so closing plays `Modal`'s own exit instead of unmounting the panel
     between two frames. `shown` also keys the instance, so opening a different row starts from that
     row's values rather than the previous one's. */
  const [shown, setShown] = useState<Mascot | 'new' | null>(null);
  const open = (item: Mascot | 'new') => { setShown(item); setEditing(item); };
  const { confirmThen, confirmDialog } = useConfirm();
  const columns: Column<Mascot>[] = [
    { key: 'name', header: '吉祥物', primary: true, render: (row) => <span className="flex min-w-0 items-center gap-3"><span className="relative block size-14 shrink-0"><FadeInImage src={getAssetUrl(row.image_url)} alt="" unoptimized fill sizes="56px" className="object-contain" /></span><span className="min-w-0 break-words">{row.name}</span></span> },
    { key: 'tips', header: '台词', width: 'auto', render: (row) => `${row.tips.length} 条` },
    /* `aria-label`, not a visible `label`: the column header already says 展示, and a control whose
       accessible name changes as you use it ('已启用' / '已停用') is the 收藏 / 取消收藏 mistake
       AGENTS names — `aria-checked` is what carries the state. */
    { key: 'active', header: '展示', render: (row) => <ToggleSwitch checked={row.is_active} aria-label={`展示 ${row.name}`} disabled={mutation.busy || mutation.uncertain} onChange={(enabled) => void mutation.run(() => api.toggleMascot(token, row.id, enabled), () => showToast('已更新展示状态', 'success'), () => committed(token))} /> },
    { key: 'actions', header: '操作', actions: true, render: (row) => <><Button size="xs" variant="text" disabled={mutation.busy} onClick={() => open(row)}>编辑</Button><Button size="xs" variant="danger-text" disabled={mutation.busy || mutation.uncertain} onClick={() => confirmThen('确认删除吉祥物', `确定要删除吉祥物「${row.name}」及其 ${row.tips.length} 条台词吗？此操作不可撤销。`, () => void mutation.run(() => api.deleteMascot(token, row.id), () => showToast('已删除吉祥物', 'success'), () => committed(token)))}>删除</Button></> },
  ];
  return <div className="space-y-6">
    <SectionHeader section="mascots" onRefresh={read.refresh} isLoading={read.refreshing} />
    <AdminNote>管理角色图片、台词和展示状态。全局关闭后，用户端不再展示吉祥物。</AdminNote>
    {read.data && <ToggleSwitch layout="row" label="全局展示吉祥物" checked={read.data.enabled} disabled={globalMutation.busy || globalMutation.uncertain} onChange={(enabled) => confirmThen(enabled ? '确认开启吉祥物' : '确认关闭吉祥物', `确定要${enabled ? '开启' : '关闭'}全站吉祥物展示吗？`, () => void globalMutation.run(() => api.catalogWrite(() => adminSaveMascotConfig(token, { enabled })), () => showToast('已保存吉祥物设置', 'success'), () => committed(token)), { tone: 'filled' })} />}
    {!!read.data?.skipped && <AdminNote tone="warning">有 {read.data.skipped} 条吉祥物记录无法读取，已跳过。其余记录可以正常管理。</AdminNote>}
    <MutationResult mutation={globalMutation} /><MutationResult mutation={mutation} />
    <Button variant="tonal" onClick={() => open('new')}>添加吉祥物</Button>
    <AdminListAnchor><DataTable columns={columns} rows={paged.rows} listKey={paged.listKey} rowKey={(row) => row.id} loading={read.loading} {...tableError('吉祥物加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} empty="暂无吉祥物" /><AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} /></AdminListAnchor>
    {shown && <MascotEditor key={shown === 'new' ? 'new' : shown.id} isOpen={editing !== null} token={token} item={shown === 'new' ? undefined : shown} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    {confirmDialog}
  </div>;
}
function MascotEditor({ isOpen, token, item, onClose, onSaved }: { isOpen: boolean; token: string; item?: Mascot; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [image, setImage] = useState(item?.image_url ?? '');
  const [tips, setTips] = useState(item?.tips.join('\n') ?? '');
  const [problems, setProblems] = useState<ReturnType<typeof mascotProblems>>({});
  const [uploading, setUploading] = useState(false);
  const mutation = useCatalogMutation(token);
  const busy = mutation.busy || uploading;
  /* Validate first, then send: a refusal belongs on the field, not in `MutationResult`, which is
     for the outcome of a request that was actually made. */
  const submit = () => {
    if (busy) return;
    const found = mascotProblems(name, image, tips);
    setProblems(found);
    if (Object.keys(found).length) return;
    void mutation.run(() => api.saveMascot(token, mascotPayload(name, image, tips, item?.id)), () => { showToast('已保存吉祥物', 'success'); onSaved(); }, () => committed(token));
  };
  return <Modal isOpen={isOpen} title={item ? `编辑吉祥物 · ${item.name}` : '添加吉祥物'} onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy} footer={<><Button variant="text" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" form="mascot-editor" loading={mutation.busy} disabled={uploading || mutation.uncertain}>保存吉祥物</Button></>}>
    <AdminForm id="mascot-editor" aria-label="吉祥物资料" onSubmit={submit}>
      <Input label="吉祥物名称" value={name} maxLength={200} readOnly={busy} error={problems.name} onChange={(event) => { setName(event.target.value); setProblems({ ...problems, name: undefined }); }} />
      <Input label="图片链接" value={image} maxLength={2048} readOnly={busy} error={problems.image} onChange={(event) => { setImage(event.target.value); setProblems({ ...problems, image: undefined }); }} />
      <CatalogImageInput token={token} kind="mascot" disabled={mutation.busy} onBusy={setUploading} onUploaded={(url) => { setImage(url); setProblems({ ...problems, image: undefined }); }} />
      <Textarea label="角色台词" helper="每行一条，最多 200 条" rows={6} value={tips} readOnly={busy} error={problems.tips} onChange={(event) => { setTips(event.target.value); setProblems({ ...problems, tips: undefined }); }} />
      <MutationResult mutation={mutation} />
    </AdminForm>
  </Modal>;
}
