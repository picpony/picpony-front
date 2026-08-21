'use client';

import { useState, useEffect } from 'react';
import { showToast } from '@/components/Toast';
import Select from '@/components/Select';
import { MdNotifications, MdSend, MdDelete } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

interface NotificationItem {
  id: number;
  user_id: number;
  receiver_name?: string;
  title: string;
  content: string;
  created_at: string;
}

export default function NotificationsTab({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  /* `useConfirm`, not a `Modal` plus an open flag and a ref. Five admin tabs
     converted to the shared dialog and five — this among them — kept their own,
     which is also why their copy drifted: every hand-rolled body dropped the
     sentence-final 吗 that every converted one kept. */
  const { confirmThen, confirmDialog } = useConfirm();

  // Form fields
  const [targetUserId, setTargetUserId] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const data = await adminApi.adminGetNotifications(token, filter);
      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch {
      showToast('通知加载失败', 'error');
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
        const data = await adminApi.adminGetNotifications(token, filter);
        if (!cancelled && data.success) {
          setNotifications(data.notifications || []);
        }
      } catch {
        if (!cancelled) showToast('通知加载失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, filter]);

  const handleSend = async () => {
    if (!title.trim() || !content.trim()) {
      showToast('请填写标题和内容', 'warning');
      return;
    }
    setSending(true);
    try {
      const res = await adminApi.adminSendNotification(token, {
        user_id: targetUserId,
        title: title.trim(),
        content: content.trim(),
      });
      const data = await res.json();
      if (data.success) {
        showToast('通知发送成功', 'success');
        setTitle('');
        setContent('');
        setTargetUserId(0);
        loadNotifications();
      } else {
        showToast(data.error || '发送失败', 'error');
      }
    } catch {
      showToast('发送失败', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = (id: number) => {
    confirmThen('确认删除', '确定要删除此通知吗？', async () => {
      try {
        const res = await adminApi.adminDeleteNotification(token, id);
        const data = await res.json();
        if (data.success) {
          showToast('已删除', 'success');
          loadNotifications();
        } else {
          showToast(data.error || '删除失败', 'error');
        }
      } catch {
        showToast('删除失败', 'error');
      }
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
      {' '}
      <SectionHeader
        icon={<MdNotifications size={ICON.standard} />}
        title="系统通知发送"
        onRefresh={loadNotifications}
      />
      <Card variant="transparent" className="space-y-4">
        {' '}
        <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
          {' '}
          使用系统通知可以向特定用户或全站用户发送消息（信箱红点提醒）。用户 ID填 0
          代表全站广播。{' '}
        </Card>
        <div>
          {' '}
          <Input
            label="接收用户 ID（0=全站广播）"
            id="notificationstab-f1"
            type="number"
            min={0}
            value={targetUserId}
            onChange={(e) => setTargetUserId(parseInt(e.target.value) || 0)}
          />
        </div>
        <div>
          {' '}
          <Input
            label="通知标题"
            id="notificationstab-f2"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：您的稿件已被审核通过"
          />
        </div>
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="notificationstab-f3">
            通知正文
          </label>
          <Textarea
            id="notificationstab-f3"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="通知的详细内容…"
          />
        </div>
        <Button
          onClick={handleSend}
          variant="filled"
          loading={sending}
          className="self-start"
          icon={<MdSend size={ICON.dense} />}
        >
          发送通知
        </Button>
      </Card>
      <Card variant="transparent">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-label-l text-on-surface">历史通知记录</h3>
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
          empty="暂无通知记录"
        />
      </Card>
      {confirmDialog}
    </div>
  );
}
