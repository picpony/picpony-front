'use client';

import { useState, useMemo, useRef } from 'react';
import { showToast } from '@/components/Toast';
import { MdReport, MdOpenInNew } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import Badge from '@/components/Badge';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { ICON } from '@/lib/icons';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { readToken } from '@/lib/hooks';

interface Report {
  id: number;
  image_id: number;
  username: string;
  reason: string;
  status: 'pending' | 'processed' | 'rejected';
  created_at: string;
}

/** Label + chip tone per status, so the three branches aren't spelled out in JSX. */
const STATUS: Record<Report['status'], { label: string; tone: 'warning' | 'success' | 'neutral' }> =
  {
    pending: { label: '待处理', tone: 'warning' },
    processed: { label: '已处理', tone: 'success' },
    rejected: { label: '已驳回', tone: 'neutral' },
  };

const emptyReports: Report[] = [];
const reportsQuery = defineAdminQuery<Report[]>('reports', async (token, signal) => {
  const data = await adminApi.adminGetReports(token, signal);
  return adminData(data, data.reports || []);
});

export default function ReportsTab({ token }: { token: string }) {
  const read = useAdminQuery(reportsQuery, token);
  const reports = read.data ?? emptyReports;
  const isLoading = read.loading;
  const loadReports = read.refresh;
  const [searchKw, setSearchKw] = useState('');
  const pendingRef = useRef(new Set<number>());
  const [pendingIds, setPendingIds] = useState(new Set<number>());

  const filteredReports = useMemo(() => {
    if (!searchKw) return reports;
    const kw = searchKw.toLowerCase();
    return reports.filter(
      (r) =>
        String(r.id) === kw || String(r.image_id) === kw || r.username?.toLowerCase().includes(kw),
    );
  }, [searchKw, reports]);

  const handleReport = async (id: number, status: string) => {
    if (pendingRef.current.has(id) || readToken() !== token) return;
    pendingRef.current.add(id);
    setPendingIds(new Set(pendingRef.current));
    try {
      const res = await adminApi.adminHandleReport(token, id, status);
      const data = await res.json();
      if (readToken() !== token) return;
      if (data.success) {
        reportsQuery.write(token, (previous) => previous?.map((report) =>
          report.id === id ? { ...report, status: status as Report['status'] } : report) ?? []);
        showToast('处理成功', 'success');
        loadReports();
      } else {
        showToast(data.error || '处理失败', 'error');
      }
    } catch {
      if (readToken() === token) showToast('处理失败', 'error');
    } finally {
      pendingRef.current.delete(id);
      setPendingIds(new Set(pendingRef.current));
    }
  };

  const reportColumns: Column<Report>[] = [
    { key: 'id', header: '单号', render: (r) => `#${r.id}` },
    {
      key: 'image',
      header: '图片',
      render: (r) => (
        <a
          href={`/pic/${r.image_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="prose-link inline-flex items-center gap-1 focus-visible:ring-2 focus-ring"
        >
          #{r.image_id} <MdOpenInNew size={ICON.dense} />
        </a>
      ),
    },
    { key: 'user', header: '举报人', primary: true, render: (r) => r.username },
    {
      key: 'reason',
      header: '原因',
      className: 'max-w-xs truncate',
      render: (r) => <span title={r.reason}>{r.reason}</span>,
    },
    {
      key: 'status',
      header: '状态',
      render: (r) => (
        /* A `Badge`, not a `Chip`: no click handler and no dismiss cross, so it
           is a mark — and a chip's taller box made these rows taller than every
           sibling tab's. */
        <Badge tone={STATUS[r.status]?.tone ?? 'neutral'} size="md">
          {STATUS[r.status]?.label ?? '未知状态'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (r) =>
        r.status === 'pending' ? (
          <>
            <Button variant="success" size="xs" disabled={pendingIds.has(r.id)} onClick={() => handleReport(r.id, 'processed')} data-ripple>
              完结
            </Button>
            <Button variant="tonal" size="xs" disabled={pendingIds.has(r.id)} onClick={() => handleReport(r.id, 'rejected')} data-ripple>
              驳回
            </Button>
          </>
        ) : (
          <span className="text-on-surface-variant text-body-m">已归档</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdReport size={ICON.standard} />}
        title="违规举报处理"
        onRefresh={loadReports}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索举报 ID、图片 ID或举报人…"
      />

      <DataTable<Report>
        columns={reportColumns}
        rows={filteredReports}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={read.error}
        onRetry={loadReports}
        empty="暂无举报记录"
      />
    </div>
  );
}
