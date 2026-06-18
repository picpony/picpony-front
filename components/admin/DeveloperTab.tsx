'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdBuild, MdRefresh, MdPersonAdd, MdRemoveCircle } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

interface DeveloperUser {
  id: number;
  username: string;
  email: string;
  api_key: string | null;
  derpi_username: string | null;
  created_at: string;
}

export default function DeveloperTab({ token }: { token: string }) {
  const [devPassword, setDevPassword] = useState('');
  const [passwordUpdatedAt, setPasswordUpdatedAt] = useState('');
  const [devUsers, setDevUsers] = useState<DeveloperUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDevUserId, setAddDevUserId] = useState('');

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmActionRef = useRef<(() => void) | null>(null);

  const showConfirm = (action: () => void) => {
    confirmActionRef.current = action;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    confirmActionRef.current?.();
    setConfirmOpen(false);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const passRes = await api.adminGetDeveloperPassword(token);
      if (passRes.success) {
        setDevPassword(passRes.password || '');
        setPasswordUpdatedAt(passRes.updated_at || '');
      }
      const usersRes = await api.adminGetDeveloperUsers(token);
      if (usersRes.success) {
        setDevUsers(usersRes.users || []);
      }
    } catch {
      showToast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleRefreshPassword = async () => {
    try {
      const res = await api.adminRefreshDeveloperPassword(token);
      const data = await res.json();
      if (data.success) {
        showToast('密码已更新', 'success');
        loadData();
      } else {
        showToast(data.error || '更新失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleEnableDeveloper = async () => {
    const id = parseInt(addDevUserId);
    if (isNaN(id)) { showToast('请输入有效的用户 ID', 'warning'); return; }
    try {
      const res = await api.adminEnableDeveloper(token, id);
      const data = await res.json();
      if (data.success) {
        showToast('已开启开发者模式', 'success');
        setAddDevUserId('');
        loadData();
      } else {
        showToast(data.error || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleRevokeDeveloper = (targetId: number) => {
    showConfirm(async () => {
      try {
        const res = await api.adminRevokeDeveloper(token, targetId);
        const data = await res.json();
        if (data.success) {
          showToast('已关闭开发者模式', 'success');
          loadData();
        } else {
          showToast(data.error || '操作失败', 'error');
        }
      } catch {
        showToast('操作失败', 'error');
      }
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBuild className="text-primary" size={24} />}
        title="开发者模式管理"
        onRefresh={loadData}
      />

      {/* Developer Password */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">维护密码</h3>
        <div className="text-xs text-slate-500 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border-l-4 border-l-blue-500">
          此密码为系统随机生成的8位纯数字，每3天自动更新一次。用户开启开发者模式需输入此密码。
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">当前密码：</span>
          <code className="text-xl font-bold tracking-widest px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded text-primary">
            {devPassword || '----'}
          </code>
        </div>

        {passwordUpdatedAt && (
          <p className="text-xs text-slate-400">上次更新：{passwordUpdatedAt}</p>
        )}

        <button
          onClick={handleRefreshPassword}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          <MdRefresh size={16} /> 手动更新密码
        </button>
      </div>

      {/* Developer Users */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">开发者用户列表</h3>
        <div className="text-xs text-slate-500 p-3 bg-orange-50 dark:bg-orange-900/20 rounded border-l-4 border-l-orange-500">
          以下用户已开启开发者模式。管理员可随时关闭任一用户的开发者模式。
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            value={addDevUserId}
            onChange={(e) => setAddDevUserId(e.target.value)}
            placeholder="输入用户 ID"
            className="w-32 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
          />
          <button
            onClick={handleEnableDeveloper}
            className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <MdPersonAdd size={16} /> 强制开启
          </button>
        </div>

        {loading ? <Spinner /> : devUsers.length === 0 ? (
          <EmptyState message="暂无开发者用户" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">ID</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">用户名</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">邮箱</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">Derpi 身份</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">注册时间</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {devUsers.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-2">{u.id}</td>
                    <td className="py-2 px-2 font-medium">{u.username}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{u.email}</td>
                    <td className="py-2 px-2 text-xs">{u.derpi_username || '-'}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{u.created_at}</td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => handleRevokeDeveloper(u.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="关闭开发者模式"
                      >
                        <MdRemoveCircle size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认关闭"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要关闭该用户的开发者模式？</p>
      </Modal>
    </div>
  );
}
