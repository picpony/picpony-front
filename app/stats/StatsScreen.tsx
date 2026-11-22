'use client';

import { useState, type ReactNode } from 'react';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DateRangeSlider from '@/components/DateRangeSlider';
import ErrorRetry from '@/components/ErrorRetry';
import PageHeader from '@/components/PageHeader';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import StatChart from '@/components/StatChart';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { SiteStats } from '@/lib/api/stats';
import { useResource } from '@/lib/resource';
import { siteStats } from '@/lib/resources';
import { formatChineseDay, shiftDay, type StatsWindow } from '@/lib/statsDates';
import type { StatsSeed } from '@/lib/stats.server';
import { chartBuckets, chartMetrics, periodWord, STATS_SECTIONS, type ChartView, type StatsTab } from './statsMetrics';

const STAT_TABS = STATS_SECTIONS.map(({ value, label }) => ({ value, label }));

function ChartViewToggle({ value, onChange, intervalLabel }: {
  value: ChartView;
  onChange: (next: ChartView) => void;
  intervalLabel: string;
}) {
  return (
    <div role="group" aria-label="图表视图" className="flex shrink-0 items-center gap-1">
      <Chip variant="filter" tone="primary" selected={value === 'added'} onClick={() => onChange('added')}>
        {intervalLabel}
      </Chip>
      <Chip variant="filter" tone="primary" selected={value === 'total'} onClick={() => onChange('total')}>
        累计
      </Chip>
    </div>
  );
}

function RangeCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface pt-6">
      <Card variant="outlined" padding="lg">
        <SectionHeading className="mb-1">时间范围</SectionHeading>
        {children}
      </Card>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div data-page-loading="" aria-busy="true" aria-label="正在加载站点统计">
      <div className="mb-6 flex h-12 items-center gap-6 overflow-hidden border-b border-outline-variant">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-4 w-16 shrink-0" delay={index * 80} />
        ))}
      </div>
      <Card padding="lg">
        <div className="mb-4 flex items-center justify-between gap-x-3">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-8 w-36 shrink-0 pointer-coarse:my-1" />
        </div>
        <div className="mb-4 border-b border-outline-variant pb-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-2 h-4 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-60 w-full rounded-sm" />
      </Card>
      <RangeCard>
        <div className="flex h-12 items-center px-5">
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="mt-1 flex min-h-6 items-center justify-between gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
      </RangeCard>
    </div>
  );
}

export default function StatsScreen({ seed, defaultWindow }: {
  seed: StatsSeed | null;
  defaultWindow: StatsWindow;
}) {
  const [period, setPeriod] = useState<StatsWindow>(() =>
    seed ? { start: seed.data.start, end: seed.data.end } : defaultWindow,
  );
  // Keep the previous result, category, and view while reading the next date window.
  const { data, error, isLoading, refresh } = useResource(siteStats, period, { initial: seed ?? undefined, keepPrevious: true });
  const retry = isRetryable(error) ? refresh : undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="站点统计" subtitle="统计数据按北京时间聚合" />
      {data === undefined ? (
        error === undefined ? <StatsSkeleton /> : (
          <Card variant="outlined" padding="lg">
            <ErrorRetry size="pane" title="站点统计加载失败" message={apiErrorMessage(error)} onRetry={retry} />
          </Card>
        )
      ) : (
        <StatsBody
          data={data}
          period={period}
          maxDay={defaultWindow.end}
          onPeriodChange={setPeriod}
          loading={isLoading}
          failure={error === undefined ? null : (
            <Card variant="outlined" padding="md" className="mt-4" role="status">
              <ErrorRetry
                size="inline"
                title="此时间范围加载失败"
                message={apiErrorMessage(error)}
                onRetry={retry}
                entrance={false}
              />
            </Card>
          )}
        />
      )}
    </div>
  );
}

function StatsBody({ data, period, maxDay, onPeriodChange, loading, failure }: {
  data: SiteStats;
  period: StatsWindow;
  maxDay: string;
  onPeriodChange: (next: StatsWindow) => void;
  loading: boolean;
  failure: ReactNode;
}) {
  const [category, setCategory] = useState<StatsTab>('stats-users');
  const [view, setView] = useState<ChartView>('total');
  const buckets = chartBuckets(data);
  const earliest = data.earliest ?? shiftDay(maxDay, -89);
  const domainStart = earliest < period.start ? earliest : period.start;
  const domainEnd = period.end > maxDay ? period.end : maxDay;
  const toggle = <ChartViewToggle value={view} onChange={setView} intervalLabel={periodWord(data.granularity)} />;
  const displayedRange = `${formatChineseDay(data.start)} 至 ${formatChineseDay(data.end)}`;
  const failedRangeChange = failure != null && (data.start !== period.start || data.end !== period.end);
  const rangeStatus = failedRangeChange
    ? `所选日期加载失败，仍显示 ${displayedRange} 的统计数据`
    : loading ? '正在更新统计数据…' : `当前显示 ${displayedRange} 的统计数据`;

  return (
    <div data-stats-start={data.start} data-stats-end={data.end}>
      <Tabs tabs={STAT_TABS} value={category} onChange={setCategory} label="统计项目" className="mb-6" />
      <p role="status" className={failedRangeChange ? 'mb-3 text-body-s tabular-nums text-on-surface-variant' : 'sr-only'}>
        {rangeStatus}
      </p>
      <TabPanes
        value={category}
        following={(
          <>
            <RangeCard>
              <DateRangeSlider min={domainStart} max={domainEnd} value={period} onCommit={onPeriodChange} />
            </RangeCard>
            {failure}
          </>
        )}
      >
        {STATS_SECTIONS.map((section) => (
          <TabPane key={section.value} value={section.value} inertWhenInactive>
            <Card padding="lg" className="min-w-0">
              <div className="mb-4 flex items-start gap-x-3">
                <SectionHeading className="mb-0 min-w-0 flex-1 self-center" subtitle={'note' in section ? section.note : undefined}>
                  {section.heading}
                </SectionHeading>
                {section.kind === 'growth' && toggle}
              </div>
              <StatChart
                {...chartMetrics(section, data, view)}
                active={category === section.value}
                buckets={buckets}
                loading={loading}
              />
            </Card>
          </TabPane>
        ))}
      </TabPanes>
    </div>
  );
}
