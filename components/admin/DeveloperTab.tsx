'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdBuild, MdRefresh, MdPersonAdd, MdRemoveCircle } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input } from '@/components/Input';

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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const passRes = await api.adminGetDeveloperPassword(token);
        if (!cancelled && passRes.success) {
          setDevPassword(passRes.password || '');
          setPasswordUpdatedAt(passRes.updated_at || '');
        }
        const usersRes = await api.adminGetDeveloperUsers(token);
        if (!cancelled && usersRes.success) {
          setDevUsers(usersRes.users || []);
        }
      } catch {
        if (!cancelled) showToast('加载数据失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
    if (isNaN(id)) {
      showToast('请输入有效的用户 ID', 'warning');
      return;
    }
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

  const devColumns: Column<DeveloperUser>[] = [
    { key: 'id', header: 'ID', render: (u) => u.id },
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (u) => <span className="font-medium">{u.username}</span>,
    },
    {
      key: 'email',
      header: '邮箱',
      render: (u) => <span className="text-outline text-body-s">{u.email}</span>,
    },
    {
      key: 'derpi',
      header: 'Derpi 身份',
      render: (u) => <span className="text-body-s">{u.derpi_username || '-'}</span>,
    },
    {
      key: 'created',
      header: '注册时间',
      render: (u) => <span className="text-outline text-body-s">{u.created_at}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <button
          onClick={() => handleRevokeDeveloper(u.id)}
          className="touch-target state-layer rounded-full p-1.5 text-error"
          title="关闭开发者模式"
          aria-label={`关闭 ${u.username} 的开发者模式`}
        >
          <MdRemoveCircle size={16} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBuild className="text-primary" size={24} />}
        title="开发者模式管理"
        onRefresh={loadData}
      />

      {/* Developer Password */}
      <Card variant="transparent" className="space-y-4">
        <h3 className="text-label-l-emphasized text-on-surface">维护密码</h3>
        <div className="text-body-s text-primary rounded-sm p-3">
          此密码为系统随机生成的8位纯数字，每3天自动更新一次。用户开启开发者模式需输入此密码。
        </div>

        <div className="flex items-center gap-4">
          <span className="text-body-m text-on-surface-variant">当前密码：</span>
          <code className="text-title-l-emphasized tracking-widest px-4 py-2 bg-surface-container-high rounded text-primary">
            {devPassword || '----'}
          </code>
        </div>

        {passwordUpdatedAt && (
          <p className="text-body-s text-outline">上次更新：{passwordUpdatedAt}</p>
        )}

        <Button
          onClick={handleRefreshPassword}
          variant="filled"
          className="self-start"
          icon={<MdRefresh size={16} />}
        >
          手动更新密码
        </Button>
      </Card>

      {/* Developer Users */}
      <Card variant="transparent" className="space-y-4">
        <h3 className="text-label-l-emphasized text-on-surface">开发者用户列表</h3>
        <div className="text-body-s text-on-surface-variant p-3 rounded">
          以下用户已开启开发者模式。管理员可随时关闭任一用户的开发者模式。
        </div>

        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={addDevUserId}
            onChange={(e) => setAddDevUserId(e.target.value)}
            placeholder="输入用户 ID"
            fieldClassName="w-32"
          />
          <Button onClick={handleEnableDeveloper} variant="filled" icon={<MdPersonAdd size={16} />}>
            强制开启
          </Button>
        </div>

        <DataTable<DeveloperUser>
          columns={devColumns}
          rows={devUsers}
          rowKey={(u) => u.id}
          loading={loading}
          empty="暂无开发者用户"
        />
      </Card>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认关闭"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleConfirm}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">确定要关闭该用户的开发者模式？</p>
      </Modal>
    </div>
  );
}
