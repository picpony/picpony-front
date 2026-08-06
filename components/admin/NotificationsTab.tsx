'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdNotifications, MdSend, MdDelete } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';

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

  // Form fields
  const [targetUserId, setTargetUserId] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const data = await api.adminGetNotifications(token, filter);
      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch {
      showToast('加载通知列表失败', 'error');
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
        const data = await api.adminGetNotifications(token, filter);
        if (!cancelled && data.success) {
          setNotifications(data.notifications || []);
        }
      } catch {
        if (!cancelled) showToast('加载通知列表失败', 'error');
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
      const res = await api.adminSendNotification(token, {
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
    showConfirm(async () => {
      try {
        const res = await api.adminDeleteNotification(token, id);
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
      render: (n) => <span className="font-medium">{n.title}</span>,
    },
    { key: 'content', header: '内容', className: 'max-w-xs truncate', render: (n) => n.content },
    {
      key: 'created',
      header: '时间',
      render: (n) => <span className="text-outline text-body-s">{n.created_at}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (n) => (
        <button
          onClick={() => handleDelete(n.id)}
          className="touch-target state-layer rounded-full p-1.5 text-error"
          title="删除"
          aria-label={`删除通知「${n.title}」`}
        >
          {' '}
          <MdDelete size={16} />{' '}
        </button>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      {' '}
      <SectionHeader
        icon={<MdNotifications className="text-primary" size={24} />}
        title="系统通知发送"
        onRefresh={loadNotifications}
      />{' '}
      <Card variant="outlined" className="space-y-4">
        {' '}
        <div className="text-body-s text-on-surface-variant bg-surface-container-low p-3 rounded border-l-on-accent-blue border-l-4">
          {' '}
          使用系统通知可以向特定用户或全站用户发送消息（信箱红点提醒）。用户ID填 0
          代表全站广播。{' '}
        </div>{' '}
        <div>
          {' '}
          <Input
            label="接收用户 ID（0=全站广播）"
            id="notificationstab-f1"
            type="number"
            min={0}
            value={targetUserId}
            onChange={(e) => setTargetUserId(parseInt(e.target.value) || 0)}
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <Input
            label="通知标题"
            id="notificationstab-f2"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：您的稿件已被审核通过"
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface mb-1" htmlFor="notificationstab-f3">
            通知正文
          </label>{' '}
          <Textarea
            id="notificationstab-f3"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="通知的详细内容..."
          />{' '}
        </div>{' '}
        <Button
          onClick={handleSend}
          variant="filled"
          loading={sending}
          className="self-start"
          icon={<MdSend size={16} />}
        >
          {sending ? '发送中...' : '发送通知'}
        </Button>
      </Card>
      <Card variant="outlined">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-label-l-emphasized text-on-surface">历史通知记录</h3>
          <Select
            value={filter}
            onChange={(v) => setFilter(v)}
            size="sm"
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
      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认删除"
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
        <p className="text-body-m text-on-surface-variant">确定要删除此通知？</p>
      </Modal>
    </div>
  );
}
