'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdAttachMoney } from 'react-icons/md';
import { SectionHeader, SearchInput, EmptyState, Spinner } from './';

interface User {
  id: number;
  username: string;
  experience: number;
  coins: number;
}

export default function WealthTab({ token }: { token: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({
    experience: 0,
    coinsOp: 'add',
    coinsValue: '',
    reason: '',
  });

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetWealth(token);
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
    api.adminGetWealth(token)
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
      u.username?.toLowerCase().includes(kw)
    );
  }, [searchKw, users]);

  const openModal = (user: User) => {
    setEditingUser(user);
    setForm({
      experience: user.experience || 0,
      coinsOp: 'add',
      coinsValue: '',
      reason: '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const submit = async () => {
    if (!editingUser) return;
    if (!form.reason.trim()) {
      showToast('请填写变动原因', 'error');
      return;
    }
    try {
      const res = await api.adminUpdateWealth(token, {
        target_id: editingUser.id,
        experience: form.experience,
        coins_op: form.coinsOp,
        coins_value: form.coinsValue,
        reason: form.reason,
      });
      const data = await res.json();
      if (data.success) {
        showToast('修改成功', 'success');
        closeModal();
        loadUsers();
      } else {
        showToast(data.error || '修改失败', 'error');
      }
    } catch {
      showToast('修改失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdAttachMoney className="text-primary" size={24} />}
        title="经验与金币管理"
        onRefresh={loadUsers}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索用户ID或用户名..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">用户名</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">当前经验</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">当前金币</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={5} message="" icon={<Spinner label="" />} />
            ) : filteredUsers.length === 0 ? (
              <EmptyState colSpan={5} message="没有找到匹配的用户" />
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{user.id}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-primary">{user.username}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">{user.experience || 0}</td>
                  <td className="px-4 py-3 text-sm font-medium text-amber-600">{user.coins || 0}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openModal(user)}
                      className="px-3 py-1 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded transition-colors"
                    >
                      修改资产
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`修改资产 - ${editingUser?.username || ''}`}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={submit}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
            >
              确认修改
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">经验值</label>
            <input
              type="number"
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">金币操作</label>
            <div className="flex gap-2">
              <select
                value={form.coinsOp}
                onChange={(e) => setForm({ ...form, coinsOp: e.target.value })}
                className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
              >
                <option value="add">[+]</option>
                <option value="sub">[-]</option>
                <option value="set">[=]</option>
              </select>
              <input
                type="number"
                value={form.coinsValue}
                onChange={(e) => setForm({ ...form, coinsValue: e.target.value })}
                placeholder="数值"
                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">变动原因（必填）</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例如: 违规惩罚、特殊活动奖励..."
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
