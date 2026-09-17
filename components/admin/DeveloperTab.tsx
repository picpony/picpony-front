'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import { MdBuild, MdRefresh, MdPersonAdd, MdRemoveCircle } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface DeveloperUser {
  id: number;
  username: string;
  email: string;
  api_key: string | null;
  derpi_username: string | null;
  created_at: string;
}

const passwordQuery = defineAdminQuery('developer-password', async (token, signal) => {
  const data = await adminApi.adminGetDeveloperPassword(token, signal);
  adminData(data, undefined);
  if (typeof data.password !== 'string') throw new Error('维护密码响应无效');
  return { password: data.password, updatedAt: typeof data.updated_at === 'string' ? data.updated_at : '' };
});
const usersQuery = defineAdminQuery<DeveloperUser[]>('developer-users', async (token, signal) => {
  const data = await adminApi.adminGetDeveloperUsers(token, signal);
  return adminData(data, data.users ?? []);
});

export default function DeveloperTab({ token }: { token: string }) {
  const passwordRead = useAdminQuery(passwordQuery, token);
  const usersRead = useAdminQuery(usersQuery, token);
  const devPassword = passwordRead.data?.password;
  const passwordUpdatedAt = passwordRead.data?.updatedAt;
  const mutation = useAdminMutation(token);
  const [addDevUserId, setAddDevUserId] = useState('');

  const { confirmThen, confirmDialog } = useConfirm();

  const loadData = () => {
    passwordRead.refresh();
    usersRead.refresh();
  };

  const handleRefreshPassword = async () => {
    if (!passwordRead.data) return;
    await mutation.run(() => adminApi.adminRefreshDeveloperPassword(token), () => {
        showToast('密码已更新', 'success');
      }, '操作失败', { onCommitted: passwordRead.refresh });
  };

  const handleEnableDeveloper = async () => {
    if (!usersRead.data) return;
    const id = Number(addDevUserId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      showToast('请输入有效的用户 ID', 'warning');
      return;
    }
    await mutation.run(() => adminApi.adminEnableDeveloper(token, id), () => {
        showToast('已开启开发者模式', 'success');
        setAddDevUserId('');
      }, '操作失败', { onCommitted: usersRead.refresh });
  };

  const handleRevokeDeveloper = (targetId: number) => {
    confirmThen('确认关闭', '确定要关闭该用户的开发者模式吗？', async () => {
      await mutation.run(() => adminApi.adminRevokeDeveloper(token, targetId), () => {
          showToast('已关闭开发者模式', 'success');
        }, '操作失败', { onCommitted: usersRead.refresh });
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
            disabled={mutation.busy}
            onClick={() => handleRevokeDeveloper(u.id)}
            icon={<MdRemoveCircle size={ICON.dense} />}
            aria-label={`关闭 ${u.username} 的开发者模式`} variant="danger-text"
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
        <SectionHeading as="h3" className="mb-0">维护密码</SectionHeading>
        <div className="text-body-s text-primary-ink p-3">
          此密码为系统随机生成的 8 位纯数字，每 3 天自动更新一次。用户开启开发者模式需输入此密码。
        </div>

        {passwordRead.error ? <ErrorRetry size="inline" message={passwordRead.error} onRetry={passwordRead.refresh} /> :
          passwordRead.loading ? <Skeleton className="h-12 w-48" /> : <div className="flex items-center gap-4">
          <span className="text-body-m text-on-surface-variant">当前密码：</span>
          <code className="text-title-l-emphasized tracking-widest px-4 py-2 bg-surface-container-high rounded-xs text-primary-ink">
            {devPassword || '----'}
          </code>
        </div>}

        {passwordUpdatedAt && (
          <p className="text-body-s text-on-surface-variant">上次更新：{passwordUpdatedAt}</p>
        )}

        <Button
          onClick={handleRefreshPassword}
          disabled={!passwordRead.data || Boolean(passwordRead.error)}
          loading={mutation.busy}
          variant="filled"
          className="self-start"
          icon={<MdRefresh />}
        >
          手动更新密码
        </Button>
      </Card>

      {/* Developer Users */}
      <Card variant="transparent" className="space-y-4">
        <SectionHeading as="h3" className="mb-0">开发者用户列表</SectionHeading>
        <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
          以下用户已开启开发者模式。管理员可随时关闭任一用户的开发者模式。
        </Card>

        <div className="flex items-center gap-3">
          <Input
            type="number"
            size="sm"
            min={1}
            step={1}
            disabled={!usersRead.data || mutation.busy}
            value={addDevUserId}
            onChange={(e) => setAddDevUserId(e.target.value)}
            placeholder="输入用户 ID"
            fieldClassName="w-32"
          />
          <Button onClick={handleEnableDeveloper} variant="filled" icon={<MdPersonAdd />}
            loading={mutation.busy} disabled={!usersRead.data || !addDevUserId || Boolean(usersRead.error)}>
            强制开启
          </Button>
        </div>

        <DataTable<DeveloperUser>
          columns={devColumns}
          rows={usersRead.data ?? []}
          rowKey={(u) => u.id}
          loading={usersRead.loading}
          error={usersRead.error}
          onRetry={usersRead.refresh}
          empty="暂无开发者用户"
        />
      </Card>

      {confirmDialog}
    </div>
  );
}
