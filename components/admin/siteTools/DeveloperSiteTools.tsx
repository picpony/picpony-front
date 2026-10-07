'use client';

import { useRef, useState } from 'react';
import { MdBlock, MdLockOpen } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import SearchInput from '@/components/SearchInput';
import DataTable from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { copyText } from '@/lib/utils';
import { count, flag, id, text } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import { AdminNote } from '../AdminForm';
import { derived, tableError, useAdminSelect } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { useCatalogMutation } from '../catalogTools/useCatalogMutation';
import MutationResult from '../catalogTools/MutationResult';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import type { AdminPanelProps } from '../registry';
import { usersQuery, type AdminUsers } from '../sharedQueries';
import { protectedPanel } from './common';

/** The API 加速 rows, from 用户管理's own read (`usersQuery`) rather than a third copy of the whole
 *  account list (G2-019); a ban or a cleanup then refreshes every panel that lists the accounts. */
const accelerationRows = derived(({ rows }: AdminUsers) => (rows as unknown as Record<string, unknown>[]).map((r) => ({ id: id(r.id), username: text(r.username), banned: flag(r.api_accel_banned ?? false), role: text(r.role) })));
function DeveloperSiteTools({ token, viewerId, role }: AdminPanelProps) {
  const users = useAdminSelect(usersQuery, token, accelerationRows);
  const ban = useAdminMutation(token), cleanup = useAdminMutation(token);
  /* The invite is the one write here a second press repeats — each mints a live link — so it takes
     the catalogue's mutation: an outcome nobody heard is held as 操作结果待确认 until 我已核对记录,
     with the press disabled, instead of a toast and a button that invites the second link (G2-009). */
  const invite = useCatalogMutation(token);
  const generate = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState(''), [inviteUrl, setInviteUrl] = useState('');
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);
  const paged = usePagedRows((users.data ?? []).filter((r) => `${r.id} ${r.username}`.toLowerCase().includes(search.trim().toLowerCase())), search);
  const { confirmThen, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  return <div className="space-y-6">
    <section aria-labelledby="admin-acceleration-heading" className="space-y-4">
      <SectionHeading as="h3" id="admin-acceleration-heading">API 加速权限</SectionHeading>
      <SearchInput value={search} onChange={setSearch} placeholder="查找用户…" className="sm:w-80" />
      <AdminListAnchor>
        <DataTable rows={paged.rows} listKey={paged.listKey} rowKey={(r) => r.id} loading={users.loading} {...tableError('用户列表加载失败', users.error)} onRetry={users.retryable ? users.refresh : undefined} empty="没有匹配的用户" columns={[
          { key: 'name', header: '用户', primary: true, render: (r) => `${r.username}（#${r.id}）` },
          { key: 'state', header: 'API 加速', render: (r) => <Badge tone={r.banned ? 'error' : 'neutral'}>{r.banned ? '已禁用' : '可使用'}</Badge> },
          { key: 'actions', header: '操作', actions: true, render: (r) => <IconButton size="sm" icon={r.banned ? <MdLockOpen /> : <MdBlock />} variant={r.banned ? 'standard' : 'danger-text'} aria-label={`${r.banned ? '恢复' : '禁用'} ${r.username} 的 API 加速`} disabled={r.id === viewerId || (r.role === 'super_admin' && role !== 'super_admin')} loading={ban.pendingKeys.has(r.id)} onClick={() => {
            if (r.id === viewerId || (r.role === 'super_admin' && role !== 'super_admin')) return;
            confirmThen('确认修改 API 加速权限', `确定要${r.banned ? '恢复' : '禁用'}「${r.username}」（#${r.id}）的 API 加速功能吗？`, () => void ban.run(() => api.toggleAccelerationBan(token, r.id, !r.banned), () => showToast(r.banned ? '已恢复 API 加速' : '已禁用 API 加速', 'success'), 'API 加速权限修改失败', { key: r.id, onCommitted: () => usersQuery.invalidate() }));
          }} /> },
        ]} />
        <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
      </AdminListAnchor>
    </section>
    <section aria-labelledby="admin-invite-heading" className="max-w-2xl space-y-4">
      <SectionHeading as="h3" id="admin-invite-heading">白名单邀请</SectionHeading>
      <AdminNote>生成后可将邀请链接交给需要使用中转白名单的用户。</AdminNote>
      <Button ref={generate} variant="tonal" loading={invite.busy} disabled={invite.uncertain} onClick={() => confirmThen('确认生成白名单邀请', '确定要生成一个新的中转白名单邀请链接吗？持有链接的人可通过邀请加入白名单。', () => void invite.run(async () => (await api.generateWhitelistInvite(token)).json() as Promise<Record<string, unknown>>, (d) => { setInviteUrl(text(d.url)); showToast('已生成邀请链接', 'success'); }))}>生成邀请链接</Button>
      <MutationResult mutation={invite} returnFocus={() => generate.current} />
      {inviteUrl && <><Input label="白名单邀请链接" value={inviteUrl} readOnly /><Button variant="text" onClick={async () => { if (await copyText(inviteUrl)) showToast('已复制邀请链接', 'success'); else void prompt({ title: '复制邀请链接', label: '邀请链接', defaultValue: inviteUrl, message: '无法自动复制，请手动复制。', confirmLabel: '完成', allowEmpty: true, rows: 1 }); }}>复制邀请链接</Button></>}
    </section>
    <section aria-labelledby="admin-legacy-cleanup-heading" className="max-w-2xl space-y-4">
      <SectionHeading as="h3" id="admin-legacy-cleanup-heading">清理旧版核验</SectionHeading>
      <AdminNote>清除旧版「new_user」与「PicPony 绑定账号」核验标识，保留已绑定的 API Key。</AdminNote>
      <Button variant="danger-text" loading={cleanup.busy} onClick={() => confirmThen('确认清理全部旧版核验', '确定要清除所有账号的旧版「new_user」与「PicPony 绑定账号」核验标识吗？已绑定的 API Key 会保留，此清理无法撤销。', () => void cleanup.run(() => api.cleanupLegacyVerifications(token), (d) => { setCleanupCount(count(d.cleared_count)); showToast('已清理旧版核验', 'success'); }, '旧版核验清理失败', { onCommitted: () => usersQuery.invalidate() }))}>清理旧版核验</Button>
      {cleanupCount !== null && <p role="status" className="text-body-m">已清理 {cleanupCount} 个旧版核验标识</p>}
    </section>
    {confirmDialog}{promptDialog}
  </div>;
}
export default protectedPanel(DeveloperSiteTools);
