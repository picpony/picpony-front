'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import { MdReport, MdOpenInNew } from 'react-icons/md';
import { SectionHeader, SearchInput, EmptyState, Spinner } from './';

interface Report {
  id: number;
  image_id: number;
  username: string;
  reason: string;
  status: 'pending' | 'processed' | 'rejected';
  created_at: string;
}

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
    api.adminGetReports(token)
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
    return reports.filter(r =>
      String(r.id) === kw ||
      String(r.image_id) === kw ||
      r.username?.toLowerCase().includes(kw)
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

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">单号</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">图片</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">举报人</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">原因</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : filteredReports.length === 0 ? (
              <EmptyState colSpan={6} message="暂无举报记录" />
            ) : (
              filteredReports.map((report) => (
                <tr key={report.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{report.id}</td>
                  <td className="px-4 py-3">
                    <a 
                      href={`/pic/${report.image_id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm flex items-center gap-1"
                    >
                      #{report.image_id} <MdOpenInNew size={14} />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm">{report.username}</td>
                  <td className="px-4 py-3 text-sm max-w-xs truncate" title={report.reason}>{report.reason}</td>
                  <td className="px-4 py-3">
                    {report.status === 'pending' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        待处理
                      </span>
                    ) : report.status === 'processed' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        已处理
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        已驳回
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {report.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReport(report.id, 'processed')}
                          className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors"
                        >
                          完结
                        </button>
                        <button
                          onClick={() => handleReport(report.id, 'rejected')}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-400 hover:bg-slate-500 rounded transition-colors"
                        >
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">已归档</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
