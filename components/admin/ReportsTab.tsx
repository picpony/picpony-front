'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import { MdReport, MdOpenInNew } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import Chip from '@/components/Chip';
import { SectionHeader, SearchInput } from './';

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

export default function ReportsTab({ token }: { token: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetReports(token);
      if (data.success) {
        setReports(data.reports || []);
      }
    } catch {
      showToast('加载举报失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .adminGetReports(token)
      .then((data) => {
        if (data.success) {
          setReports(data.reports || []);
        }
      })
      .catch(() => showToast('加载举报失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const filteredReports = useMemo(() => {
    if (!searchKw) return reports;
    const kw = searchKw.toLowerCase();
    return reports.filter(
      (r) =>
        String(r.id) === kw || String(r.image_id) === kw || r.username?.toLowerCase().includes(kw),
    );
  }, [searchKw, reports]);

  const handleReport = async (id: number, status: string) => {
    try {
      const res = await api.adminHandleReport(token, id, status);
      const data = await res.json();
      if (data.success) {
        showToast('处理成功', 'success');
        loadReports();
      } else {
        showToast(data.error || '处理失败', 'error');
      }
    } catch {
      showToast('处理失败', 'error');
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
          className="text-link inline-flex items-center gap-1 hover:underline"
        >
          #{r.image_id} <MdOpenInNew size={14} />
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
        <Chip variant="input" tone={STATUS[r.status].tone}>
          {STATUS[r.status].label}
        </Chip>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (r) =>
        r.status === 'pending' ? (
          <>
            <button
              onClick={() => handleReport(r.id, 'processed')}
              data-ripple
              className="bg-success-fill text-on-fill rounded px-3 py-1 text-label-m transition-ui hover:bg-success-fill/90"
            >
              {' '}
              完结{' '}
            </button>{' '}
            <button
              onClick={() => handleReport(r.id, 'rejected')}
              data-ripple
              className="bg-secondary-container text-on-secondary-container rounded px-3 py-1 text-label-m transition-ui hover:bg-secondary-container/80"
            >
              驳回
            </button>
          </>
        ) : (
          <span className="text-outline text-body-m">已归档</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdReport className="text-primary" size={24} />}
        title="违规举报处理"
        onRefresh={loadReports}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索举报ID、图片ID或举报人..."
      />

      <DataTable<Report>
        columns={reportColumns}
        rows={filteredReports}
        rowKey={(r) => r.id}
        loading={isLoading}
        empty="暂无举报记录"
      />
    </div>
  );
}
