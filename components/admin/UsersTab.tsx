'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Checkbox from '@/components/Checkbox';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdPeople, MdEdit, MdDelete, MdCheckCircle, MdBlock } from 'react-icons/md';
import { SectionHeader, SearchInput, EmptyState, Spinner } from './';

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

const roleBadgeMap: Record<string, { label: string; color: string }> = {
  super_admin: { label: '超管', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  admin: { label: '管理员', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  editor: { label: '小编', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  user: { label: '用户', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

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
    api.adminGetUsers(token)
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
    return users.filter(u =>
      String(u.id) === kw ||
      u.username?.toLowerCase().includes(kw) ||
      u.email?.toLowerCase().includes(kw)
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
      }
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
      }
    );
  };

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

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">用户名</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">角色</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">邮箱</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : filteredUsers.length === 0 ? (
              <EmptyState colSpan={6} message="没有找到匹配的用户" />
            ) : (
              filteredUsers.map((user) => {
                const roleInfo = roleBadgeMap[user.role] || roleBadgeMap.user;
                return (
                  <tr key={user.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-sm">#{user.id}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-primary">{user.username}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleInfo.color}`}>
                        {roleInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{user.email || '-'}</td>
                    <td className="px-4 py-3">
                      {user.is_banned ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          已封禁
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          正常
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                          title="编辑"
                        >
                          <MdEdit size={18} />
                        </button>
                        <button
                          onClick={() => handleBan(user.id, user.is_banned ? 0 : 1)}
                          className={`p-1.5 rounded transition-colors ${user.is_banned ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30' : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'}`}
                          title={user.is_banned ? '解封' : '封禁'}
                        >
                          {user.is_banned ? <MdCheckCircle size={18} /> : <MdBlock size={18} />}
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                          title="删除"
                        >
                          <MdDelete size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        title={editingUser ? `编辑用户 #${editingUser.id} - ${editingUser.username}` : '编辑用户'}
        maxWidth="max-w-xl"
        footer={
          <>
            <button
              onClick={closeEditModal}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSaveUser}
              disabled={isSavingUser}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:opacity-90 disabled:opacity-50 rounded-lg transition-all cursor-pointer flex items-center gap-2"
            >
              {isSavingUser && <Spinner size="sm" white />}
              {isSavingUser ? '保存中...' : '保存修改'}
            </button>
          </>
        }
      >
        {editingUser && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  用户名
                </label>
                <input
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="留空则不修改"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  邮箱
                </label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="留空则不修改，填空字符串清空"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  密码
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  placeholder="留空则不修改密码"
                />
                <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">修改密码将踢下线该用户的所有设备</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  角色
                </label>
                <Select
                  value={editForm.role}
                  onChange={(v) => setEditForm(f => ({ ...f, role: v }))}
                  className="w-full"
                  options={[
                    { value: 'user', label: '用户' },
                    { value: 'editor', label: '小编' },
                    { value: 'admin', label: '管理员' },
                  ]}
                />
                {myRole !== 'super_admin' && (
                  <p className="mt-0.5 text-xs text-slate-500">仅超管可提升至管理员</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                个人简介 (Bio)
              </label>
              <textarea
                value={editForm.bio}
                onChange={(e) => setEditForm(f => ({ ...f, bio: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none resize-none"
                placeholder="留空则不修改"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  性别
                </label>
                <Select
                  value={editForm.gender}
                  onChange={(v) => setEditForm(f => ({ ...f, gender: v }))}
                  className="w-full"
                  options={[
                    { value: '', label: '-- 不修改 --' },
                    { value: 'male', label: '男' },
                    { value: 'female', label: '女' },
                    { value: 'other', label: '其他' },
                    { value: 'secret', label: '保密' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  生日
                </label>
                <input
                  type="date"
                  value={editForm.birthday}
                  onChange={(e) => setEditForm(f => ({ ...f, birthday: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-2 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={editForm.is_banned === 1} onChange={(checked) => setEditForm(f => ({ ...f, is_banned: checked ? 1 : 0 }))} />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  封禁此用户
                </span>
              </div>
              {editForm.is_banned === 1 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  封禁后将踢下线该用户的所有设备
                </span>
              )}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400">
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
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleUsersConfirmAction}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">{usersConfirmMessage}</p>
      </Modal>
    </div>
  );
}
