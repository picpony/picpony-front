'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { MdBlock, MdCheckCircle, MdDeleteOutline, MdEdit } from 'react-icons/md';
import Badge from '@/components/Badge';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import RoleBadge from '@/components/RoleBadge';
import SearchInput from '@/components/SearchInput';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { useAdminQuery, tableError } from './queries';
import { usersQuery } from './sharedQueries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';
import UserEditor, { userEditorId, type AdminUser } from './users/UserEditor';
import BadgeEditDialog from './users/BadgeEditDialog';
import { userBadges, type AdminUserBadge } from './users/rules';
import { flag } from '@/lib/flag';

const EMPTY: AdminUser[] = [];

/** 「用户3」（#3） — how a confirm and a toast name an account. */
const named = (user: { id: number; username: string }) => `「${user.username}」（#${user.id}）`;

/**
 * 用户管理. The list pages client-side (`admin_get_users` answers every account at once — R9-014);
 * each row opens its editor under itself (`UserEditor`); ban, unban and delete confirm and name the
 * account (R9-009), and none of them is offered on the viewer's own row, which says 当前账号
 * instead.
 *
 * Every write owns its own pending state: a row's buttons lock while that row has a write in
 * flight, and only the pressed one spins; the rest of the list stays usable.
 */
export default function UsersTab({ token, role, viewerId }: AdminPanelProps) {
  const read = useAdminQuery(usersQuery, token);
  const users = read.data?.rows ?? EMPTY;
  const rowMutation = useAdminMutation(token);
  const saveMutation = useAdminMutation(token);
  const badgeMutation = useAdminMutation(token);
  const { confirm, confirmThen, confirmDialog } = useConfirm();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: number; closing: boolean } | null>(null);
  const dirtyRef = useRef(false);
  /* `session` counts openings, so each one starts from the badge's own values while a closing
     dialog keeps its key (and its exit). */
  const [badgeEdit, setBadgeEdit] = useState<
    { badge: AdminUserBadge; owner: AdminUser; open: boolean; session: number } | null
  >(null);
  /* The row an action is running on, and which action — so only the pressed button spins. */
  const [running, setRunning] = useState<{ id: number; action: 'ban' | 'delete' } | null>(null);

  /* The row being edited stays in the results while its editor is open or closing: a rename that
     no longer matches the search must not unmount the editor mid-animation. */
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) =>
      user.id === editing?.id ||
      String(user.id) === keyword ||
      user.username?.toLowerCase().includes(keyword) ||
      user.email?.toLowerCase().includes(keyword));
  }, [users, query, editing?.id]);
  const paged = usePagedRows(filtered, query.trim());

  const editingUser = editing ? users.find((user) => user.id === editing.id) ?? null : null;
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const openEditor = async (user: AdminUser, trigger: HTMLElement) => {
    /* A save in flight keeps its editor: a second row cannot open over it. */
    if (editing && saveMutation.isPending(editing.id)) return;
    if (editing && editing.id !== user.id && !editing.closing && dirtyRef.current) {
      const current = users.find((row) => row.id === editing.id);
      const discard = await confirm({
        title: '确认放弃修改',
        message: `确定要放弃对${current ? named(current) : '该用户'}的修改吗？`,
      });
      if (!discard) return;
    }
    captureInlineEditorLayout(trigger);
    dirtyRef.current = false;
    setEditing({ id: user.id, closing: false });
  };

  const closeEditor = () => {
    if (!editing || saveMutation.isPending(editing.id)) return;
    setEditing({ ...editing, closing: true });
  };

  const save = (user: AdminUser, payload: Record<string, unknown> | null) => {
    if (!payload) {
      showToast('没有需要保存的修改', 'info');
      setEditing({ id: user.id, closing: true });
      return;
    }
    void saveMutation.run(
      () => adminApi.adminUpdateUser(token, payload),
      () => {
        showToast(`已保存${named(user)}的资料`, 'success');
        setEditing((current) => (current?.id === user.id ? { id: user.id, closing: true } : current));
      },
      '保存失败',
      { key: user.id, onCommitted: read.refresh },
    );
  };

  const runRowAction = (user: AdminUser, action: 'ban' | 'delete', request: () => Promise<Response>, done: string, failure: string, commit: () => void) => {
    if (rowMutation.isPending(user.id)) return;
    setRunning({ id: user.id, action });
    void rowMutation
      .run(request, () => showToast(done, 'success'), failure, { key: user.id, onCommitted: commit })
      .finally(() => setRunning((current) => (current?.id === user.id ? null : current)));
  };

  const toggleBan = (user: AdminUser) => {
    const banning = !flag(user.is_banned);
    confirmThen(
      banning ? '确认封禁' : '确认解封',
      banning
        ? `确定要封禁用户${named(user)}吗？封禁后该用户将在所有设备上退出登录。`
        : `确定要解封用户${named(user)}吗？`,
      () => runRowAction(
        user,
        'ban',
        () => adminApi.adminUpdateUser(token, { target_id: user.id, is_banned: banning ? 1 : 0 }),
        banning ? `已封禁${named(user)}` : `已解封${named(user)}`,
        banning ? '封禁失败' : '解封失败',
        () => {
          usersQuery.write(token, (previous) => ({
            stats: previous?.stats,
            rows: previous?.rows.map((row) => (row.id === user.id ? { ...row, is_banned: banning ? 1 : 0 } : row)) ?? [],
          }));
          read.refresh();
        },
      ),
      { tone: banning ? 'danger' : 'filled' },
    );
  };

  const remove = (user: AdminUser) => {
    confirmThen(
      '确认删除用户',
      `确定要彻底删除用户${named(user)}及其所有数据吗？此操作无法恢复。`,
      () => runRowAction(
        user,
        'delete',
        () => adminApi.adminDeleteUser(token, user.id),
        `已删除${named(user)}`,
        '删除失败',
        () => {
          /* The editor as it is now, not as it was when the confirmation opened (review P6-O14). */
          setEditing((current) => (current?.id === user.id ? null : current));
          usersQuery.write(token, (previous) => ({ stats: previous?.stats, rows: previous?.rows.filter((row) => row.id !== user.id) ?? [] }));
          read.refresh();
        },
      ),
    );
  };

  const deleteBadge = (owner: AdminUser, badge: AdminUserBadge) => {
    confirmThen(
      '确认删除徽章',
      `确定要删除用户${named(owner)}的徽章「${badge.name}」吗？`,
      () => void badgeMutation.run(
        () => adminApi.adminDeleteBadge(token, badge.id),
        () => showToast(`已删除徽章「${badge.name}」`, 'success'),
        '删除失败',
        { key: badge.id, onCommitted: read.refresh },
      ),
    );
  };

  const saveBadge = (values: { name: string; color: string }) => {
    if (!badgeEdit) return;
    const { badge } = badgeEdit;
    void badgeMutation.run(
      () => adminApi.adminEditBadge(token, { badge_id: badge.id, badge_name: values.name, badge_color: values.color }),
      () => {
        showToast(`已更新徽章「${values.name}」`, 'success');
        setBadgeEdit((current) => (current ? { ...current, open: false } : current));
      },
      '保存失败',
      { key: badge.id, onCommitted: read.refresh },
    );
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (user) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-body-m-emphasized text-on-surface">{user.username}</span>
          {user.id === viewerId && <Badge size="sm">当前账号</Badge>}
        </span>
      ),
    },
    { key: 'id', header: 'ID', width: 'auto', render: (user) => `#${user.id}` },
    { key: 'role', header: '角色', width: 'auto', render: (user) => <RoleBadge role={user.role} showUser size="md" /> },
    {
      key: 'email',
      header: '邮箱',
      width: 'minmax(0, 2fr)',
      className: 'wrap-anywhere',
      render: (user) => <span className="text-on-surface-variant">{user.email || '未填写'}</span>,
    },
    {
      key: 'state',
      header: '状态',
      width: 'auto',
      render: (user) => (
        <Badge tone={flag(user.is_banned) ? 'error' : 'success'} size="md">
          {flag(user.is_banned) ? '已封禁' : '正常'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (user) => {
        const open = editing?.id === user.id && !editing.closing;
        const busy = rowMutation.pendingKeys.has(user.id) || saveMutation.pendingKeys.has(user.id);
        const self = user.id === viewerId;
        return (
          <>
            <IconButton
              size="sm"
              icon={<MdEdit />}
              aria-label={`编辑用户 ${user.username}`}
              aria-expanded={open}
              aria-controls={userEditorId(user.id)}
              disabled={busy && !open}
              onClick={(event) => {
                if (open) closeEditor();
                else void openEditor(user, event.currentTarget);
              }}
            />
            {!self && (
              <>
                <IconButton
                  size="sm"
                  variant={flag(user.is_banned) ? 'standard' : 'danger-text'}
                  icon={flag(user.is_banned) ? <MdCheckCircle /> : <MdBlock />}
                  aria-label={`${flag(user.is_banned) ? '解封' : '封禁'}用户 ${user.username}`}
                  loading={running?.id === user.id && running.action === 'ban'}
                  disabled={busy && !(running?.id === user.id && running.action === 'ban')}
                  onClick={() => toggleBan(user)}
                />
                <IconButton
                  size="sm"
                  variant="danger-text"
                  icon={<MdDeleteOutline />}
                  aria-label={`删除用户 ${user.username}`}
                  loading={running?.id === user.id && running.action === 'delete'}
                  disabled={busy && !(running?.id === user.id && running.action === 'delete')}
                  onClick={() => remove(user)}
                />
              </>
            )}
          </>
        );
      },
    },
  ];

  const renderEditor = (user: AdminUser) => {
    if (editing?.id !== user.id || !editingUser) return null;
    return (
      <UserEditor
        key={user.id}
        user={editingUser}
        viewer={{ id: viewerId, role }}
        closing={editing.closing}
        saving={saveMutation.pendingKeys.has(user.id)}
        badges={userBadges(editingUser.badges)}
        badgeBusy={(badgeId) => badgeMutation.pendingKeys.has(badgeId)}
        onSave={(payload) => save(editingUser, payload)}
        onCancel={closeEditor}
        onExitComplete={() => setEditing((current) => (current?.id === user.id && current.closing ? null : current))}
        onDirtyChange={setDirty}
        onEditBadge={(badge) =>
          setBadgeEdit((current) => ({ badge, owner: editingUser, open: true, session: (current?.session ?? 0) + 1 }))}
        onDeleteBadge={(badge) => deleteBadge(editingUser, badge)}
      />
    );
  };

  const keyword = query.trim();
  return (
    <div className="space-y-6">
      <SectionHeader section="users"
        onRefresh={read.refresh}
        isLoading={read.refreshing}
      />
      <SearchInput value={query} onChange={setQuery} placeholder="搜索用户 ID、用户名或邮箱…" />
      <AdminListAnchor>
        <DataTable<AdminUser>
          columns={columns}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(user) => user.id}
          expandedRow={renderEditor}
          loading={read.loading}
          skeletonRows={8}
          {...tableError('用户列表加载失败', read.error)}
          onRetry={read.retryable ? read.refresh : undefined}
          empty={keyword ? '没有找到匹配的用户' : '暂无用户'}
        />
        <AdminPager
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={(page) => {
            setEditing(null);
            paged.setPage(page);
          }}
          summary={read.data ? (keyword ? `找到 ${paged.total} 位用户` : `共 ${paged.total} 位用户`) : undefined}
        />
      </AdminListAnchor>
      <BadgeEditDialog
        key={badgeEdit ? `${badgeEdit.badge.id}:${badgeEdit.session}` : 'none'}
        badge={badgeEdit?.badge ?? null}
        owner={badgeEdit?.owner.username ?? ''}
        open={Boolean(badgeEdit?.open)}
        saving={badgeEdit ? badgeMutation.pendingKeys.has(badgeEdit.badge.id) : false}
        onClose={() => setBadgeEdit((current) => (current ? { ...current, open: false } : current))}
        onSave={saveBadge}
      />
      {confirmDialog}
    </div>
  );
}
