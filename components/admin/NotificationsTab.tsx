'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdNotifications, MdSend, MdDelete } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

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
    return () => { cancelled = true; };
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

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdNotifications className="text-primary" size={24} />}
        title="系统通知发送"
        onRefresh={loadNotifications}
      />

      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-3 rounded border-l-4 border-l-blue-500">
          使用系统通知可以向特定用户或全站用户发送消息（信箱红点提醒）。用户ID填 0 代表全站广播。
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">接收用户 ID（0=全站广播）</label>
          <input
            type="number"
            min={0}
            value={targetUserId}
            onChange={(e) => setTargetUserId(parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">通知标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：您的稿件已被审核通过"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">通知正文</label>
          <textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="通知的详细内容..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-y"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={sending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          <MdSend size={16} />
          {sending ? '发送中...' : '发送通知'}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">历史通知记录</h3>
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

        {loading ? (
          <Spinner />
        ) : notifications.length === 0 ? (
          <EmptyState message="暂无通知记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">ID</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">接收目标</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">标题</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">内容</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">时间</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-2">{n.id}</td>
                    <td className="py-2 px-2">{n.receiver_name || `用户#${n.user_id}`}</td>
                    <td className="py-2 px-2 font-medium">{n.title}</td>
                    <td className="py-2 px-2 max-w-xs truncate">{n.content}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{n.created_at}</td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="删除"
                      >
                        <MdDelete size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认删除"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要删除此通知？</p>
      </Modal>
    </div>
  );
}
