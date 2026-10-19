'use client';
import { useState } from 'react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import SearchInput from '@/components/SearchInput';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import * as api from '@/lib/api/adminCatalogTools';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { defineResource, useResource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { shopItems } from '@/lib/resources';
import { formatDateTime, formatExactCount, formatSignedCount } from '@/lib/format';
import type { Purchase, LegacyPurchase } from '@/lib/adminCatalogTools/model';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import RefreshButton from '../RefreshButton';
import { AdminListAnchor, AdminPager, useCursorPages, useShownListKey } from '../paging';
import { tableError } from '../queries';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

type Params = { token: string; keyword: string; legacy: boolean; before?: number };
type Row = Purchase | LegacyPurchase;
/* One cursor page per read (`before` → `next_cursor`): the backend never says how many there are. */
const query = defineResource<Params, api.PurchasePage<Row>>({ name: 'admin-catalog-purchases', key: (p) => JSON.stringify(p), ttl: 60000, maxEntries: 12, fetch: (p, signal) => {
  if (readToken() !== p.token) throw new Error('登录状态已失效');
  return p.legacy ? api.getLegacyShopPurchases(p.token, p.keyword, p.before, signal) : api.getShopPurchases(p.token, p.keyword, p.before, signal);
} });
export default function PurchasesPane({ token, legacy = false }: { token: string; legacy?: boolean }) {
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('');
  const scope = `${token}:${legacy}:${filter}`;
  const pages = useCursorPages(scope);
  const read = useResource(query, { token, keyword: filter, legacy, before: pages.cursor }, { keepPrevious: scope });
  if (read.data && !read.isPrevious && !read.error) pages.learn(pages.page, read.data.next);
  const listKey = useShownListKey(`${scope}\n${pages.page}`, read.isPrevious);
  const mutation = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const committed = () => { query.expire({ token, keyword: filter, legacy, before: pages.cursor }); shopItems.expire(); };
  const columns: Column<Row>[] = [
    { key: 'user', header: '用户', primary: true, render: (row) => `${row.username || '用户'}（#${row.user_id}）` },
    { key: 'item', header: legacy ? '原因' : '商品', render: (row) => 'reason' in row ? row.reason : `${row.item_name} × ${row.quantity}` },
    /* Exact and grouped, never 万/亿: a refund amount has to be checkable against a balance.
       A legacy row's amount is a signed ledger entry, a purchase's total is what was paid. */
    { key: 'amount', header: '金币', width: 'auto', className: 'tabular-nums', render: (row) => 'amount' in row ? formatSignedCount(row.amount) : formatExactCount(row.total_amount) },
    { key: 'time', header: '时间', render: (row) => formatDateTime(row.created_at) },
    { key: 'status', header: '状态', render: (row) => <Badge>{'status' in row ? row.status === 'completed' ? '已完成' : row.status === 'refunded' ? '已退款' : '待核对' : '旧版流水'}</Badge> },
    ...(!legacy ? [{ key: 'actions', header: '操作', actions: true, render: (row: Row) => 'status' in row && row.status === 'completed' ? <Button size="xs" variant="danger-text" disabled={mutation.busy || mutation.uncertain} onClick={() => confirmThen('确认退款', `确定要将订单 #${row.id}「${row.item_name}」的 ${row.total_amount} 金币退还给 ${row.username || '用户'}（#${row.user_id}）吗？将恢复 ${row.quantity} 件库存，此操作不可撤销。`, () => void mutation.run(() => api.refundShopPurchase(token, row.id), () => showToast(`已退还 ${row.total_amount} 金币`, 'success'), committed))}>退款</Button> : '—' }] : []),
  ];
  return <div className="space-y-4">
    {legacy && <AdminNote>旧版流水仅供人工核对，不提供自动退款。</AdminNote>}
    <AdminForm aria-label={legacy ? '查询旧版流水' : '查询消费记录'} onSubmit={() => { setFilter(keyword.trim()); if (filter === keyword.trim()) read.refresh(); }}><SearchInput value={keyword} maxLength={200} onChange={setKeyword} placeholder="用户或商品关键词…" /><FormActions><RefreshButton onClick={read.refresh} label="刷新记录" loading={read.isLoading && read.data !== undefined} /><Button type="submit" variant="tonal">查询</Button></FormActions></AdminForm>
    <MutationResult mutation={mutation} />
    <AdminListAnchor><DataTable columns={columns} rows={read.data?.rows ?? []} listKey={listKey} rowKey={(row) => row.id} loading={read.data === undefined && !read.error} {...tableError('消费记录加载失败', read.error ? apiErrorMessage(read.error) : undefined)} onRetry={read.error && isRetryable(read.error) ? read.refresh : undefined} empty={legacy ? '暂无旧版流水' : '暂无消费记录'} /><AdminPager page={pages.page} totalPages={pages.totalPages} onPageChange={pages.setPage} disabled={read.isLoading} /></AdminListAnchor>
    {confirmDialog}
  </div>;
}
