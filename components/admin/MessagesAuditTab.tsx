'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import { MdMessage, MdSearch, MdRefresh } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader } from './';
import Card from '@/components/Card';
import Button from '@/components/Button';
import { Input } from '@/components/Input';

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

/* The message body leads the phone card — it is the only column an auditor is
   actually reading; the ids and timestamps around it are context. On desktop it
   stays an ordinary cell, clamped so one long message can't blow out the grid. */
const AUDIT_COLUMNS: Column<AuditMessage>[] = [
  {
    key: 'content',
    header: '私信内容',
    primary: true,
    className: 'max-w-xs truncate',
    render: (m) => m.content,
  },
  { key: 'id', header: '消息ID', render: (m) => m.id },
  { key: 'sender', header: '发送方', render: (m) => m.sender_name },
  { key: 'receiver', header: '接收方', render: (m) => m.receiver_name },
  {
    key: 'state',
    header: '状态',
    render: (m) => (
      <span
        className={`rounded-full px-2 py-0.5 text-body-s ${
          m.is_read ? 'bg-success-container text-success' : 'bg-warning-container text-warning'
        }`}
      >
        {m.is_read ? '已读' : '未读'}
      </span>
    ),
  },
  {
    key: 'created',
    header: '时间',
    render: (m) => <span className="text-outline text-body-s">{m.created_at}</span>,
  },
];

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
      {' '}
      <SectionHeader
        icon={<MdMessage className="text-primary" size={24} />}
        title="私信安全审计查阅"
        onRefresh={() => loadMessages()}
      />{' '}
      <Card variant="transparent">
        {' '}
        <div className="text-body-s text-error mb-4 p-3 rounded">
          {' '}
          警告：作为管理员，您有权审计全站私信以排查违规交易、辱骂或诈骗行为。请严格遵守用户隐私准则，切勿滥用此功能。{' '}
        </div>{' '}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {' '}
          <Input
            type="number"
            min={1}
            value={searchUserId}
            onChange={(e) => setSearchUserId(e.target.value)}
            placeholder="输入用户 ID 查询 TA 的私信..."
            fieldClassName="flex-1"
          />{' '}
          <div className="flex items-center gap-3">
            {' '}
            <Button
              onClick={() => loadMessages(searchUserId ? parseInt(searchUserId) : undefined)}
              variant="filled"
              className="flex-1 sm:flex-none"
              icon={<MdSearch size={16} />}
            >
              检索
            </Button>
            <button
              onClick={() => {
                setSearchUserId('');
                loadMessages();
              }}
              className="flex flex-1 items-center justify-center gap-1 px-3 py-2 border border-outline rounded-full text-body-m text-on-surface-variant hover:bg-surface-container-high sm:flex-none"
            >
              <MdRefresh size={16} /> 查全站
            </button>
          </div>
        </div>
        <DataTable<AuditMessage>
          columns={AUDIT_COLUMNS}
          rows={messages}
          rowKey={(m) => m.id}
          loading={loading}
          empty="暂无消息记录"
        />
      </Card>
    </div>
  );
}
