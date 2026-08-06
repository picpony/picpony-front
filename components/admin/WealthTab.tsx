'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdAttachMoney } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { Input } from '@/components/Input';

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
    api
      .adminGetWealth(token)
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
    return users.filter((u) => String(u.id) === kw || u.username?.toLowerCase().includes(kw));
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

  const wealthColumns: Column<User>[] = [
    { key: 'id', header: 'ID', render: (u) => `#${u.id}` },
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (u) => <span className="text-primary font-medium">{u.username}</span>,
    },
    { key: 'exp', header: '当前经验', render: (u) => u.experience || 0 },
    {
      key: 'coins',
      header: '当前金币',
      render: (u) => <span className="text-warning font-medium">{u.coins || 0}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <Button onClick={() => openModal(u)} variant="filled" size="sm">
          修改资产
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      {' '}
      <SectionHeader
        icon={<MdAttachMoney className="text-primary" size={24} />}
        title="经验与金币管理"
        onRefresh={loadUsers}
      />{' '}
      <SearchInput value={searchKw} onChange={setSearchKw} placeholder="搜索用户ID或用户名..." />{' '}
      <DataTable<User>
        columns={wealthColumns}
        rows={filteredUsers}
        rowKey={(u) => u.id}
        loading={isLoading}
        empty="没有找到匹配的用户"
      />{' '}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`修改资产 - ${editingUser?.username || ''}`}
        maxWidth="max-w-md"
        footer={
          <>
            {' '}
            <Button variant="text" onClick={closeModal}>
              {' '}
              取消{' '}
            </Button>{' '}
            <Button variant="filled" onClick={submit}>
              {' '}
              确认修改{' '}
            </Button>{' '}
          </>
        }
      >
        {' '}
        <div className="space-y-4">
          {' '}
          <div>
            {' '}
            <Input
              label="经验值"
              id="wealthtab-f1"
              type="number"
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: parseInt(e.target.value) || 0 })}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface mb-1">金币操作</label>{' '}
            <div className="flex gap-2">
              {' '}
              <Select
                value={form.coinsOp}
                onChange={(v) => setForm({ ...form, coinsOp: v })}
                aria-label="金币操作方式"
                options={[
                  { value: 'add', label: '[+]' },
                  { value: 'sub', label: '[-]' },
                  { value: 'set', label: '[=]' },
                ]}
              />
              <Input
                type="number"
                value={form.coinsValue}
                onChange={(e) => setForm({ ...form, coinsValue: e.target.value })}
                placeholder="数值"
                fieldClassName="flex-1"
              />
            </div>
          </div>
          <div>
            <Input
              label="变动原因（必填）"
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例如: 违规惩罚、特殊活动奖励..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
