'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import Select from '@/components/Select';
import { MdNotifications, MdSend, MdDelete } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { defineResource, SKIP, useResource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { adminData } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface NotificationItem {
  id: number;
  user_id: number;
  receiver_name?: string;
  title: string;
  content: string;
  created_at: string;
}

const notificationsQuery = defineResource<{ token: string; filter: string }, NotificationItem[]>({
  name: 'admin-notifications',
  key: ({ token, filter }) => `${token}:${filter}`,
  ttl: 60_000,
  maxEntries: 8,
  fetch: async ({ token, filter }, signal) => {
    if (readToken() !== token) throw new Error('登录状态已失效，请重新登录');
    const data = await adminApi.adminGetNotifications(token, filter, signal);
    return adminData(data, data.notifications || []);
  },
});

export default function NotificationsTab({ token }: { token: string }) {
  const [filter, setFilter] = useState('all');
  const read = useResource(notificationsQuery, token ? { token, filter } : SKIP);
  const notifications = read.data ?? [];
  const loading = read.data === undefined && !read.error;
  const loadNotifications = read.refresh;
  const sendMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);
  const sending = sendMutation.busy;

  const { confirmThen, confirmDialog } = useConfirm();

  // Form fields
  const [targetUserId, setTargetUserId] = useState('0');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSend = async () => {
    if (sendMutation.isPending()) return;
    const userId = Number(targetUserId);
    if (!targetUserId.trim() || !Number.isSafeInteger(userId) || userId < 0) {
      showToast('请输入有效的接收用户 ID，0 代表全站广播', 'warning');
      return;
    }
    if (!title.trim() || !content.trim()) {
      showToast('请填写标题和内容', 'warning');
      return;
    }
    await sendMutation.run(
      () => adminApi.adminSendNotification(token, {
        user_id: userId,
        title: title.trim(),
        content: content.trim(),
      }),
      () => {
        showToast('已发送通知', 'success');
        setTitle('');
        setContent('');
        setTargetUserId('0');
      },
      '发送失败',
      { onCommitted: () => notificationsQuery.invalidate() },
    );
  };

  const handleDelete = (id: number) => {
    confirmThen('确认删除', '确定要删除此通知吗？', async () => {
      await deleteMutation.run(
        () => adminApi.adminDeleteNotification(token, id),
        () => showToast('已删除', 'success'),
        '删除失败',
        { onCommitted: () => notificationsQuery.invalidate() },
      );
    });
  };

  const notificationColumns: Column<NotificationItem>[] = [
    { key: 'id', header: 'ID', render: (n) => n.id },
    { key: 'target', header: '接收目标', render: (n) => n.receiver_name || `用户#${n.user_id}` },
    {
      key: 'title',
      header: '标题',
      primary: true,
      render: (n) => <span className="text-body-m-emphasized">{n.title}</span>,
    },
    { key: 'content', header: '内容', className: 'max-w-xs truncate', render: (n) => n.content },
    {
      key: 'created',
      header: '时间',
      render: (n) => <span className="text-on-surface-variant text-body-s">{n.created_at}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (n) => (
        <IconButton
          size="sm"
          disabled={deleteMutation.busy}
          onClick={() => handleDelete(n.id)}
          icon={<MdDelete size={ICON.dense} />}
          aria-label={`删除通知「${n.title}」`}
          className="text-error"
        />
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdNotifications size={ICON.standard} />}
        title="系统通知发送"
        onRefresh={loadNotifications}
      />
      <Card variant="transparent" className="space-y-4">
        <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
          使用系统通知可以向特定用户或全站用户发送消息（信箱红点提醒）。用户 ID 填 0
          代表全站广播。{' '}
        </Card>
        <div>
          <Input
            label="接收用户 ID（0=全站广播）"
            id="notificationstab-f1"
            type="number"
            min={0}
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            disabled={sending}
          />
        </div>
        <div>
          <Input
            label="通知标题"
            id="notificationstab-f2"
            type="text"
            value={title}
            disabled={sending}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：您的稿件已被审核通过"
          />
        </div>
        <div>
          <Textarea
            label="通知正文"
            id="notificationstab-f3"
            rows={4}
            value={content}
            disabled={sending}
            onChange={(e) => setContent(e.target.value)}
            placeholder="通知的详细内容…"
          />
        </div>
        <Button
          onClick={handleSend}
          variant="filled"
          loading={sending}
          className="self-start"
          icon={<MdSend />}
        >
          发送通知
        </Button>
      </Card>
      <Card variant="transparent">
        <div className="flex items-center justify-between mb-4">
          <SectionHeading as="h3" className="mb-0">历史通知记录</SectionHeading>
          {/* A card header, not a form column — so the small step, beside the
              heading rather than towering over it. */}
          <Select
            size="sm"
            value={filter}
            onChange={(v) => setFilter(v)}
            aria-label="通知筛选"
            options={[
              { value: 'all', label: '全部通知' },
              { value: 'broadcast', label: '仅看全站广播' },
              { value: 'personal', label: '仅看单独推送' },
            ]}
          />
        </div>

        <DataTable<NotificationItem>
          columns={notificationColumns}
          rows={notifications}
          rowKey={(n) => n.id}
          loading={loading}
          error={read.error instanceof Error ? read.error.message : read.error ? '通知加载失败' : undefined}
          onRetry={loadNotifications}
          empty="暂无通知记录"
        />
      </Card>
      {confirmDialog}
    </div>
  );
}
