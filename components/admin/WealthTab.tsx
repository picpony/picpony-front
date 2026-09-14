'use client';

import { useState, useMemo } from 'react';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdAttachMoney } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface User {
  id: number;
  username: string;
  experience: number;
  coins: number;
}

const emptyUsers: User[] = [];
const usersQuery = defineAdminQuery<User[]>('wealth', async (token, signal) => {
  const data = await adminApi.adminGetWealth(token, signal);
  return adminData(data, data.users || []);
});

export default function WealthTab({ token }: { token: string }) {
  const read = useAdminQuery(usersQuery, token);
  const users = read.data ?? emptyUsers;
  const isLoading = read.loading;
  const loadUsers = read.refresh;
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const mutation = useAdminMutation(token);
  const isSubmitting = mutation.busy;
  const [form, setForm] = useState({
    experience: 0,
    coinsOp: 'add',
    coinsValue: '',
    reason: '',
  });

  const filteredUsers = useMemo(() => {
    if (!searchKw) return users;
    const kw = searchKw.toLowerCase();
    return users.filter((u) => String(u.id) === kw || u.username?.toLowerCase().includes(kw));
  }, [searchKw, users]);

  const openModal = (user: User) => {
    if (mutation.isPending()) return;
    setEditingUser(user);
    setForm({
      experience: user.experience || 0,
      coinsOp: 'add',
      coinsValue: '',
      reason: '',
    });
  };

  const closeModal = () => {
    if (mutation.isPending()) return;
    setEditingUser(null);
  };

  const submit = async () => {
    if (!editingUser || mutation.isPending()) return;
    if (!form.reason.trim()) {
      showToast('请填写变动原因', 'error');
      return;
    }
    await mutation.run(
      () => adminApi.adminUpdateWealth(token, {
        target_id: editingUser.id,
        experience: form.experience,
        coins_op: form.coinsOp,
        coins_value: form.coinsValue,
        reason: form.reason,
      }),
      () => {
        showToast('已更新', 'success');
        setEditingUser(null);
      },
      '修改失败',
      { onCommitted: loadUsers },
    );
  };

  const wealthColumns: Column<User>[] = [
    { key: 'id', header: 'ID', render: (u) => `#${u.id}` },
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (u) => <span className="text-body-m-emphasized text-primary-ink">{u.username}</span>,
    },
    { key: 'exp', header: '当前经验', render: (u) => u.experience || 0 },
    {
      key: 'coins',
      header: '当前金币',
      render: (u) => <span className="text-body-m-emphasized text-warning">{u.coins || 0}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <Button onClick={() => openModal(u)} variant="filled" size="xs" disabled={isSubmitting}>
          修改资产
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdAttachMoney size={ICON.standard} />}
        title="经验与金币管理"
        onRefresh={loadUsers}
      />
      <SearchInput value={searchKw} onChange={setSearchKw} placeholder="搜索用户 ID 或用户名…" />
      <DataTable<User>
        columns={wealthColumns}
        rows={filteredUsers}
        rowKey={(u) => u.id}
        loading={isLoading}
        error={read.error}
        onRetry={loadUsers}
        empty="没有找到匹配的用户"
      />
      <Modal
        isOpen={editingUser !== null}
        onClose={closeModal}
        title={`修改资产 - ${editingUser?.username || ''}`}
        maxWidth="md"
        footer={
          <>
            <Button variant="text" onClick={closeModal} disabled={isSubmitting}>
              取消
            </Button>
            <Button variant="filled" onClick={submit} loading={isSubmitting}>
              确认修改
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Input
              label="经验值"
              id="wealthtab-f1"
              type="number"
              disabled={isSubmitting}
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            <p className="block text-label-l text-on-surface-variant mb-1">金币操作</p>
            <div className="flex gap-2">
              
              <Select
                disabled={isSubmitting}
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
                disabled={isSubmitting}
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
              disabled={isSubmitting}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例如：违规惩罚、特殊活动奖励…"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
