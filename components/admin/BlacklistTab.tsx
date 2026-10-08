'use client';

import { useMemo, useState } from 'react';
import { MdBlock, MdOpenInNew } from 'react-icons/md';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import { Input } from '@/components/Input';
import SearchInput from '@/components/SearchInput';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatDateTime } from '@/lib/format';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminForm } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { adminList, defineAdminQuery, tableError, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';

interface BlacklistItem {
  image_id: number;
  reason: string;
  created_at: string;
}

const EMPTY: BlacklistItem[] = [];
const blacklistQuery = defineAdminQuery<BlacklistItem[]>('blacklist', async (token, signal) => {
  const data = await adminApi.adminGetBlacklist(token, signal);
  return adminList<BlacklistItem>(data, 'blacklist', '屏蔽库');
});

/**
 * 图片屏蔽库 — pictures hidden from every feed, search and profile on the site.
 *
 * The add form starts at the panel's edge like everything else (R9-025: a padded wrapper with no
 * surface inset it 16px), its button is the fields' 56dp and shares their top edge, and an id
 * that is not one is said on its own field. Adding hides a picture from every visitor, so it
 * asks first.
 */
export default function BlacklistTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(blacklistQuery, token);
  const items = read.data ?? EMPTY;
  const addMutation = useAdminMutation(token);
  const removeMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [imageId, setImageId] = useState('');
  const [reason, setReason] = useState('');
  const [idError, setIdError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => String(item.image_id) === keyword || item.reason?.toLowerCase().includes(keyword));
  }, [search, items]);
  const paged = usePagedRows(filtered, search.trim());

  const add = () => {
    if (addMutation.isPending()) return;
    const text = imageId.trim();
    const id = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < 1) {
      setIdError('请输入有效的图片 ID');
      return;
    }
    if (items.some((item) => item.image_id === id)) {
      setIdError(`图片 #${id} 已在屏蔽库中`);
      return;
    }
    confirmThen(
      '确认屏蔽图片',
      `确定要屏蔽图片 #${id} 吗？屏蔽后全站的图库、搜索和个人主页都不会再显示这张图片。`,
      () =>
        void addMutation.run(
          () => adminApi.adminAddBlacklist(token, id, reason.trim()),
          () => {
            showToast(`已屏蔽图片 #${id}`, 'success');
            setImageId('');
            setReason('');
          },
          '屏蔽失败',
          { onCommitted: read.refresh },
        ),
    );
  };

  const remove = (id: number) =>
    confirmThen('确认解除屏蔽', `确定要解除对图片 #${id} 的屏蔽吗？`, () =>
      void removeMutation.run(
        () => adminApi.adminRemoveBlacklist(token, id),
        () => showToast(`已解除对图片 #${id} 的屏蔽`, 'success'),
        '解除失败',
        {
          key: id,
          onCommitted: () => {
            blacklistQuery.write(token, (previous) => previous?.filter((item) => item.image_id !== id) ?? []);
            read.refresh();
          },
        },
      ),
      { tone: 'filled' });

  const columns: Column<BlacklistItem>[] = [
    {
      key: 'image',
      header: '图片',
      primary: true,
      render: (item) => (
        <a
          href={`/pic/${item.image_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="prose-link inline-flex items-center gap-1 focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
        >
          {`#${item.image_id}`}
          <MdOpenInNew size={ICON.dense} aria-hidden="true" />
        </a>
      ),
    },
    {
      key: 'reason',
      header: '屏蔽原因',
      width: 'minmax(0, 2fr)',
      className: 'whitespace-pre-wrap wrap-anywhere',
      render: (item) => <span className="text-on-surface-variant">{item.reason || '未填写'}</span>,
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
        <Button
          type="button"
          variant="text"
          size="xs"
          loading={removeMutation.pendingKeys.has(item.image_id)}
          onClick={() => remove(item.image_id)}
        >
          解除屏蔽
        </Button>
      ),
    },
  ];

  const keyword = search.trim();
  return (
    <div className="space-y-6">
      <SectionHeader section="blacklist" onRefresh={read.refresh} isLoading={read.refreshing} />
      <AdminForm onSubmit={add} aria-label="屏蔽图片">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Input
            label="图片 ID"
            inputMode="numeric"
            autoComplete="off"
            placeholder="例如：3123456"
            value={imageId}
            readOnly={addMutation.busy}
            error={idError ?? undefined}
            fieldClassName="sm:w-48"
            onChange={(event) => {
              setImageId(event.target.value);
              setIdError(null);
            }}
          />
          <Input
            label="屏蔽原因"
            autoComplete="off"
            placeholder="例如：严重违规"
            helper="仅后台可见"
            value={reason}
            readOnly={addMutation.busy}
            fieldClassName="min-w-0 sm:flex-1"
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" size="lg" variant="danger" icon={<MdBlock />} loading={addMutation.busy}>
            屏蔽图片
          </Button>
        </div>
      </AdminForm>
      <SearchInput value={search} onChange={setSearch} placeholder="搜索图片 ID 或屏蔽原因…" />
      <AdminListAnchor>
        <DataTable<BlacklistItem>
          columns={columns}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(item) => item.image_id}
          loading={read.loading}
          skeletonRows={6}
          {...tableError('屏蔽库加载失败', read.error)}
          onRetry={read.retryable ? read.refresh : undefined}
          empty={keyword ? '没有匹配的屏蔽记录' : '屏蔽库是空的'}
        />
        <AdminPager
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          summary={read.data ? (keyword ? `找到 ${paged.total} 条` : `共 ${paged.total} 条`) : undefined}
        />
      </AdminListAnchor>
      {confirmDialog}
    </div>
  );
}
