'use client';

import { useState } from 'react';
import { MdPublic, MdSearch } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import { Input } from '@/components/Input';
import { formatDateTime } from '@/lib/format';
import { readToken } from '@/lib/hooks';
import { defineResource, SKIP, useResource } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { AuditMessage } from '@/lib/types/message';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminNote } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { adminList, tableError } from './queries';
import type { AdminPanelProps } from './registry';
import { flag } from '@/lib/flag';

type AuditQuery = { token: string; userId?: number };

const messagesQuery = defineResource<AuditQuery, AuditMessage[]>({
  name: 'admin-message-audit',
  key: ({ token, userId }) => `${token}:${userId ?? 'all'}`,
  ttl: 60_000,
  maxEntries: 8,
  fetch: async ({ token, userId }, signal) => {
    if (readToken() !== token) throw new Error('登录状态已失效，请重新登录');
    const data = await adminApi.adminGetAllMessages(token, userId, signal);
    return adminList(data as unknown as Record<string, unknown>, 'messages', '私信记录');
  },
});

const person = (name: string | undefined, id: number | undefined) => (
  <span>
    {name || '用户'}
    {id ? <span className="text-on-surface-variant">{`（#${id}）`}</span> : null}
  </span>
);

/* The message leads the row — the one column an auditor reads — and wraps rather than being cut
   to one line; who sent it to whom and when are its context. */
const COLUMNS: Column<AuditMessage>[] = [
  {
    key: 'content',
    header: '私信内容',
    primary: true,
    width: 'minmax(0, 3fr)',
    className: 'whitespace-pre-wrap wrap-anywhere',
    render: (message) => <span className="text-on-surface">{message.content}</span>,
  },
  { key: 'sender', header: '发送方', render: (message) => person(message.sender_name, message.sender_id) },
  { key: 'receiver', header: '接收方', render: (message) => person(message.receiver_name, message.receiver_id) },
  {
    key: 'state',
    header: '状态',
    width: 'auto',
    render: (message) => (
      <Badge tone={flag(message.is_read) ? 'neutral' : 'primary'} size="md">{flag(message.is_read) ? '已读' : '未读'}</Badge>
    ),
  },
  {
    key: 'created',
    header: '时间',
    width: 'auto',
    render: (message) => <span className="text-on-surface-variant">{formatDateTime(message.created_at)}</span>,
  },
];

/**
 * 私信审计. Nothing is read until the administrator asks: a user's messages by id (Enter or
 * 检索), or the whole site's with its own button. The header's refresh exists only once there is
 * a query to repeat — before one, it was itself a site-wide read nobody had asked for (R9-013).
 */
export default function MessagesAuditTab({ token }: AdminPanelProps) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [query, setQuery] = useState<AuditQuery | null>(null);
  const activeQuery = query?.token === token ? query : null;
  const read = useResource(messagesQuery, activeQuery ?? SKIP);
  const rows = read.data ?? [];
  const paged = usePagedRows(rows, activeQuery ? `${activeQuery.userId ?? 'all'}` : '');

  const ask = (userId?: number) => {
    if (readToken() !== token) return;
    if (activeQuery && activeQuery.userId === userId) read.refresh();
    else setQuery({ token, userId });
  };

  const search = () => {
    const text = draft.trim();
    const id = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < 1) {
      setDraftError('请输入有效的用户 ID');
      return;
    }
    ask(id);
  };

  const scope = activeQuery ? (activeQuery.userId ? `用户 #${activeQuery.userId} 收发的私信` : '全站私信') : null;

  return (
    <div className="space-y-6">
      <SectionHeader section="messages"
        onRefresh={activeQuery ? read.refresh : undefined}
        isLoading={read.isLoading && read.data !== undefined}
      />
      <AdminNote tone="warning">
        管理员可以查阅私信，用于排查违规交易、辱骂或诈骗。请严格遵守用户隐私准则，只在必要时查阅，切勿滥用。
      </AdminNote>
      <form
        role="search"
        aria-label="检索私信"
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <Input
          size="sm"
          inputMode="numeric"
          autoComplete="off"
          aria-label="审计用户 ID"
          placeholder="输入用户 ID，查看 TA 收发的私信"
          value={draft}
          error={draftError ?? undefined}
          fieldClassName="min-w-0 sm:flex-1"
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
        />
        <div className="flex gap-3">
          <Button type="submit" variant="filled" icon={<MdSearch />}>
            检索
          </Button>
          <Button
            type="button"
            variant="tonal"
            icon={<MdPublic />}
            onClick={() => {
              setDraft('');
              setDraftError(null);
              ask();
            }}
          >
            查看全站私信
          </Button>
        </div>
      </form>
      <AdminListAnchor>
        {scope && read.data !== undefined && (
          <p className="text-body-m text-on-surface-variant">{`${scope}：共 ${rows.length} 条`}</p>
        )}
        <DataTable<AuditMessage>
          columns={COLUMNS}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(message) => message.id}
          loading={activeQuery !== null && read.data === undefined && !read.error}
          skeletonRows={6}
          {...tableError('私信记录加载失败', read.error ? apiErrorMessage(read.error) : undefined)}
          onRetry={read.error && isRetryable(read.error) ? read.refresh : undefined}
          empty={activeQuery ? '没有找到相关的私信记录' : '输入用户 ID 检索，或查看全站私信'}
        />
        <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
      </AdminListAnchor>
    </div>
  );
}
