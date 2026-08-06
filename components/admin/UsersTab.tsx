'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Checkbox from '@/components/Checkbox';
import Modal from '@/components/Modal';
import { roleInfo } from '@/lib/roles';
import Select from '@/components/Select';
import { MdPeople, MdEdit, MdDelete, MdCheckCircle, MdBlock } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';

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

export default function UsersTab({ token, myRole }: { token: string; myRole: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isInlineEditorClosing, setIsInlineEditorClosing] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
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
  const refreshAfterInlineCloseRef = useRef(false);

  const handleSaveUser = async () => {
    if (!editingUser) return;
    setIsSavingUser(true);
    try {
      const payload: Record<string, unknown> = { target_id: editingUser.id };

      if (editForm.username !== editingUser.username) {
        payload.username = editForm.username;
      }
      if (editForm.email !== editingUser.email) {
        payload.email = editForm.email;
      }
      if (editForm.password) {
        payload.password = editForm.password;
      }
      if (editForm.role !== editingUser.role) {
        payload.role = editForm.role;
      }
      if (editForm.is_banned !== editingUser.is_banned) {
        payload.is_banned = editForm.is_banned;
      }
      payload.bio = editForm.bio || '';
      payload.gender = editForm.gender || '';
      payload.birthday = editForm.birthday || '';

      const res = await api.adminUpdateUser(token, payload);
      const data = await res.json();

      if (data.success) {
        showToast('用户信息更新成功', 'success');
        refreshAfterInlineCloseRef.current = true;
        closeInlineEditor();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch {
      showToast('保存失败，请检查网络连接', 'error');
    } finally {
      setIsSavingUser(false);
    }
  };

  const [usersConfirmModalOpen, setUsersConfirmModalOpen] = useState(false);
  const [usersConfirmTitle, setUsersConfirmTitle] = useState('');
  const [usersConfirmMessage, setUsersConfirmMessage] = useState('');
  const usersConfirmActionRef = useRef<(() => void) | null>(null);

  const showUsersConfirm = (title: string, message: string, action: () => void) => {
    setUsersConfirmTitle(title);
    setUsersConfirmMessage(message);
    usersConfirmActionRef.current = action;
    setUsersConfirmModalOpen(true);
  };

  const handleUsersConfirmAction = () => {
    usersConfirmActionRef.current?.();
    setUsersConfirmModalOpen(false);
  };

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetUsers(token);
      if (data.success) {
        setUsers(data.users || []);
      }
    } catch {
      showToast('加载用户失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .adminGetUsers(token)
      .then((data) => {
        if (data.success) {
          setUsers(data.users || []);
        }
      })
      .catch(() => showToast('加载用户失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const filteredUsers = useMemo(() => {
    if (!searchKw) return users;
    const kw = searchKw.toLowerCase();
    return users.filter(
      (u) =>
        String(u.id) === kw ||
        u.username?.toLowerCase().includes(kw) ||
        u.email?.toLowerCase().includes(kw),
    );
  }, [searchKw, users]);

  const openInlineEditor = (user: User) => {
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
    if (!editingUser) return;
    setIsInlineEditorClosing(true);
  };

  const finishInlineEditorClose = () => {
    setEditingUser(null);
    setIsInlineEditorClosing(false);

    if (!refreshAfterInlineCloseRef.current) return;
    refreshAfterInlineCloseRef.current = false;
    loadUsers();
  };

  const handleBan = async (userId: number, isBanned: number) => {
    showUsersConfirm(
      isBanned ? '确认封禁' : '确认解封',
      isBanned ? '确认封禁该用户？' : '确认解封该用户？',
      async () => {
        try {
          const res = await api.adminUpdateUser(token, { target_id: userId, is_banned: isBanned });
          const data = await res.json();
          if (data.success) {
            showToast(isBanned ? '已封禁' : '已解封', 'success');
            loadUsers();
          } else {
            showToast(data.error || '操作失败', 'error');
          }
        } catch {
          showToast('操作失败', 'error');
        }
      },
    );
  };

  const handleDelete = async (userId: number) => {
    showUsersConfirm(
      '【极度危险】删除确认',
      '确定要彻底抹除此账号及所有相关数据吗？此操作无法恢复！',
      async () => {
        try {
          const res = await api.adminDeleteUser(token, userId);
          const data = await res.json();
          if (data.success) {
            showToast('已删除', 'success');
            loadUsers();
          } else {
            showToast(data.error || '删除失败', 'error');
          }
        } catch {
          showToast('删除失败', 'error');
        }
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
            <h3 className="text-title-m text-on-surface">编辑用户</h3>
            <p className="text-body-s text-on-surface-variant break-words">
              #{user.id} · {user.username}
            </p>
          </div>
          <Button variant="text" size="sm" onClick={closeInlineEditor} disabled={isSavingUser}>
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
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={editForm.is_banned === 1}
                        onChange={(checked) =>
                          setEditForm((form) => ({ ...form, is_banned: checked ? 1 : 0 }))
                        }
                        aria-label="封禁该用户"
                      />
                      <span className="text-body-m text-on-surface">封禁此用户</span>
                    </div>
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
          <Button variant="filled" onClick={handleSaveUser} loading={isSavingUser}>
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
      render: (u) => <span className="text-primary font-medium">{u.username}</span>,
    },
    {
      key: 'role',
      header: '角色',
      render: (u) => (
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-label-m ${roleInfo(u.role).chip}`}
        >
          {' '}
          {roleInfo(u.role).label}{' '}
        </span>
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
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-label-m ${
            u.is_banned
              ? 'bg-error-container text-on-error-container'
              : 'bg-success-container text-on-success-container'
          }`}
        >
          {u.is_banned ? '已封禁' : '正常'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <>
          <Button
            type="button"
            variant="text"
            size="sm"
            icon={<MdEdit size={18} />}
            onClick={(event) => {
              if (editingUser?.id === u.id && !isInlineEditorClosing) {
                closeInlineEditor();
                return;
              }
              captureInlineEditorLayout(event.currentTarget);
              openInlineEditor(u);
            }}
            className="w-9 px-0 text-warning"
            title="编辑"
            aria-label={`编辑 ${u.username}`}
            aria-expanded={editingUser?.id === u.id && !isInlineEditorClosing}
            aria-controls={`users-inline-${u.id}-editor`}
          />
          <Button
            type="button"
            variant="text"
            size="sm"
            icon={u.is_banned ? <MdCheckCircle size={18} /> : <MdBlock size={18} />}
            onClick={() => handleBan(u.id, u.is_banned ? 0 : 1)}
            className={`w-9 px-0 ${u.is_banned ? 'text-success' : 'text-error'}`}
            title={u.is_banned ? '解封' : '封禁'}
            aria-label={`${u.is_banned ? '解封' : '封禁'} ${u.username}`}
          />
          <Button
            type="button"
            variant="text"
            size="sm"
            icon={<MdDelete size={18} />}
            onClick={() => handleDelete(u.id)}
            className="w-9 px-0 text-error"
            title="删除"
            aria-label={`删除 ${u.username}`}
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople className="text-primary" size={24} />}
        title="用户与权限管理"
        onRefresh={loadUsers}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索用户ID、用户名或邮箱..."
      />

      <DataTable<User>
        columns={userColumns}
        rows={filteredUsers}
        rowKey={(u) => u.id}
        expandedRow={renderInlineEditor}
        loading={isLoading}
        empty="没有找到匹配的用户"
      />

      <Modal
        isOpen={usersConfirmModalOpen}
        onClose={() => setUsersConfirmModalOpen(false)}
        title={usersConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="text" onClick={() => setUsersConfirmModalOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleUsersConfirmAction}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">{usersConfirmMessage}</p>
      </Modal>
    </div>
  );
}
