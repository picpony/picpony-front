'use client';

import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import Skeleton from '@/components/Skeleton';
import { formatCount, formatDate } from '@/lib/format';
import SectionHeader from '../SectionHeader';
import { useAdminQuery, useAdminSelect, tableError } from '../queries';
import type { AdminPanelProps } from '../registry';
import { usersQuery } from '../sharedQueries';
import { ReadState, protectedPanel } from './common';
import { dailyQuery, selectVisitorStats } from './queries';

function StatisticsTab({ token }: AdminPanelProps) {
  const daily = useAdminQuery(dailyQuery, token), visitors = useAdminSelect(usersQuery, token, selectVisitorStats);
  return <div className="space-y-6">
    <SectionHeader section="statistics" onRefresh={() => { daily.refresh(); visitors.refresh(); }} isLoading={daily.refreshing || visitors.refreshing} />
    <ReadState title="访客统计加载失败" loading={false} error={visitors.error} retry={visitors.retryable ? visitors.refresh : undefined} />
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {([['today', '今日新用户'], ['online', '近 30 分钟在线用户'], ['visitors', '今日访客'], ['onlineVisitors', '近 30 分钟在线访客']] as const).map(([key, label]) => <Card key={key} variant="filled" padding="sm"><dt className="text-body-s text-on-surface-variant">{label}</dt><dd className="text-title-l tabular-nums">{visitors.data ? formatCount(visitors.data[key]) : visitors.error ? '—' : <Skeleton className="h-8 w-20" />}</dd></Card>)}
    </dl>
    <DataTable rows={daily.data ?? []} rowKey={(r) => r.date} columns={[{ key: 'date', header: '日期', primary: true, render: (r) => formatDate(r.date) }, { key: 'count', header: '新用户', render: (r) => formatCount(r.newUsers) }]} loading={daily.loading} {...tableError('每日用户统计加载失败', daily.error)} onRetry={daily.retryable ? daily.refresh : undefined} empty="最近 30 天暂无新增用户记录" />
  </div>;
}
export default protectedPanel(StatisticsTab);
