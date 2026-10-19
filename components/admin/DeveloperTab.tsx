'use client';

import { useState } from 'react';
import { MdBlock, MdLockOpen, MdContentCopy, MdPersonAdd, MdRefresh, MdRemoveCircle } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import { formatDateTime, parseBackendUtcTime } from '@/lib/format';
import { copyText } from '@/lib/utils';
import * as adminApi from '@/lib/api/admin';
import DeveloperSiteTools from './siteTools/DeveloperSiteTools';
import SectionHeader from './SectionHeader';
import { AdminForm, AdminNote } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { defineAdminQuery, retryError, tableError, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';

type DeveloperUser = adminApi.DeveloperUser;

/* Revealing the password is a POST the backend audits; this panel is where an administrator asks
   for it, so opening the panel is the request. */
const passwordQuery = defineAdminQuery<{ password: string; updatedAt: string; expiresAt: string; generation: number }>('developer-password', async (token, signal) => {
  const data = await adminApi.adminGetDeveloperPassword(token, signal);
  return { password: data.password, updatedAt: data.updated_at ?? '', expiresAt: data.expires_at ?? '', generation: data.generation };
});

const usersQuery = defineAdminQuery<DeveloperUser[]>('developer-users', (token, signal) => adminApi.adminGetDeveloperUsers(token, signal));

/** The developer-access revision a change to a listed account names (the list's own row). */
const accessRevision = (token: string, userId: number) =>
  usersQuery.peek(token).data?.find((row) => row.id === userId)?.developer_access.revision ?? 0;

/** A stamp with its offset, printed in Beijing time. */
function utcTime(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const date = parseBackendUtcTime(text);
  return date ? formatDateTime(date) : text;
}

const named = (user: DeveloperUser) => `「${user.username}」（#${user.id}）`;

/**
 * 开发者模式: the shared maintenance password users enter to switch developer mode on, and the
 * accounts that have it.
 *
 * Each action owns its busy state (R9-020: one mutation spun both buttons), the account id is a
 * real form (Enter submits), the password has a copy control, and rotating it asks first — the
 * current password stops working at once.
 */
export default function DeveloperTab({ token, viewerId, role, openTab }: AdminPanelProps) {
  const password = useAdminQuery(passwordQuery, token);
  const users = useAdminQuery(usersQuery, token);
  const rotateMutation = useAdminMutation(token);
  const enableMutation = useAdminMutation(token);
  const revokeMutation = useAdminMutation(token);
  const banMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();
  const [target, setTarget] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);
  const paged = usePagedRows(users.data ?? [], null);
  const current = password.data?.password ?? '';

  const copyPassword = async (value: string) => {
    if (await copyText(value)) {
      showToast('已复制维护密码', 'success');
      return;
    }
    void prompt({ title: '复制维护密码', label: '维护密码', defaultValue: value, message: '无法自动复制，请手动复制。', confirmLabel: '完成', allowEmpty: true, rows: 1 });
  };

  const rotate = () =>
    confirmThen(
      '确认更新维护密码',
      '确定要立即更新维护密码吗？当前密码会马上失效，已告知他人的旧密码将无法再开启开发者模式。',
      () =>
        void rotateMutation.run(
          async () => {
            const generation = passwordQuery.peek(token).data?.generation;
            return generation === undefined ? null : adminApi.adminRefreshDeveloperPassword(token, generation);
          },
          () => showToast('已更新维护密码', 'success'),
          '更新失败',
          {
            onCommitted: (data) => {
              const next = data as unknown as adminApi.MaintenancePassword;
              passwordQuery.write(token, { password: next.password, updatedAt: next.updated_at ?? '', expiresAt: next.expires_at ?? '', generation: next.generation });
            },
          },
        ),
    );

  const enable = () => {
    if (enableMutation.isPending()) return;
    const text = target.trim();
    const id = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < 1) {
      setTargetError('请输入有效的用户 ID');
      return;
    }
    void enableMutation.run(
      /* The account is usually not in the list (it has no grant yet), and one that had a grant
         before is not at revision 0: its own state is read first, so the grant names its revision. */
      async () => {
        const account = await adminApi.adminGetDeveloperAccess(token, id);
        return adminApi.adminEnableDeveloper(token, id, account.developer_access.revision);
      },
      () => {
        showToast(`已为 #${id} 开启开发者模式`, 'success');
        setTarget('');
      },
      '开启失败',
      { onCommitted: users.refresh },
    );
  };

  const revoke = (user: DeveloperUser) =>
    confirmThen('确认关闭开发者模式', `确定要关闭用户${named(user)}的开发者模式吗？`, () =>
      void revokeMutation.run(
        () => adminApi.adminRevokeDeveloper(token, user.id, accessRevision(token, user.id)),
        () => showToast(`已关闭${named(user)}的开发者模式`, 'success'),
        '关闭开发者模式失败',
        {
          key: user.id,
          onCommitted: (data) => {
            const access = data as unknown as adminApi.DeveloperAccess;
            usersQuery.write(token, (previous) => previous?.map((row) => (row.id === user.id ? { ...row, developer_access: { ...row.developer_access, ...access } } : row)) ?? []);
            users.refresh();
          },
        },
      ));

  const columns: Column<DeveloperUser>[] = [
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (user) => <span className="text-body-m-emphasized text-on-surface">{user.username}</span>,
    },
    { key: 'id', header: 'ID', width: 'auto', render: (user) => `#${user.id}` },
    {
      key: 'email',
      header: '邮箱',
      className: 'wrap-anywhere',
      render: (user) => <span className="text-on-surface-variant">{user.email || '未绑定'}</span>,
    },
    {
      key: 'derpi',
      header: 'Derpibooru 身份',
      render: (user) => (
        <span className="text-on-surface-variant">
          {[user.upstream_identity?.name || '未核验', user.key_hint ? `API Key 已绑定（${user.key_hint}）` : 'API Key 未绑定'].join(' · ')}
        </span>
      ),
    },
    {
      key: 'created',
      header: '注册时间',
      width: 'auto',
      render: (user) => <span className="text-on-surface-variant">{user.created_at ? formatDateTime(user.created_at) : '—'}</span>,
    },
    {
      key: 'state',
      header: '状态',
      width: 'auto',
      render: (user) =>
        user.developer_access.banned ? (
          <Badge tone="error" size="md">已封禁</Badge>
        ) : user.developer_access.active ? (
          <Badge tone="success" size="md">已开启</Badge>
        ) : user.developer_access.enabled ? (
          <Badge tone="warning" size="md">已开启（未生效）</Badge>
        ) : (
          <Badge size="md">未开启</Badge>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (user) =>
        <>
        {user.developer_access.enabled && !user.developer_access.banned && (
          <IconButton
            size="sm"
            variant="danger-text"
            icon={<MdRemoveCircle />}
            aria-label={`关闭 ${user.username} 的开发者模式`}
            loading={revokeMutation.pendingKeys.has(user.id)}
            disabled={user.id === viewerId || banMutation.pendingKeys.has(user.id)}
            onClick={() => revoke(user)}
          />
        )}
        <IconButton size="sm" variant={user.developer_access.banned ? 'standard' : 'danger-text'}
          icon={user.developer_access.banned ? <MdLockOpen /> : <MdBlock />}
          aria-label={`${user.developer_access.banned ? '解封' : '封禁'} ${user.username} 的开发者权限`}
          disabled={user.id === viewerId || ((user.id === 1 || user.role === 'super_admin') && role !== 'super_admin') || revokeMutation.pendingKeys.has(user.id)} loading={banMutation.pendingKeys.has(user.id)}
          onClick={() => {
            if (user.id === viewerId || ((user.id === 1 || user.role === 'super_admin') && role !== 'super_admin')) return;
            const banned = user.developer_access.banned;
            confirmThen(banned ? '确认解封开发者权限' : '确认封禁开发者权限', `确定要${banned ? '解封' : '封禁'}用户${named(user)}的开发者权限吗？${banned ? '' : '封禁后，该用户将无法自主开启开发者模式。'}`, () => void banMutation.run(
              () => banned ? adminApi.adminUnbanDeveloper(token, user.id, accessRevision(token, user.id)) : adminApi.adminBanDeveloper(token, user.id, accessRevision(token, user.id)),
              () => showToast(banned ? '已解封开发者权限' : '已封禁开发者权限', 'success'),
              banned ? '开发者权限解封失败' : '开发者权限封禁失败', { key: user.id, onCommitted: () => usersQuery.invalidate() },
            ));
          }} />
        </>,
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader section="developer"
        onRefresh={() => {
          password.refresh();
          users.refresh();
        }}
        isLoading={password.refreshing || users.refreshing}
      />

      <section aria-labelledby="admin-maintenance-password-heading" className="space-y-4">
        <SectionHeading as="h3" id="admin-maintenance-password-heading">维护密码</SectionHeading>
        <AdminNote>
          系统随机生成的 8 位数字，每 3 天（北京时间早上 8 点）自动更新一次。用户开启开发者模式时需要输入此密码。
        </AdminNote>
        {password.error && !password.data ? (
          <ErrorRetry size="inline" {...retryError('维护密码加载失败', password.error)} onRetry={password.retryable ? password.refresh : undefined} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-body-m text-on-surface-variant">当前密码</span>
            {password.data ? (
              <>
                {/* Code is 4dp in the Shape table, inline or displayed (G4-032), as /policy's is. */}
                <code className="rounded-xs bg-surface-container-highest px-4 py-2 font-mono text-title-l tracking-widest text-on-surface">
                  {password.data.password}
                </code>
                <IconButton
                  icon={<MdContentCopy />}
                  aria-label="复制维护密码"
                  onClick={() => void copyPassword(current)}
                />
              </>
            ) : (
              <Skeleton className="h-11 w-44 rounded-xs" />
            )}
            <Button
              type="button"
              variant="tonal"
              icon={<MdRefresh />}
              className="sm:ml-auto"
              disabled={!password.data}
              loading={rotateMutation.busy}
              onClick={rotate}
            >
              立即更新密码
            </Button>
          </div>
        )}
        {password.data && (
          <p className="text-body-s text-on-surface-variant">
            {[password.data.updatedAt ? `上次更新：${utcTime(password.data.updatedAt)}` : '上次更新：首次生成', password.data.expiresAt ? `到期：${utcTime(password.data.expiresAt)}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </section>

      <section aria-labelledby="admin-developer-users-heading" className="space-y-4">
        <SectionHeading as="h3" id="admin-developer-users-heading">开发者用户</SectionHeading>
        <AdminForm onSubmit={enable} aria-label="为用户开启开发者模式">
          {/* The button is the field's height (56dp) and shares its top edge: a 40dp button at
              the bottom of a row of labelled fields sat 8px off their line (R9-025). */}
          <div className="flex flex-wrap items-start gap-3">
            <Input
              label="用户 ID"
              inputMode="numeric"
              autoComplete="off"
              value={target}
              readOnly={enableMutation.busy}
              error={targetError ?? undefined}
              helper="不检查前置条件，直接为该用户开启开发者模式"
              fieldClassName="sm:w-80"
              onChange={(event) => {
                setTarget(event.target.value);
                setTargetError(null);
              }}
            />
            <Button type="submit" size="lg" variant="filled" icon={<MdPersonAdd />} loading={enableMutation.busy}>
              开启开发者模式
            </Button>
          </div>
        </AdminForm>
        <AdminListAnchor>
          <DataTable<DeveloperUser>
            columns={columns}
            rows={paged.rows}
            listKey={paged.listKey}
            rowKey={(user) => user.id}
            loading={users.loading}
            skeletonRows={5}
            {...tableError('开发者列表加载失败', users.error)}
            onRetry={users.retryable ? users.refresh : undefined}
            empty="还没有开启开发者模式的用户"
          />
          <AdminPager
            page={paged.page}
            totalPages={paged.totalPages}
            onPageChange={paged.setPage}
            summary={users.data ? `共 ${paged.total} 位用户` : undefined}
          />
        </AdminListAnchor>
      </section>
      <DeveloperSiteTools token={token} viewerId={viewerId} role={role} openTab={openTab} />
      {confirmDialog}
      {promptDialog}
    </div>
  );
}
