'use client';

import { useMemo, useState } from 'react';
import { MdOpenInNew } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import DataTable, { type Column } from '@/components/DataTable';
import FadeInImage from '@/components/FadeInImage';
import SearchInput from '@/components/SearchInput';
import { showToast } from '@/components/Toast';
import { formatDateTime } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { defineResource, SKIP, useResource } from '@/lib/resource';
import type { PonyImage } from '@/lib/types/image';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { tableError, useAdminQuery } from './queries';
import { reportsQuery, type Report, type ReportStatus } from './sharedQueries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';


const STATUS: Record<ReportStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: '待处理', tone: 'warning' },
  processed: { label: '已处理', tone: 'success' },
  rejected: { label: '已驳回', tone: 'neutral' },
};
const FILTERS: (ReportStatus | 'all')[] = ['pending', 'processed', 'rejected', 'all'];

const EMPTY: Report[] = [];

/* The pictures a page of reports names — one Derpibooru search for the page (R9-024). */
const reportedImages = defineResource<{ ids: string }, Map<number, PonyImage>>({
  name: 'admin-reported-images',
  lane: 'derpi',
  key: ({ ids }) => ids,
  ttl: 5 * 60_000,
  maxEntries: 6,
  fetch: ({ ids }, signal) => adminApi.adminReportedImages(ids.split(',').map(Number), signal),
});

/**
 * 举报处理 — the moderation queue. It opens on 待处理, and 全部 lists pending reports first; each
 * row shows the reported picture at 48dp, so a moderator can see what was reported without
 * leaving the page; 驳回 says 已驳回 (it used to announce 已处理 for both outcomes). The two actions
 * are the verbs of the two outcomes their badge and toast name — 处理 → 已处理, 驳回 → 已驳回 (G4-012:
 * the first button said 完结 beside a badge and a toast saying 已处理).
 */
export default function ReportsTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(reportsQuery, token);
  const reports = read.data ?? EMPTY;
  const mutation = useAdminMutation(token);
  const [filter, setFilter] = useState<ReportStatus | 'all'>('pending');
  const [search, setSearch] = useState('');
  /* Which action is running on a row, so only the pressed button spins. */
  const [running, setRunning] = useState<Record<number, ReportStatus>>({});

  const counts = useMemo(() => {
    const tally: Record<ReportStatus, number> = { pending: 0, processed: 0, rejected: 0 };
    for (const report of reports) if (report.status in tally) tally[report.status] += 1;
    return tally;
  }, [reports]);

  const shown = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = reports.filter((report) =>
      (filter === 'all' || report.status === filter || running[report.id] !== undefined) &&
      (!keyword ||
        String(report.id) === keyword ||
        String(report.image_id) === keyword ||
        report.username?.toLowerCase().includes(keyword)));
    /* Pending first, then the order the backend gave. */
    return filter === 'all'
      ? rows.map((report, index) => ({ report, index }))
        .sort((a, b) => Number(b.report.status === 'pending') - Number(a.report.status === 'pending') || a.index - b.index)
        .map(({ report }) => report)
      : rows;
  }, [reports, filter, search, running]);
  const paged = usePagedRows(shown, `${filter}\n${search.trim()}`);

  const ids = paged.rows.map((report) => report.image_id).filter((id) => Number.isSafeInteger(id) && id > 0);
  const images = useResource(reportedImages, ids.length ? { ids: [...new Set(ids)].sort((a, b) => a - b).join(',') } : SKIP);

  // A row a filter hides keeps its lock and its committed write with this tab.
  const handle = (report: Report, status: Exclude<ReportStatus, 'pending'>) => {
    if (mutation.isPending(report.id)) return Promise.resolve();
    setRunning((current) => ({ ...current, [report.id]: status }));
    return mutation
      .run(
        () => adminApi.adminHandleReport(token, report.id, status),
        () => showToast(status === 'processed' ? `已处理举报 #${report.id}` : `已驳回举报 #${report.id}`, 'success'),
        '处理失败',
        {
          key: report.id,
          onCommitted: () => {
            reportsQuery.write(token, (previous) => previous?.map((row) => (row.id === report.id ? { ...row, status } : row)) ?? []);
            read.refresh();
          },
        },
      )
      .finally(() =>
        setRunning((current) => {
          const next = { ...current };
          delete next[report.id];
          return next;
        }));
  };

  const columns: Column<Report>[] = [
    {
      key: 'image',
      header: '图片',
      width: 'auto',
      render: (report) => {
        const image = images.data?.get(report.image_id);
        return (
          <a
            href={`/pic/${report.image_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="prose-link inline-flex items-center gap-2 focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
          >
            <span className="relative block size-12 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
              {image && <FadeInImage src={image.representations.thumb_small} alt="" fill sizes="48px" className="object-cover" />}
            </span>
            {`#${report.image_id}`}
            <MdOpenInNew size={ICON.dense} aria-hidden="true" />
          </a>
        );
      },
    },
    {
      key: 'reason',
      header: '原因',
      primary: true,
      width: 'minmax(0, 2fr)',
      className: 'whitespace-pre-wrap wrap-anywhere',
      render: (report) => <span className="text-on-surface">{report.reason}</span>,
    },
    {
      key: 'reporter',
      header: '举报人',
      render: (report) => (
        <span>
          {report.username || '游客'}
          <span className="block text-body-s text-on-surface-variant">{`#${report.id} · ${formatDateTime(report.created_at)}`}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: 'auto',
      render: (report) => (
        <Badge tone={STATUS[report.status]?.tone ?? 'neutral'} size="md">
          {STATUS[report.status]?.label ?? '未知状态'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (report) => {
        if (report.status !== 'pending') return <span className="text-on-surface-variant">已归档</span>;
        const busy = mutation.pendingKeys.has(report.id);
        return (
          <>
            <Button
              type="button"
              variant="tonal"
              size="xs"
              loading={running[report.id] === 'processed'}
              disabled={busy && running[report.id] !== 'processed'}
              onClick={() => handle(report, 'processed')}
            >
              处理
            </Button>
            <Button
              type="button"
              variant="text"
              size="xs"
              loading={running[report.id] === 'rejected'}
              disabled={busy && running[report.id] !== 'rejected'}
              onClick={() => handle(report, 'rejected')}
            >
              驳回
            </Button>
          </>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader section="reports" onRefresh={read.refresh} isLoading={read.refreshing} />
      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="搜索举报单号、图片 ID 或举报人…" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="按处理状态筛选">
          {FILTERS.map((value) => (
            <Chip key={value} variant="filter" selected={filter === value} onClick={() => setFilter(value)}>
              {value === 'all' ? `全部（${reports.length}）` : `${STATUS[value].label}（${counts[value]}）`}
            </Chip>
          ))}
        </div>
      </div>
      <AdminListAnchor>
        <DataTable<Report>
          columns={columns}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(report) => report.id}
          loading={read.loading}
          skeletonRows={6}
          {...tableError('举报加载失败', read.error)}
          onRetry={read.retryable ? read.refresh : undefined}
          empty={search.trim() ? '没有匹配的举报' : filter === 'pending' ? '没有待处理的举报' : '暂无举报'}
        />
        <AdminPager page={paged.page} totalPages={paged.totalPages} onPageChange={paged.setPage} />
      </AdminListAnchor>
    </div>
  );
}
