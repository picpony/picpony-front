'use client';

import { useState } from 'react';
import { MdBlock, MdLockOpen, MdRefresh } from 'react-icons/md';
import Badge from '@/components/Badge';
import SearchInput from '@/components/SearchInput';
import DataTable from '@/components/DataTable';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminSiteTools';
import { AdminNote } from '../AdminForm';
import { derived, retryError, tableError, useAdminQuery, useAdminSelect } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import type { AdminPanelProps } from '../registry';
import { usersQuery, type AdminUsers } from '../sharedQueries';
import { protectedPanel } from './common';
import { accelerationBansQuery } from './queries';

/** The API 加速 rows, from 用户管理's own read (`usersQuery`) rather than a third copy of the whole
 *  account list (G2-019). */
const accelerationRows = derived(({ rows }: AdminUsers) => rows.map((r) => ({ id: r.id, username: r.username, role: r.role })));

/**
 * API 加速权限. Who is barred comes from `GET /admin/api-accel-bans`; a row's own re-read
 * (`GET /admin/users/{id}`, `api_accel_banned`) or a change in this session overrides it until the
 * list is read again. Until the list has loaded (or when it failed) a row is unknown and offers
 * both 禁用 and 恢复 rather than drawing a guess.
 */
function DeveloperSiteTools({ token, viewerId, role }: AdminPanelProps) {
  const users = useAdminSelect(usersQuery, token, accelerationRows);
  const bans = useAdminQuery(accelerationBansQuery, token);
  const ban = useAdminMutation(token), lookup = useAdminMutation(token);
  const [known, setKnown] = useState<{ token: string; list?: Set<number>; state: Map<number, boolean> }>({ token, state: new Map() });
  /* An override holds for the list it was made against; a new answer of the list replaces it. */
  const overrides = known.token === token && known.list === bans.data ? known.state : new Map<number, boolean>();
  const bannedOf = (userId: number): boolean | undefined => overrides.get(userId) ?? (bans.data ? bans.data.has(userId) : undefined);
  const remember = (userId: number, banned: boolean) => setKnown((current) => ({ token, list: bans.data, state: new Map(current.token === token && current.list === bans.data ? current.state : []).set(userId, banned) }));
  const [search, setSearch] = useState('');
  const paged = usePagedRows((users.data ?? []).filter((r) => `${r.id} ${r.username}`.toLowerCase().includes(search.trim().toLowerCase())), search);
  const { confirmThen, confirmDialog } = useConfirm();
  const change = (r: { id: number; username: string }, banned: boolean) => confirmThen('确认修改 API 加速权限', `确定要${banned ? '禁用' : '恢复'}「${r.username}」（#${r.id}）的 API 加速功能吗？`, () => void ban.run(
    () => api.toggleAccelerationBan(token, r.id, banned),
    () => showToast(banned ? '已禁用 API 加速' : '已恢复 API 加速', 'success'),
    'API 加速权限修改失败',
    { key: r.id, onCommitted: (d) => { remember(r.id, d.banned); } },
  ));
  return <div className="space-y-6">
    <section aria-labelledby="admin-acceleration-heading" className="space-y-4">
      <SectionHeading as="h3" id="admin-acceleration-heading">API 加速权限</SectionHeading>
      <AdminNote>状态来自 API 加速禁用名单；可按行重新查询。</AdminNote>
      {bans.error && <ErrorRetry size="inline" {...retryError('API 加速禁用名单加载失败', bans.error)} onRetry={bans.retryable ? bans.refresh : undefined} />}
      <SearchInput value={search} onChange={setSearch} placeholder="查找用户…" className="sm:w-80" />
      <AdminListAnchor>
        <DataTable rows={paged.rows} listKey={paged.listKey} rowKey={(r) => r.id} loading={users.loading} {...tableError('用户列表加载失败', users.error)} onRetry={users.retryable ? users.refresh : undefined} empty="没有匹配的用户" columns={[
          { key: 'name', header: '用户', primary: true, render: (r) => `${r.username}（#${r.id}）` },
          { key: 'state', header: 'API 加速', render: (r) => {
            const banned = bannedOf(r.id);
            return banned === undefined ? <Badge tone="neutral">状态未知</Badge> : <Badge tone={banned ? 'error' : 'neutral'}>{banned ? '已禁用' : '可使用'}</Badge>;
          } },
          { key: 'actions', header: '操作', actions: true, render: (r) => {
            const locked = r.id === viewerId || (r.role === 'super_admin' && role !== 'super_admin');
            const banned = bannedOf(r.id);
            return <>
              <IconButton size="sm" icon={<MdRefresh />} aria-label={`查询 ${r.username} 的 API 加速状态`} loading={lookup.pendingKeys.has(r.id)} onClick={() => void lookup.run(async () => ({ banned: await api.readAccelerationBan(token, r.id) }), () => {}, 'API 加速状态查询失败', { key: r.id, onCommitted: (d) => remember(r.id, d.banned) })} />
              {banned !== true && <IconButton size="sm" icon={<MdBlock />} variant="danger-text" aria-label={`禁用 ${r.username} 的 API 加速`} disabled={locked} loading={ban.pendingKeys.has(r.id)} onClick={() => { if (!locked) change(r, true); }} />}
              {banned !== false && <IconButton size="sm" icon={<MdLockOpen />} aria-label={`恢复 ${r.username} 的 API 加速`} disabled={locked} loading={ban.pendingKeys.has(r.id)} onClick={() => { if (!locked) change(r, false); }} />}
            </>;
          } },
        ]} />
        <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
      </AdminListAnchor>
    </section>
    {confirmDialog}
  </div>;
}
export default protectedPanel(DeveloperSiteTools);
