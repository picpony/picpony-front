'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import { MdMessage, MdSearch, MdRefresh } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

interface AuditMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  receiver_name: string;
  content: string;
  is_read: number;
  created_at: string;
}

export default function MessagesAuditTab({ token }: { token: string }) {
  const [messages, setMessages] = useState<AuditMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchUserId, setSearchUserId] = useState('');

  const loadMessages = async (userId?: number) => {
    setLoading(true);
    try {
      const res = await api.adminGetAllMessages(token, userId);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
      } else {
        showToast(data.error || '获取失败', 'error');
      }
    } catch {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdMessage className="text-primary" size={24} />}
        title="私信安全审计查阅"
        onRefresh={() => loadMessages()}
      />

      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
        <div className="text-xs text-red-500 mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded border-l-4 border-l-red-500">
          警告：作为管理员，您有权审计全站私信以排查违规交易、辱骂或诈骗行为。请严格遵守用户隐私准则，切勿滥用此功能。
        </div>

        <div className="flex items-center gap-3 mb-4">
          <input
            type="number"
            min={1}
            value={searchUserId}
            onChange={(e) => setSearchUserId(e.target.value)}
            placeholder="输入用户 ID 查询 TA 的私信..."
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
          <button
            onClick={() => loadMessages(searchUserId ? parseInt(searchUserId) : undefined)}
            className="flex items-center gap-1 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            <MdSearch size={16} /> 检索
          </button>
          <button
            onClick={() => { setSearchUserId(''); loadMessages(); }}
            className="flex items-center gap-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <MdRefresh size={16} /> 查全站
          </button>
        </div>

        {loading ? (
          <Spinner />
        ) : messages.length === 0 ? (
          <EmptyState message="暂无消息记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">消息ID</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">发送方</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">接收方</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">私信内容</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">状态</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-2">{m.id}</td>
                    <td className="py-2 px-2">{m.sender_name}</td>
                    <td className="py-2 px-2">{m.receiver_name}</td>
                    <td className="py-2 px-2 max-w-xs truncate">{m.content}</td>
                    <td className="py-2 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${m.is_read ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {m.is_read ? '已读' : '未读'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs text-slate-400">{m.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
