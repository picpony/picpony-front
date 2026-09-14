'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import Badge from '@/components/Badge';
import { MdMessage, MdSearch, MdRefresh } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import { SectionHeader } from './';
import Card from '@/components/Card';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import { readToken } from '@/lib/hooks';
import { defineResource, SKIP, useResource } from '@/lib/resource';
import type { AuditMessage } from '@/lib/types/message';
import { adminData } from './queries';

type AuditQuery = { token: string; userId?: number };

const messagesQuery = defineResource<AuditQuery, AuditMessage[]>({
  name: 'admin-message-audit',
  key: ({ token, userId }) => `${token}:${userId ?? 'all'}`,
  ttl: 60_000,
  maxEntries: 8,
  fetch: async ({ token, userId }, signal) => {
    if (readToken() !== token) throw new Error('登录状态已失效，请重新登录');
    const data = await adminApi.adminGetAllMessages(token, userId, signal);
    return adminData(data, data.messages ?? []);
  },
});

/* The message body leads the card — the only column an auditor is actually
   reading; ids and timestamps around it are context. Clamped so one long
   message cannot blow out the grid. */
const AUDIT_COLUMNS: Column<AuditMessage>[] = [
  {
    key: 'content',
    header: '私信内容',
    primary: true,
    className: 'max-w-xs truncate',
    render: (m) => m.content,
  },
  { key: 'id', header: '消息 ID', render: (m) => m.id },
  { key: 'sender', header: '发送方', render: (m) => m.sender_name },
  { key: 'receiver', header: '接收方', render: (m) => m.receiver_name },
  {
    key: 'state',
    header: '状态',
    render: (m) => (
      <Badge tone={m.is_read ? 'success' : 'warning'}>{m.is_read ? '已读' : '未读'}</Badge>
    ),
  },
  {
    key: 'created',
    header: '时间',
    render: (m) => <span className="text-on-surface-variant text-body-s">{m.created_at}</span>,
  },
];

export default function MessagesAuditTab({ token }: { token: string }) {
  const [searchUserId, setSearchUserId] = useState('');
  const [query, setQuery] = useState<AuditQuery | null>(null);
  // Opening the audit does not read private messages until the administrator asks.
  const activeQuery = query?.token === token ? query : null;
  const read = useResource(messagesQuery, activeQuery ?? SKIP);
  const loading = activeQuery !== null && read.data === undefined && !read.error;

  const loadMessages = (userId?: number) => {
    if (readToken() !== token) return;
    if (userId !== undefined && (!Number.isSafeInteger(userId) || userId < 1)) {
      showToast('请输入有效的用户 ID', 'warning');
      return;
    }
    if (activeQuery && activeQuery.userId === userId) read.refresh();
    else setQuery({ token, userId });
  };
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdMessage size={ICON.standard} />}
        title="私信安全审计查阅"
        onRefresh={() => loadMessages(activeQuery?.userId)}
        isLoading={read.isLoading}
      />
      <Card variant="transparent">
        <div className="text-body-s bg-error-container text-on-error-container mb-4 rounded-md p-3">
          警告：作为管理员，您有权审计全站私信以排查违规交易、辱骂或诈骗行为。请严格遵守用户隐私准则，切勿滥用此功能。{' '}
        </div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          
          <Input
            type="number"
            min={1}
            size="sm"
            aria-label="审计用户 ID"
            value={searchUserId}
            onChange={(e) => setSearchUserId(e.target.value)}
            placeholder="输入用户 ID 查询 TA 的私信…"
            fieldClassName="flex-1"
          />
          <div className="flex items-center gap-3">
            
            <Button
              onClick={() => loadMessages(searchUserId ? Number(searchUserId) : undefined)}
              variant="filled"
              className="flex-1 sm:flex-none"
              icon={<MdSearch />}
            >
              检索
            </Button>
            <Button
              icon={<MdRefresh />}
              variant="tonal"
              className="flex-1 sm:flex-none"
              onClick={() => {
                setSearchUserId('');
                loadMessages();
              }}
            >
              查全站
            </Button>
          </div>
        </div>
        <DataTable<AuditMessage>
          columns={AUDIT_COLUMNS}
          rows={read.data ?? []}
          rowKey={(m) => m.id}
          loading={loading}
          error={read.error instanceof Error ? read.error.message : read.error ? '私信加载失败' : undefined}
          onRetry={read.refresh}
          empty={activeQuery ? '暂无消息记录' : '请选择用户检索，或查阅全站消息'}
        />
      </Card>
    </div>
  );
}
