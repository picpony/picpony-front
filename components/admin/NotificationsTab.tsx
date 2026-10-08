'use client';

import { useState } from 'react';
import { MdDeleteOutline, MdSend } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import Radio from '@/components/Radio';
import SearchInput from '@/components/SearchInput';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import ToggleSwitch from '@/components/ToggleSwitch';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatDateTime } from '@/lib/format';
import { readToken } from '@/lib/hooks';
import { defineResource, SKIP, useResource } from '@/lib/resource';
import { userProfile } from '@/lib/resources';
import { apiErrorMessage, isNotFound, isRetryable } from '@/lib/api/errors';
import { pageCount } from '@/lib/api/http';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminForm, AdminNote, FormActions } from './AdminForm';
import { AdminListAnchor, AdminPager, useShownListKey } from './paging';
import { adminList, tableError } from './queries';
import { useAdminMutation } from './useAdminMutation';
import { useSettled } from './useSettled';
import type { AdminPanelProps } from './registry';

interface NotificationItem {
  id: number;
  user_id: number;
  receiver_name?: string | null;
  title: string;
  content: string;
  created_at: string;
}

interface NotificationPage {
  rows: NotificationItem[];
  totalPages: number;
  total: number;
}

type Filter = 'all' | 'broadcast' | 'personal';
type Audience = 'user' | 'all';

/** The original console's page size for this history. */
const PAGE_SIZE = 20;

/** Paged on the server, as the original console reads it (`page`, `per_page`, `keyword`). */
const notificationsQuery = defineResource<{ token: string; filter: Filter; page: number; keyword: string }, NotificationPage>({
  name: 'admin-notifications',
  key: ({ token, filter, page, keyword }) => `${token}:${filter}:${page}:${keyword}`,
  ttl: 60_000,
  maxEntries: 12,
  fetch: async ({ token, filter, page, keyword }, signal) => {
    if (readToken() !== token) throw new Error('登录状态已失效，请重新登录');
    const data = await adminApi.adminGetNotifications(token, { filter, page, perPage: PAGE_SIZE, keyword }, signal);
    const rows = adminList<NotificationItem>(data, 'notifications', '通知记录');
    return { rows, totalPages: pageCount(data.total_pages), total: Number(data.total) || rows.length };
  },
});

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部通知' },
  { value: 'broadcast', label: '全站广播' },
  { value: 'personal', label: '单独推送' },
];

/** A positive account id typed into a field, or `null`. */
function accountId(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * 通知管理: send a system notification, and read back what was sent.
 *
 * **A broadcast is never the default** (R9-011). The form used to open with 接收用户 ID 0 — a
 * notification to every account — and sent it without asking. Now it opens with no audience
 * chosen; 全站广播 is a choice of its own, and every send confirms, naming the audience (the
 * original console confirmed every send too). The recipient's name is looked up as the id is
 * typed, so the confirm can say whose inbox this is.
 */
export default function NotificationsTab({ token }: AdminPanelProps) {
  const { confirmThen, confirmDialog } = useConfirm();
  const sendMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);

  // ---- The send form ----
  const [audience, setAudience] = useState<Audience | null>(null);
  const [recipient, setRecipient] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [important, setImportant] = useState(false);
  const [errors, setErrors] = useState<{ audience?: string; recipient?: string; title?: string; content?: string }>({});
  const sending = sendMutation.busy;

  const typedId = accountId(recipient);
  const settledId = useSettled(typedId, typedId ? 400 : 0);
  const lookup = useResource(userProfile, audience === 'user' && settledId ? { id: String(settledId) } : SKIP);
  const lookupCurrent = settledId === typedId;
  const recipientName = lookupCurrent ? lookup.data?.username : undefined;
  const recipientMissing = lookupCurrent && lookup.error !== undefined && isNotFound(lookup.error);

  const recipientHelper = (() => {
    if (audience !== 'user' || !typedId) return undefined;
    if (!lookupCurrent || (lookup.data === undefined && lookup.error === undefined)) return '正在查找该用户…';
    if (recipientName) return `将发送给「${recipientName}」`;
    if (lookup.error !== undefined && !recipientMissing) return '暂时无法确认该用户，发送时由服务器校验';
    return undefined;
  })();

  const clear = (field: keyof typeof errors) => setErrors((previous) => ({ ...previous, [field]: undefined }));

  const send = () => {
    if (sendMutation.isPending()) return;
    const next: typeof errors = {};
    if (!audience) next.audience = '请选择发送对象';
    if (audience === 'user') {
      if (!typedId) next.recipient = '请输入有效的用户 ID';
      else if (recipientMissing) next.recipient = `没有 ID 为 ${typedId} 的用户`;
    }
    if (!title.trim()) next.title = '请填写通知标题';
    if (!content.trim()) next.content = '请填写通知正文';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const broadcast = audience === 'all';
    const who = broadcast
      ? '全站所有用户'
      : recipientName ? `用户「${recipientName}」（#${typedId}）` : `ID 为 ${typedId} 的用户`;
    const mail = important ? (broadcast ? '\n通知还会以邮件发给所有用户，耗时较长。' : '\n通知还会以邮件发给该用户。') : '';
    confirmThen(
      broadcast ? '确认全站广播' : '确认发送通知',
      `确定要向${who}发送此通知吗？${mail}`,
      () => void sendMutation.run(
        () => adminApi.adminSendNotification(token, {
          user_id: broadcast ? 0 : (typedId as number),
          title: title.trim(),
          content: content.trim(),
          is_important: important,
        }),
        () => {
          showToast(broadcast ? '已发送全站广播' : '已发送通知', 'success');
          setAudience(null);
          setRecipient('');
          setTitle('');
          setContent('');
          setImportant(false);
        },
        '发送失败',
        { onCommitted: () => notificationsQuery.invalidate() },
      ),
      { tone: broadcast ? 'danger' : 'filled' },
    );
  };

  // ---- The history ----
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const keyword = useSettled(search.trim(), search.trim() ? 400 : 0);
  const [page, setPage] = useState({ page: 1, scope: '' });
  const scope = `${filter}:${keyword}`;
  const currentPage = page.scope === scope ? page.page : 1;
  const history = useResource(
    notificationsQuery,
    token ? { token, filter, page: currentPage, keyword } : SKIP,
    { keepPrevious: `${token}:${scope}` },
  );
  const rows = history.data?.rows ?? [];
  const totalPages = history.data?.totalPages ?? 1;
  const listKey = useShownListKey(`${scope}
${currentPage}`, history.isPrevious);

  const remove = (item: NotificationItem) => {
    confirmThen(
      '确认删除通知',
      `确定要删除通知「${item.title}」吗？删除后接收者将无法在信箱中看到它。`,
      () => void deleteMutation.run(
        () => adminApi.adminDeleteNotification(token, item.id),
        () => showToast('已删除通知', 'success'),
        '删除失败',
        { key: item.id, onCommitted: () => notificationsQuery.invalidate() },
      ),
    );
  };

  const columns: Column<NotificationItem>[] = [
    {
      key: 'title',
      header: '标题',
      primary: true,
      render: (item) => <span className="text-body-m-emphasized text-on-surface">{item.title}</span>,
    },
    {
      key: 'content',
      header: '内容',
      width: 'minmax(0, 3fr)',
      className: 'whitespace-pre-wrap wrap-anywhere',
      render: (item) => <span className="text-on-surface-variant">{item.content}</span>,
    },
    {
      key: 'target',
      header: '接收者',
      width: 'auto',
      render: (item) =>
        Number(item.user_id) === 0 ? (
          <Badge tone="primary" size="md">全站广播</Badge>
        ) : (
          <span>
            {item.receiver_name || '用户'}
            <span className="text-on-surface-variant">（#{item.user_id}）</span>
          </span>
        ),
    },
    {
      key: 'created',
      header: '时间',
      width: 'auto',
      render: (item) => <span className="text-on-surface-variant">{formatDateTime(item.created_at)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (item) => (
        <IconButton
          size="sm"
          variant="danger-text"
          icon={<MdDeleteOutline />}
          aria-label={`删除通知「${item.title}」`}
          loading={deleteMutation.pendingKeys.has(item.id)}
          onClick={() => remove(item)}
        />
      ),
    },
  ];

  const historyError = history.error
    ? tableError(history.isPrevious ? `第 ${currentPage} 页加载失败` : '通知记录加载失败', apiErrorMessage(history.error))
    : {};

  return (
    <div className="space-y-6">
      <SectionHeader section="notifications" />
      <AdminNote>系统通知出现在接收者的信箱里，并点亮信箱的红点提醒。全站广播只会生成一条推送记录。</AdminNote>

      <AdminForm onSubmit={send} aria-labelledby="notifications-send-heading">
        <SectionHeading as="h3" id="notifications-send-heading">发送通知</SectionHeading>
        <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0" aria-describedby={errors.audience ? 'notifications-audience-error' : undefined}>
          <legend className="mb-1 text-label-l text-on-surface-variant">发送对象</legend>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Radio
              name="notification-audience"
              value="user"
              label="单个用户"
              checked={audience === 'user'}
              tone={errors.audience ? 'error' : 'neutral'}
              disabled={sending}
              onChange={() => { setAudience('user'); clear('audience'); }}
            />
            <Radio
              name="notification-audience"
              value="all"
              label="全站广播"
              checked={audience === 'all'}
              tone={errors.audience ? 'error' : 'neutral'}
              disabled={sending}
              onChange={() => { setAudience('all'); clear('audience'); clear('recipient'); }}
            />
          </div>
          {errors.audience && (
            <p id="notifications-audience-error" role="alert" className="px-4 text-body-s text-error">
              {errors.audience}
            </p>
          )}
        </fieldset>
        {audience === 'user' && (
          <Input
            label="接收用户 ID"
            inputMode="numeric"
            autoComplete="off"
            value={recipient}
            readOnly={sending}
            error={errors.recipient}
            helper={recipientHelper}
            fieldClassName="sm:w-80"
            onChange={(event) => { setRecipient(event.target.value); clear('recipient'); }}
          />
        )}
        <Input
          label="通知标题"
          value={title}
          readOnly={sending}
          error={errors.title}
          placeholder="例如：您的稿件已被审核通过"
          onChange={(event) => { setTitle(event.target.value); clear('title'); }}
        />
        <Textarea
          label="通知正文"
          rows={4}
          className="resize-none"
          value={content}
          readOnly={sending}
          error={errors.content}
          placeholder="通知的详细内容…"
          onChange={(event) => { setContent(event.target.value); clear('content'); }}
        />
        <ToggleSwitch
          layout="row"
          checked={important}
          disabled={sending}
          onChange={setImportant}
          label="同时发送邮件"
          description="通知内容还会以邮件发给接收者；全站广播会给所有用户发邮件，耗时较长。"
        />
        <FormActions>
          <Button type="submit" variant="filled" icon={<MdSend />} loading={sending}>
            发送通知
          </Button>
        </FormActions>
      </AdminForm>

      <section aria-labelledby="admin-sent-notifications-heading" className="space-y-4">
        <SectionHeading
          as="h3"
          actions={
            <Select
              size="sm"
              value={filter}
              options={FILTERS}
              aria-label="通知类型"
              onChange={(value) => setFilter(value)}
            />
          }
        >
          <span id="admin-sent-notifications-heading">已发送的通知</span>
        </SectionHeading>
        <SearchInput value={search} onChange={setSearch} placeholder="搜索标题、正文或接收者…" />
        <AdminListAnchor>
          <DataTable<NotificationItem>
            columns={columns}
            rows={rows}
            listKey={listKey}
            rowKey={(item) => item.id}
            loading={history.data === undefined && !history.error}
            skeletonRows={6}
            {...historyError}
            onRetry={history.error && isRetryable(history.error) ? history.refresh : undefined}
            empty={keyword ? '没有匹配的通知' : '暂无通知记录'}
          />
          <AdminPager
            page={currentPage}
            totalPages={totalPages}
            onPageChange={(next) => setPage({ page: next, scope })}
            summary={history.data ? `共 ${history.data.total} 条` : undefined}
          />
        </AdminListAnchor>
      </section>
      {confirmDialog}
    </div>
  );
}
