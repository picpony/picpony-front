'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdAttachMoney } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { readToken } from '@/lib/hooks';
/* Namespace import, deliberately: `api` is a runtime spread and
   un-tree-shakeable, so only these admin tabs may import `lib/api/admin`. */
import * as adminApi from '@/lib/api/admin';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [form, setForm] = useState({
    experience: 0,
    coinsOp: 'add',
    coinsValue: '',
    reason: '',
  });

  const loadUsers = useCallback(async () => {
    if (readToken() !== token) return;
    setIsLoading(true);
    try {
      const data = await adminApi.adminGetWealth(token);
      if (readToken() !== token) return;
      if (data.success) {
        setUsers(data.users || []);
      }
    } catch {
      if (readToken() === token) showToast('用户加载失败', 'error');
    } finally {
      if (readToken() === token) setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || readToken() !== token) return;
    let cancelled = false;
    adminApi
      .adminGetWealth(token)
      .then((data) => {
        if (cancelled || readToken() !== token) return;
        if (data.success) {
          setUsers(data.users || []);
        }
      })
      .catch(() => {
        if (!cancelled && readToken() === token) showToast('用户加载失败', 'error');
      })
      .finally(() => {
        if (!cancelled && readToken() === token) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const filteredUsers = useMemo(() => {
    if (!searchKw) return users;
    const kw = searchKw.toLowerCase();
    return users.filter((u) => String(u.id) === kw || u.username?.toLowerCase().includes(kw));
  }, [searchKw, users]);

  const openModal = (user: User) => {
    if (submittingRef.current) return;
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
    if (submittingRef.current) return;
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const submit = async () => {
    if (!editingUser || submittingRef.current || readToken() !== token) return;
    if (!form.reason.trim()) {
      showToast('请填写变动原因', 'error');
      return;
    }
    // A ref closes the gap before React renders the disabled button. A double
    // activation must never apply a non-idempotent coin increment twice.
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await adminApi.adminUpdateWealth(token, {
        target_id: editingUser.id,
        experience: form.experience,
        coins_op: form.coinsOp,
        coins_value: form.coinsValue,
        reason: form.reason,
      });
      const data = await res.json();
      if (readToken() !== token) return;
      if (data.success) {
        showToast('已更新', 'success');
        setIsModalOpen(false);
        setEditingUser(null);
        await loadUsers();
      } else {
        showToast(data.error || '修改失败', 'error');
      }
    } catch {
      if (readToken() === token) showToast('修改失败', 'error');
    } finally {
      submittingRef.current = false;
      if (readToken() === token) setIsSubmitting(false);
    }
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
        <Button onClick={() => openModal(u)} variant="filled" size="xs">
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
      <SearchInput value={searchKw} onChange={setSearchKw} placeholder="搜索用户 ID或用户名…" />
      <DataTable<User>
        columns={wealthColumns}
        rows={filteredUsers}
        rowKey={(u) => u.id}
        loading={isLoading}
        empty="没有找到匹配的用户"
      />
      <Modal
        isOpen={isModalOpen}
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
