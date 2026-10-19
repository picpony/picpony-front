'use client';

import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import Skeleton from '@/components/Skeleton';
import { formatCount, formatDate } from '@/lib/format';
import SectionHeader from '../SectionHeader';
import { AdminNote } from '../AdminForm';
import { useAdminQuery, tableError } from '../queries';
import type { AdminPanelProps } from '../registry';
import { protectedPanel } from './common';
import { statisticsQuery } from './queries';

/**
 * 访问统计: per Beijing day, new accounts (`GET /admin/metrics/registrations`) beside distinct
 * visitors and page hits (`GET /admin/metrics/visitors`), newest first; and who was seen in the
 * last 30 minutes, accounts and anonymous visitors counted apart.
 */
function StatisticsTab({ token }: AdminPanelProps) {
  const stats = useAdminQuery(statisticsQuery, token);
  const data = stats.data;
  const tile = (label: string, value: number | undefined) => <Card variant="filled" padding="sm">
    <dt className="text-body-s text-on-surface-variant">{label}</dt>
    <dd className="text-title-l tabular-nums">{value !== undefined ? formatCount(value) : stats.error ? '—' : <Skeleton className="h-8 w-20" />}</dd>
  </Card>;
  const optional = (value: number | null) => (value === null ? '—' : formatCount(value));
  return <div className="space-y-6">
    <SectionHeader section="statistics" onRefresh={stats.refresh} isLoading={stats.refreshing} />
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tile('今日新用户', data?.todayNewUsers)}
      {tile('今日访客', data?.todayVisitors)}
      {tile('在线用户', data?.onlineUsers)}
      {tile('在线访客', data?.onlineVisitors)}
    </dl>
    <AdminNote>在线人数为最近 30 分钟内活跃的账号与访客；访客按浏览器去重，按北京时间计日。</AdminNote>
    <DataTable rows={data?.days ?? []} rowKey={(r) => r.date} columns={[
      { key: 'date', header: '日期', primary: true, render: (r) => formatDate(r.date) },
      { key: 'count', header: '新用户', render: (r) => formatCount(r.newUsers) },
      { key: 'visitors', header: '访客', render: (r) => optional(r.visitors) },
      { key: 'hits', header: '访问次数', render: (r) => optional(r.hits) },
    ]} loading={stats.loading} {...tableError('访问统计加载失败', stats.error)} onRetry={stats.retryable ? stats.refresh : undefined} empty="最近 30 天暂无统计记录" />
  </div>;
}
export default protectedPanel(StatisticsTab);
