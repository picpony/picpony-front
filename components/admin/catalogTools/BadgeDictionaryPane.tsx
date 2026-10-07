'use client';
import { useState } from 'react';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import { Input, Textarea } from '@/components/Input';
import Select from '@/components/Select';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import type { BadgeDescription } from '@/lib/adminCatalogTools/model';
import { badgeDictionary } from '@/lib/resources';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import RefreshButton from '../RefreshButton';
import { defineAdminQuery, useAdminQuery, tableError } from '../queries';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

const query = defineAdminQuery('badge-dictionary', api.getBadgeDictionary);
export default function BadgeDictionaryPane({ token }: { token: string }) {
  const read = useAdminQuery(query, token);
  const paged = usePagedRows(read.data?.dicts ?? [], token);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState('');
  const mutation = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const committed = () => { query.expire(token); badgeDictionary.expire(); };
  const columns: Column<BadgeDescription>[] = [
    { key: 'name', header: '徽章', primary: true, render: (row) => row.badge_name },
    { key: 'description', header: '简介', className: 'whitespace-pre-wrap break-words', render: (row) => row.description || '暂无简介' },
    { key: 'actions', header: '操作', actions: true, render: (row) => <>
      <Button size="xs" variant="text" disabled={mutation.busy} onClick={() => { setName(row.badge_name); setDescription(row.description); }}>编辑</Button>
      <Button size="xs" variant="danger-text" disabled={mutation.busy || mutation.uncertain} onClick={() => confirmThen('确认删除简介', `确定要删除徽章「${row.badge_name}」的简介吗？已授予的徽章仍会保留。`, () => void mutation.run(() => api.deleteBadgeDescription(token, row.badge_name), () => showToast('已删除徽章简介', 'success'), committed))}>删除</Button>
    </> },
  ];
  return <div className="space-y-6">
    <AdminNote>同名徽章共用一份简介，用户可在徽章墙查看。</AdminNote>
    <AdminForm aria-label="徽章简介" onSubmit={() => {
      /* A blank name belongs on the field. Sent through the mutation it printed 操作未完成 for a
         request that never left the browser, naming nothing. */
      if (!name.trim()) { setNameError('请填写徽章名称'); return; }
      setNameError('');
      void mutation.run(() => api.saveBadgeDescription(token, name, description), () => showToast('已保存徽章简介', 'success'), committed);
    }}>
      {read.data?.names.length ? <Select label="选择已有徽章" value={name} options={[{ value: '', label: '选择徽章' }, ...[...new Set([...read.data.names, ...read.data.dicts.map((row) => row.badge_name), ...(name ? [name] : [])])].map((value) => ({ value, label: value }))]} onChange={(value) => { setName(value); setNameError(''); setDescription(read.data?.dicts.find((row) => row.badge_name === value)?.description ?? ''); }} disabled={mutation.busy} /> : <Input label="徽章名称" value={name} readOnly={mutation.busy} error={nameError || undefined} onChange={(event) => { setName(event.target.value); setNameError(''); }} />}
      <Textarea label="徽章简介" value={description} maxLength={10000} rows={4} readOnly={mutation.busy} onChange={(event) => setDescription(event.target.value)} />
      <MutationResult mutation={mutation} />
      <FormActions><RefreshButton onClick={read.refresh} label="刷新简介" loading={read.refreshing} /><Button type="submit" loading={mutation.busy} disabled={mutation.uncertain}>保存简介</Button></FormActions>
    </AdminForm>
    <AdminListAnchor><DataTable columns={columns} rows={paged.rows} listKey={paged.listKey} rowKey={(row) => row.badge_name} loading={read.loading} {...tableError('徽章简介加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} empty="暂无徽章简介" /><AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} /></AdminListAnchor>
    {confirmDialog}
  </div>;
}
