'use client';

import { useState, useMemo } from 'react';
import { showToast } from '@/components/Toast';
import StatusBadge from '@/components/Badge';
import Checkbox from '@/components/Checkbox';
import RoleBadge from '@/components/RoleBadge';
import Select from '@/components/Select';
import { MdPeople, MdEdit, MdDelete, MdCheckCircle, MdBlock } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { useConfirm } from '@/components/ConfirmDialog';
import { Input, Textarea } from '@/components/Input';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import SectionHeading from '@/components/SectionHeading';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface Badge {
  id: number;
  badge_name: string;
  badge_color: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  api_key: string | null;
  derpi_user_id: string | null;
  derpi_username: string | null;
  is_banned: number;
  created_at: string;
  experience: number;
  coins: number;
  bio?: string;
  gender?: string;
  birthday?: string;
  badges?: Badge[];
}

interface UserEditForm {
  username: string;
  email: string;
  password: string;
  role: string;
  bio: string;
  gender: string;
  birthday: string;
  is_banned: number;
}

const USER_ROLE_OPTIONS = [
  { value: 'user', label: '用户' },
  { value: 'editor', label: '小编' },
  { value: 'admin', label: '管理员' },
];

const USER_GENDER_OPTIONS = [
  { value: '', label: '-- 不修改 --' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
  { value: 'secret', label: '保密' },
];

const emptyUsers: User[] = [];
const usersQuery = defineAdminQuery<User[]>('users', async (token, signal) => {
  const data = await adminApi.adminGetUsers(token, signal);
  return adminData(data, data.users || []);
});

export default function UsersTab({ token, myRole }: { token: string; myRole: string }) {
  const mutation = useAdminMutation(token);
  const read = useAdminQuery(usersQuery, token);
  const users = read.data ?? emptyUsers;
  const isLoading = read.loading;
  const loadUsers = read.refresh;
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isInlineEditorClosing, setIsInlineEditorClosing] = useState(false);
  const saveMutation = useAdminMutation(token);
  const isSavingUser = saveMutation.busy;
  const [editForm, setEditForm] = useState<UserEditForm>({
    username: '',
    email: '',
    password: '',
    role: 'user',
    bio: '',
    gender: '',
    birthday: '',
    is_banned: 0,
  });

  const handleSaveUser = async () => {
    if (!editingUser || saveMutation.isPending() || mutation.isPending()) return;
    const payload: Record<string, unknown> = {
      target_id: editingUser.id,
      bio: editForm.bio,
      gender: editForm.gender,
      birthday: editForm.birthday,
    };
    for (const key of ['username', 'email', 'role', 'is_banned'] as const) {
      if (editForm[key] !== editingUser[key]) payload[key] = editForm[key];
    }
    if (editForm.password) payload.password = editForm.password;

    await saveMutation.run(
      () => adminApi.adminUpdateUser(token, payload),
      () => {
        showToast('用户信息已更新', 'success');
        setIsInlineEditorClosing(true);
      },
      '保存失败',
      { onCommitted: loadUsers },
    );
  };

  const { confirmThen, confirmDialog } = useConfirm();

  // A refreshed rename may stop matching the search. Keep its row mounted
  // until the editor finishes closing and releases its state.
  const closingUserId = isInlineEditorClosing ? editingUser?.id : null;
  const filteredUsers = useMemo(() => {
    if (!searchKw) return users;
    const kw = searchKw.toLowerCase();
    return users.filter(
      (u) =>
        u.id === closingUserId ||
        String(u.id) === kw ||
        u.username?.toLowerCase().includes(kw) ||
        u.email?.toLowerCase().includes(kw),
    );
  }, [searchKw, users, closingUserId]);

  const openInlineEditor = (user: User) => {
    if (saveMutation.isPending() || mutation.isPending()) return;
    setEditingUser(user);
    setIsInlineEditorClosing(false);
    setEditForm({
      username: user.username || '',
      email: user.email || '',
      password: '',
      role: user.role || 'user',
      bio: user.bio || '',
      gender: user.gender || '',
      birthday: user.birthday || '',
      is_banned: user.is_banned || 0,
    });
  };

  const closeInlineEditor = () => {
    if (!editingUser || saveMutation.isPending()) return;
    setIsInlineEditorClosing(true);
  };

  const finishInlineEditorClose = () => {
    setEditingUser(null);
    setIsInlineEditorClosing(false);
  };

  const handleBan = (userId: number, isBanned: number) => {
    confirmThen(
      isBanned ? '确认封禁' : '确认解封',
      isBanned ? '确定要封禁该用户吗？' : '确定要解封该用户吗？',
      async () => {
        if (saveMutation.isPending()) return;
        await mutation.run(
          () => adminApi.adminUpdateUser(token, { target_id: userId, is_banned: isBanned }),
          () => showToast(isBanned ? '已封禁' : '已解封', 'success'),
          '操作失败',
          { onCommitted: () => {
            usersQuery.write(token, (previous) => previous?.map((user) => user.id === userId ? { ...user, is_banned: isBanned } : user) ?? []);
            loadUsers();
          } },
        );
      },
    );
  };

  const handleDelete = (userId: number) => {
    confirmThen(
      '确认彻底删除账号',
      '确定要彻底抹除此账号及所有相关数据吗？此操作无法恢复。',
      async () => {
        if (saveMutation.isPending()) return;
        await mutation.run(
          () => adminApi.adminDeleteUser(token, userId),
          () => showToast('已删除', 'success'),
          '删除失败',
          { onCommitted: () => {
            usersQuery.write(token, (previous) => previous?.filter((user) => user.id !== userId) ?? []);
            loadUsers();
          } },
        );
      },
    );
  };

  const renderInlineEditor = (user: User) => {
    if (editingUser?.id !== user.id) return null;

    const idPrefix = `users-inline-${user.id}`;

    return (
      <InlineEditorPanel
        id={`${idPrefix}-editor`}
        label={`编辑用户 ${user.username}`}
        isClosing={isInlineEditorClosing}
        onExitComplete={finishInlineEditorClose}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionHeading as="h3" className="mb-0" subtitle={`#${user.id} · ${user.username}`}>
              编辑用户
            </SectionHeading>
          </div>
          <Button variant="text" size="xs" onClick={closeInlineEditor} disabled={isSavingUser}>
            取消
          </Button>
        </div>

        <div className="popover-scrollbar overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-surface-container-high">
              <tr>
                <th
                  scope="col"
                  className="w-28 px-3 py-2 text-left text-label-l text-on-surface-variant sm:w-36"
                >
                  字段
                </th>
                <th scope="col" className="px-3 py-2 text-left text-label-l text-on-surface-variant">
                  内容
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface-container-low">
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <label htmlFor={`${idPrefix}-username`} className="text-label-l text-on-surface-variant">
                    用户名
                  </label>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Input
                    id={`${idPrefix}-username`}
                    value={editForm.username}
                    disabled={isSavingUser}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, username: event.target.value }))
                    }
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <label htmlFor={`${idPrefix}-email`} className="text-label-l text-on-surface-variant">
                    邮箱
                  </label>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Input
                    id={`${idPrefix}-email`}
                    type="email"
                    value={editForm.email}
                    disabled={isSavingUser}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, email: event.target.value }))
                    }
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <label htmlFor={`${idPrefix}-password`} className="text-label-l text-on-surface-variant">
                    密码
                  </label>
                  <span className="mt-1 block text-body-s text-warning">修改后将退出所有设备</span>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Input
                    id={`${idPrefix}-password`}
                    type="password"
                    value={editForm.password}
                    disabled={isSavingUser}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, password: event.target.value }))
                    }
                    placeholder="留空则不修改密码"
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <span className="text-label-l text-on-surface-variant">角色</span>
                  {myRole !== 'super_admin' && (
                    <span className="mt-1 block text-body-s text-on-surface-variant">
                      仅超管可提升至管理员
                    </span>
                  )}
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Select
                    value={editForm.role}
                    disabled={isSavingUser}
                    onChange={(value) => setEditForm((form) => ({ ...form, role: value }))}
                    className="w-full"
                    aria-label="用户角色"
                    options={USER_ROLE_OPTIONS}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <label htmlFor={`${idPrefix}-bio`} className="text-label-l text-on-surface-variant">
                    个人简介
                  </label>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Textarea
                    id={`${idPrefix}-bio`}
                    value={editForm.bio}
                    disabled={isSavingUser}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, bio: event.target.value }))
                    }
                    rows={2}
                    className="resize-none"
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <span className="text-label-l text-on-surface-variant">性别</span>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Select
                    value={editForm.gender}
                    disabled={isSavingUser}
                    onChange={(value) => setEditForm((form) => ({ ...form, gender: value }))}
                    className="w-full"
                    aria-label="用户性别"
                    options={USER_GENDER_OPTIONS}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <label htmlFor={`${idPrefix}-birthday`} className="text-label-l text-on-surface-variant">
                    生日
                  </label>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <Input
                    id={`${idPrefix}-birthday`}
                    type="date"
                    value={editForm.birthday}
                    disabled={isSavingUser}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, birthday: event.target.value }))
                    }
                  />
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <span className="text-label-l text-on-surface-variant">账号状态</span>
                </th>
                <td className="min-w-48 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* `label`, so the visible words are the accessible name and
                        clicking them toggles the box. It was a sibling `<span>` plus a
                        differently-worded `aria-label`. */}
                    <Checkbox
                      checked={editForm.is_banned === 1}
                      disabled={isSavingUser}
                      onChange={(checked) =>
                        setEditForm((form) => ({ ...form, is_banned: checked ? 1 : 0 }))
                      }
                      label="封禁此用户"
                    />
                    {editForm.is_banned === 1 && (
                      <span className="text-body-s text-warning">封禁后将退出该用户的所有设备</span>
                    )}
                  </div>
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-3 py-3 text-left align-top">
                  <span className="text-label-l text-on-surface-variant">注册时间</span>
                </th>
                <td className="min-w-48 px-3 py-3 text-body-m text-on-surface">
                  {user.created_at || '未知'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="text" onClick={closeInlineEditor} disabled={isSavingUser}>
            取消
          </Button>
          <Button variant="filled" onClick={handleSaveUser} loading={isSavingUser} disabled={mutation.busy}>
            保存修改
          </Button>
        </div>
      </InlineEditorPanel>
    );
  };

  const userColumns: Column<User>[] = [
    { key: 'id', header: 'ID', render: (u) => `#${u.id}` },
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (u) => <span className="text-body-m-emphasized text-primary-ink">{u.username}</span>,
    },
    {
      key: 'role',
      header: '角色',
      render: (u) => (
        /* `showUser`: a table column has to say something in every row, which
           is the one place the neutral "普通用户" pill belongs. */
        <RoleBadge role={u.role} showUser size="md" />
      ),
    },
    {
      key: 'email',
      header: '邮箱',
      render: (u) => <span className="text-on-surface-variant">{u.email || '-'}</span>,
    },
    {
      key: 'state',
      header: '状态',
      render: (u) => (
        <StatusBadge tone={u.is_banned ? 'error' : 'success'}>{u.is_banned ? '已封禁' : '正常'}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <>
          {/* `IconButton`, not an icon-only button stretched to a 36×32 box: the
              32dp step is square by the token set, and it supplies the state
              layer, the ripple and the glyph size — plus its own tooltip from
              `aria-label`. */}
          <IconButton
            type="button"
            size="sm"
            icon={<MdEdit />}
            disabled={mutation.busy || isSavingUser}
            onClick={(event) => {
              if (editingUser?.id === u.id && !isInlineEditorClosing) {
                closeInlineEditor();
                return;
              }
              captureInlineEditorLayout(event.currentTarget);
              openInlineEditor(u);
            }}
            className="text-warning"
            aria-label={`编辑用户 ${u.username}`}
            aria-expanded={editingUser?.id === u.id && !isInlineEditorClosing}
            aria-controls={`users-inline-${u.id}-editor`}
          />
          <IconButton
            type="button"
            size="sm"
            icon={u.is_banned ? <MdCheckCircle /> : <MdBlock />}
            onClick={() => handleBan(u.id, u.is_banned ? 0 : 1)}
            disabled={mutation.busy || isSavingUser}
            variant={u.is_banned ? 'standard' : 'danger-text'}
            className={u.is_banned ? 'text-success' : undefined}
            aria-label={`${u.is_banned ? '解封' : '封禁'}用户 ${u.username}`}
          />
          <IconButton
            type="button"
            size="sm"
            icon={<MdDelete />}
            onClick={() => handleDelete(u.id)}
            disabled={mutation.busy || isSavingUser}
            variant="danger-text"
            aria-label={`删除用户 ${u.username}`}
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople size={ICON.standard} />}
        title="用户与权限管理"
        onRefresh={loadUsers}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索用户 ID、用户名或邮箱…"
      />

      <DataTable<User>
        columns={userColumns}
        rows={filteredUsers}
        rowKey={(u) => u.id}
        expandedRow={renderInlineEditor}
        loading={isLoading}
        error={read.error}
        onRetry={loadUsers}
        empty="没有找到匹配的用户"
      />

      {confirmDialog}
    </div>
  );
}
