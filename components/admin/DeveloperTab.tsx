'use client';

import { useState, useEffect } from 'react';
import { showToast } from '@/components/Toast';
import { MdBuild, MdRefresh, MdPersonAdd, MdRemoveCircle } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

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

  /* `useConfirm`, not a `Modal` plus an open flag and a ref. Five admin tabs
     converted to the shared dialog and five — this among them — kept their own,
     which is also why their copy drifted: every hand-rolled body dropped the
     sentence-final 吗 that every converted one kept. */
  const { confirmThen, confirmDialog } = useConfirm();

  const loadData = async () => {
    setLoading(true);
    try {
      const passRes = await adminApi.adminGetDeveloperPassword(token);
      if (passRes.success) {
        setDevPassword(passRes.password || '');
        setPasswordUpdatedAt(passRes.updated_at || '');
      }
      const usersRes = await adminApi.adminGetDeveloperUsers(token);
      if (usersRes.success) {
        setDevUsers(usersRes.users || []);
      }
    } catch {
      showToast('数据加载失败', 'error');
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
        const passRes = await adminApi.adminGetDeveloperPassword(token);
        if (!cancelled && passRes.success) {
          setDevPassword(passRes.password || '');
          setPasswordUpdatedAt(passRes.updated_at || '');
        }
        const usersRes = await adminApi.adminGetDeveloperUsers(token);
        if (!cancelled && usersRes.success) {
          setDevUsers(usersRes.users || []);
        }
      } catch {
        if (!cancelled) showToast('数据加载失败', 'error');
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
      const res = await adminApi.adminRefreshDeveloperPassword(token);
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
      const res = await adminApi.adminEnableDeveloper(token, id);
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
    confirmThen('确认关闭', '确定要关闭该用户的开发者模式吗？', async () => {
      try {
        const res = await adminApi.adminRevokeDeveloper(token, targetId);
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
      render: (u) => <span className="text-body-m-emphasized">{u.username}</span>,
    },
    {
      key: 'email',
      header: '邮箱',
      render: (u) => <span className="text-on-surface-variant text-body-s">{u.email}</span>,
    },
    {
      key: 'derpi',
      header: 'Derpi 身份',
      render: (u) => <span className="text-body-s">{u.derpi_username || '-'}</span>,
    },
    {
      key: 'created',
      header: '注册时间',
      render: (u) => <span className="text-on-surface-variant text-body-s">{u.created_at}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (u) => (
        <IconButton
            size="sm"
            onClick={() => handleRevokeDeveloper(u.id)}
            icon={<MdRemoveCircle size={ICON.dense} />}
            aria-label={`关闭 ${u.username} 的开发者模式`} className="text-error"
          />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBuild size={ICON.standard} />}
        title="开发者模式管理"
        onRefresh={loadData}
      />

      {/* Developer Password */}
      <Card variant="transparent" className="space-y-4">
        <h3 className="text-label-l text-on-surface">维护密码</h3>
        <div className="text-body-s text-primary p-3">
          此密码为系统随机生成的8位纯数字，每3天自动更新一次。用户开启开发者模式需输入此密码。
        </div>

        <div className="flex items-center gap-4">
          <span className="text-body-m text-on-surface-variant">当前密码：</span>
          <code className="text-title-l-emphasized tracking-widest px-4 py-2 bg-surface-container-high rounded-xs text-primary">
            {devPassword || '----'}
          </code>
        </div>

        {passwordUpdatedAt && (
          <p className="text-body-s text-on-surface-variant">上次更新：{passwordUpdatedAt}</p>
        )}

        <Button
          onClick={handleRefreshPassword}
          variant="filled"
          className="self-start"
          icon={<MdRefresh size={ICON.dense} />}
        >
          手动更新密码
        </Button>
      </Card>

      {/* Developer Users */}
      <Card variant="transparent" className="space-y-4">
        <h3 className="text-label-l text-on-surface">开发者用户列表</h3>
        <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
          以下用户已开启开发者模式。管理员可随时关闭任一用户的开发者模式。
        </Card>

        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={addDevUserId}
            onChange={(e) => setAddDevUserId(e.target.value)}
            placeholder="输入用户 ID"
            fieldClassName="w-32"
          />
          <Button onClick={handleEnableDeveloper} variant="filled" icon={<MdPersonAdd size={ICON.dense} />}>
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

      {confirmDialog}
    </div>
  );
}
