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
  badges?: Badge[];
}

export default function UsersTab({ token, myRole }: { token: string; myRole: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [editForm, setEditForm] = useState({
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
        closeEditModal();
        loadUsers();
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

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setEditForm({
      username: user.username || '',
      email: user.email || '',
      password: '',
      role: user.role || 'user',
      bio: '',
      gender: '',
      birthday: '',
      is_banned: user.is_banned || 0,
    });
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingUser(null);
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
          <button
            onClick={() => openEditModal(u)}
            className="touch-target state-layer text-warning rounded-full p-1.5"
            title="编辑"
            aria-label={`编辑 ${u.username}`}
          >
            <MdEdit size={18} />
          </button>
          <button
            onClick={() => handleBan(u.id, u.is_banned ? 0 : 1)}
            className={`touch-target state-layer rounded-full p-1.5 ${u.is_banned ? 'text-success' : 'text-error'}`}
            title={u.is_banned ? '解封' : '封禁'}
            aria-label={`${u.is_banned ? '解封' : '封禁'} ${u.username}`}
          >
            {u.is_banned ? <MdCheckCircle size={18} /> : <MdBlock size={18} />}
          </button>
          <button
            onClick={() => handleDelete(u.id)}
            className="touch-target state-layer rounded-full p-1.5 text-error"
            title="删除"
            aria-label={`删除 ${u.username}`}
          >
            <MdDelete size={18} />
          </button>
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
        loading={isLoading}
        empty="没有找到匹配的用户"
      />

      <Modal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        title={editingUser ? `编辑用户 #${editingUser.id} - ${editingUser.username}` : '编辑用户'}
        maxWidth="max-w-xl"
        footer={
          <>
            {' '}
            <Button variant="text" onClick={closeEditModal}>
              {' '}
              取消{' '}
            </Button>{' '}
            <Button onClick={handleSaveUser} variant="filled" loading={isSavingUser}>
              {isSavingUser ? '保存中...' : '保存修改'}
            </Button>
          </>
        }
      >
        {' '}
        {editingUser && (
          <div className="space-y-4">
            {' '}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {' '}
              <div>
                {' '}
                <label className="block text-body-m text-on-surface mb-1" htmlFor="userstab-f1">
                  {' '}
                  用户名{' '}
                </label>{' '}
                <Input
                  id="userstab-f1"
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                  className="focus:ring-primary focus:border-transparent"
                  placeholder="留空则不修改"
                />{' '}
              </div>{' '}
              <div>
                {' '}
                <label className="block text-body-m text-on-surface mb-1" htmlFor="userstab-f2">
                  {' '}
                  邮箱{' '}
                </label>{' '}
                <Input
                  id="userstab-f2"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="focus:ring-primary focus:border-transparent"
                  placeholder="留空则不修改，填空字符串清空"
                />{' '}
              </div>{' '}
              <div>
                {' '}
                <label className="block text-body-m text-on-surface mb-1" htmlFor="userstab-f3">
                  {' '}
                  密码{' '}
                </label>{' '}
                <Input
                  id="userstab-f3"
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                  className="focus:ring-primary focus:border-transparent"
                  placeholder="留空则不修改密码"
                />{' '}
                <p className="mt-0.5 text-label-m text-warning">
                  修改密码将踢下线该用户的所有设备
                </p>{' '}
              </div>{' '}
              <div>
                {' '}
                <label className="block text-body-m text-on-surface mb-1" htmlFor="userstab-f4">
                  {' '}
                  角色{' '}
                </label>{' '}
                <Select
                  value={editForm.role}
                  onChange={(v) => setEditForm((f) => ({ ...f, role: v }))}
                  className="w-full"
                  options={[
                    { value: 'user', label: '用户' },
                    { value: 'editor', label: '小编' },
                    { value: 'admin', label: '管理员' },
                  ]}
                />
                {myRole !== 'super_admin' && (
                  <p className="mt-0.5 text-label-m text-on-surface-variant">
                    仅超管可提升至管理员
                  </p>
                )}{' '}
              </div>{' '}
            </div>{' '}
            <div>
              {' '}
              <label className="block text-body-m text-on-surface mb-1">
                {' '}
                个人简介 (Bio){' '}
              </label>{' '}
              <Textarea
                id="userstab-f4"
                value={editForm.bio}
                onChange={(e) => setEditForm((f) => ({ ...f, bio: e.target.value }))}
                rows={2}
                className="resize-none"
                placeholder="留空则不修改"
              />{' '}
            </div>{' '}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {' '}
              <div>
                {' '}
                <label className="block text-body-m text-on-surface mb-1" htmlFor="userstab-f5">
                  {' '}
                  性别{' '}
                </label>{' '}
                <Select
                  value={editForm.gender}
                  onChange={(v) => setEditForm((f) => ({ ...f, gender: v }))}
                  className="w-full"
                  options={[
                    { value: '', label: '-- 不修改 --' },
                    { value: 'male', label: '男' },
                    { value: 'female', label: '女' },
                    { value: 'other', label: '其他' },
                    { value: 'secret', label: '保密' },
                  ]}
                />{' '}
              </div>{' '}
              <div>
                {' '}
                <Input
                  label="生日"
                  id="userstab-f5"
                  type="date"
                  value={editForm.birthday}
                  onChange={(e) => setEditForm((f) => ({ ...f, birthday: e.target.value }))}
                  className="focus:ring-primary focus:border-transparent"
                />{' '}
              </div>{' '}
            </div>{' '}
            <div className="flex items-center gap-6 pt-2 border-t border-outline-variant">
              {' '}
              <div className="flex items-center gap-2 cursor-pointer">
                {' '}
                <Checkbox
                  checked={editForm.is_banned === 1}
                  onChange={(checked) => setEditForm((f) => ({ ...f, is_banned: checked ? 1 : 0 }))}
                  aria-label="封禁该用户"
                />{' '}
                <span className="text-body-m text-on-surface"> 封禁此用户 </span>{' '}
              </div>{' '}
              {editForm.is_banned === 1 && (
                <span className="text-body-s text-warning"> 封禁后将踢下线该用户的所有设备 </span>
              )}{' '}
            </div>{' '}
            <div className="text-body-s text-on-surface-variant">
              {' '}
              注册时间：{editingUser.created_at || '未知'}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={usersConfirmModalOpen}
        onClose={() => setUsersConfirmModalOpen(false)}
        title={usersConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setUsersConfirmModalOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
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
