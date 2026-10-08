'use client';
import { useState } from 'react';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import DataTable, { type Column } from '@/components/DataTable';
import { Input, Textarea } from '@/components/Input';
import SearchInput from '@/components/SearchInput';
import Modal from '@/components/Modal';
import ToggleSwitch from '@/components/ToggleSwitch';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import { mergeDiscovery, type Pony, type Speech } from '@/lib/adminCatalogTools/model';
import { defineResource, useResource, SKIP } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { ponyCatalog, myPonies, ponyConfigs } from '@/lib/desktopPonies/queries';
import type { AdminPanelProps } from '../registry';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { defineAdminQuery, useAdminQuery, tableError } from '../queries';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

const query = defineAdminQuery('catalog-ponies', api.getPonies);
const committed = (token: string) => { query.expire(token); ponyCatalog.expire(); myPonies.expire({ token }); ponyConfigs.expire(); };
const speechQuery = defineResource<{ token: string; name: string; path: string }, Speech[]>({ name: 'admin-pony-speeches', key: (p) => JSON.stringify(p), ttl: 60000, maxEntries: 8, fetch: (p, signal) => { if (readToken() !== p.token) throw new Error('登录状态已失效'); return api.getPonySpeeches(p.token, p.name, p.path, signal); } });
export default function PoniesTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(query, token);
  const [draft, setDraft] = useState<{ enabled: boolean; ponies: Pony[] } | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Pony | null>(null);
  /* The editor stays mounted once opened so closing plays `Modal`'s own exit instead of
     disappearing between two frames; `shownPony` holds the row it was opened for while it leaves,
     and keys the instance so a different角色 starts from its own values. */
  /* `shownRow` keeps the角色 the editor was opened for while it leaves, so closing plays `Modal`'s
     own exit rather than vanishing between two frames, and keys the instance so a different角色
     starts from its own values. */
  const [shownRow, setShownRow] = useState<Pony | null>(null);
  const mutation = useCatalogMutation(token);
  const discovery = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const config = draft ?? read.data;
  const paged = usePagedRows(config?.ponies.filter((row) => row.name.toLowerCase().includes(filter.toLowerCase())) ?? [], `${token}:${filter}`);
  const busy = mutation.busy || discovery.busy;
  const columns: Column<Pony>[] = [
    { key: 'name', header: '角色', primary: true, render: (row) => row.name },
    /* `aria-label`, not `label`: `Checkbox`'s `label` renders visible text inside the
       `<label>`, so every row printed 「展示 <角色名>」 beside its box under a column already
       headed 展示. */
    { key: 'enabled', header: '展示', render: (row) => <Checkbox checked={row.enabled} aria-label={`展示 ${row.name}`} disabled={busy} onChange={(enabled) => { if (config) setDraft({ ...config, ponies: config.ponies.map((p) => p.path === row.path ? { ...p, enabled } : p) }); }} /> },
    { key: 'actions', header: '操作', actions: true, render: (row) => <Button size="xs" variant="text" disabled={busy} onClick={() => { setShownRow(row); setSelected(row); }}>名称与台词</Button> },
  ];
  function scan() { if (config) void discovery.run(() => api.scanPonies(token), (found) => { setDraft({ ...config, ponies: mergeDiscovery(config.ponies, found) }); showToast(`已发现 ${found.length} 个角色，请保存展示设置`, 'success'); }); }
  return <div className="space-y-6">
    <SectionHeader section="ponies" onRefresh={() => { if (!draft) read.refresh(); else confirmThen('确认重新读取', '确定要放弃尚未保存的展示设置并重新读取吗？', () => { setDraft(null); read.refresh(); }); }} isLoading={read.refreshing} />
    <AdminNote>扫描资源库后选择可展示的角色，再保存全站设置。名称和台词分别保存。</AdminNote>
    {config && <AdminForm aria-label="桌面小马设置" onSubmit={() => confirmThen('确认保存展示设置', `确定要${config.enabled ? '开启' : '关闭'}桌面小马并保存 ${config.ponies.length} 个角色的设置吗？其中 ${config.ponies.filter((row) => row.enabled).length} 个角色已勾选。`, () => void mutation.run(() => api.savePonies(token, config.enabled, config.ponies), () => { setDraft(null); showToast('已保存桌面小马设置', 'success'); }, () => { query.write(token, { ...config, skipped: read.data?.skipped ?? 0 }); committed(token); }), { tone: 'filled' })}>
      <ToggleSwitch layout="row" checked={config.enabled} label="全局展示桌面小马" disabled={busy} onChange={(enabled) => setDraft({ ...config, enabled })} />
      <FormActions><Button type="button" variant="text" loading={discovery.busy} disabled={mutation.busy || discovery.uncertain} onClick={scan}>扫描资源库</Button><Button type="submit" loading={mutation.busy} disabled={discovery.busy || mutation.uncertain}>保存展示设置</Button></FormActions>
    </AdminForm>}
    <MutationResult mutation={mutation} /><MutationResult mutation={discovery} />
    <SearchInput value={filter} onChange={setFilter} placeholder="筛选角色…" />
    {!!read.data?.skipped && <AdminNote tone="warning">有 {read.data.skipped} 个角色记录无法读取，已跳过。其余角色可以正常管理。</AdminNote>}
    {config && <div className="flex flex-wrap gap-2">{[true, false].map((enabled) => <Button key={String(enabled)} variant="text" size="xs" disabled={busy} onClick={() => confirmThen('确认批量选择', `确定要将全部 ${config.ponies.length} 个角色${enabled ? '勾选' : '取消勾选'}吗？保存后生效。`, () => setDraft({ ...config, ponies: config.ponies.map((row) => ({ ...row, enabled })) }), { tone: 'filled' })}>{enabled ? '全选角色' : '取消全选'}</Button>)}</div>}
    <AdminListAnchor><DataTable columns={columns} rows={paged.rows} listKey={paged.listKey} rowKey={(row) => row.path} loading={read.loading} {...tableError('角色加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} empty="暂无角色，可扫描资源库" /><AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} /></AdminListAnchor>
    {shownRow && <PonyEditor key={shownRow.path} isOpen={selected !== null} token={token} pony={shownRow} onClose={() => setSelected(null)} onRenamed={(name) => {
      /* A rename is saved on its own. It corrects an unsaved draft when there is one; without one it
         corrects the read itself — minting a draft from it made the panel claim unsaved settings
         (刷新 asked to discard them) and pinned every row to this snapshot, hiding the re-read
         `committed` asks for (review P6-F6). */
      const renamed = (rows: Pony[]) => rows.map((row) => row.path === shownRow.path ? { ...row, name } : row);
      if (draft) setDraft({ ...draft, ponies: renamed(draft.ponies) });
      else if (read.data) { const base = read.data; query.write(token, (previous) => { const current = previous ?? base; return { ...current, ponies: renamed(current.ponies) }; }); query.expire(token); }
      setShownRow({ ...shownRow, name }); setSelected((current) => current && { ...current, name });
    }} />}
    {confirmDialog}
  </div>;
}
function PonyEditor({ isOpen, token, pony, onClose, onRenamed }: { isOpen: boolean; token: string; pony: Pony; onClose: () => void; onRenamed: (name: string) => void }) {
  const [name, setName] = useState(pony.name);
  const [editing, setEditing] = useState<Speech | null>(null);
  const read = useResource(speechQuery, token ? { token, name: pony.name, path: pony.path } : SKIP);
  const rename = useCatalogMutation(token);
  const save = useCatalogMutation(token);
  const busy = rename.busy || save.busy;
  const columns: Column<Speech>[] = [
    { key: 'name', header: '台词', primary: true, render: (row) => row.name },
    { key: 'text', header: '内容', className: 'whitespace-pre-wrap break-words', render: (row) => row.text },
    { key: 'audio', header: '音频', render: (row) => row.audio.length ? `${row.audio.length} 个文件` : '无音频' },
    { key: 'actions', header: '操作', actions: true, render: (row) => <Button size="xs" variant="text" disabled={busy} onClick={() => setEditing(row)}>编辑台词</Button> },
  ];
  return <Modal isOpen={isOpen} title={`角色 · ${pony.name}`} onClose={() => { if (!busy) onClose(); }} closeOnEscape={!busy} footer={<Button variant="text" disabled={busy} onClick={onClose}>完成</Button>}>
    <div className="space-y-6">
      <AdminForm aria-label="修改角色名称" onSubmit={() => void rename.run(() => api.savePonyName(token, pony.path, pony.name, name), (data) => { const saved = typeof data.new_name === 'string' && data.new_name.trim() ? data.new_name : name.trim(); onRenamed(saved); setName(saved); showToast('已保存角色名称', 'success'); }, () => committed(token))}><Input label="角色名称" value={name} maxLength={200} readOnly={busy} onChange={(event) => setName(event.target.value)} /><FormActions><Button type="submit" variant="tonal" loading={rename.busy} disabled={save.busy || rename.uncertain}>保存名称</Button></FormActions><MutationResult mutation={rename} /></AdminForm>
      <DataTable columns={columns} rows={read.data ?? []} rowKey={(row) => row.name} loading={read.data === undefined && !read.error} {...tableError('台词加载失败', read.error ? apiErrorMessage(read.error) : undefined)} onRetry={read.error && isRetryable(read.error) ? read.refresh : undefined} empty="暂无台词" />
      {editing && <AdminForm aria-label={`编辑台词 ${editing.name}`} onSubmit={() => void save.run(() => api.savePonySpeech(token, pony.path, editing.name, editing.text), () => { setEditing(null); showToast('已保存台词', 'success'); }, () => { speechQuery.expire({ token, name: pony.name, path: pony.path }); ponyConfigs.expire(); })}><Textarea label={`台词内容 · ${editing.name}`} rows={4} maxLength={10000} value={editing.text} readOnly={busy} onChange={(event) => setEditing({ ...editing, text: event.target.value })} /><FormActions><Button type="button" variant="text" disabled={busy} onClick={() => setEditing(null)}>取消编辑</Button><Button type="submit" loading={save.busy} disabled={rename.busy || save.uncertain}>保存台词</Button></FormActions></AdminForm>}
      <MutationResult mutation={save} />
    </div>
  </Modal>;
}
