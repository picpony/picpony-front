'use client';

import { useState, type ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DateRangeSlider from '@/components/DateRangeSlider';
import ErrorRetry from '@/components/ErrorRetry';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import StatChart, { type ChartSeries } from '@/components/StatChart';
import Tabs, { type TabItem } from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { SiteStats, StatsGranularity } from '@/lib/api/stats';
import { formatExactCount } from '@/lib/format';
import { useResource } from '@/lib/resource';
import { siteStats } from '@/lib/resources';
import { formatChineseDay, shiftDay, type StatsWindow } from '@/lib/statsDates';
import type { StatsSeed } from '@/lib/stats.server';

/**
 * /stats — the public site statistics screen.
 *
 * Four reads' worth of data arrive as one `stats` answer: cumulative users, cumulative Chinese
 * dictionary tags, visit counts and community content. Each is one tab of the same answer; the
 * page owns only the chosen start and end days, and the server picks daily, weekly or monthly
 * buckets from the span so a long window stays bounded.
 */

type StatsTab = 'stats-users' | 'stats-tags' | 'stats-visits' | 'stats-community';

type ChartView = 'daily' | 'total';

const STAT_TABS: TabItem<StatsTab>[] = [
  { value: 'stats-users', label: '用户' },
  { value: 'stats-tags', label: '中文词条' },
  { value: 'stats-visits', label: '访客与浏览量' },
  { value: 'stats-community', label: '社区内容' },
];

/** "每日" / "每周" / "每月" — the unit a bucket's new-count is counted in. */
function periodWord(granularity: StatsGranularity): string {
  return granularity === 'day' ? '每日' : granularity === 'week' ? '每周' : '每月';
}

/** Short axis labels: `11/6` for days and weeks, `2026/11` for months. */
function bucketLabel(date: string, granularity: StatsGranularity): string {
  const [year, month, day] = date.split('-');
  return granularity === 'month' ? `${year}/${Number(month)}` : `${Number(month)}/${Number(day)}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The daily/cumulative switch sitting at the chart's top-right. */
function ChartViewToggle({
  value,
  onChange,
  dailyLabel = '每日',
}: {
  value: ChartView;
  onChange: (next: ChartView) => void;
  dailyLabel?: string;
}) {
  return (
    <div role="group" aria-label="图表视图" className="flex items-center gap-1">
      <Chip variant="filter" tone="primary" selected={value === 'daily'} onClick={() => onChange('daily')}>
        {dailyLabel}
      </Chip>
      <Chip variant="filter" tone="primary" selected={value === 'total'} onClick={() => onChange('total')}>
        累计
      </Chip>
    </div>
  );
}

/** One metric panel: the headline figure and its chart. The tab names the section. */
function MetricCard({
  figureLabel,
  figure,
  note,
  children,
}: {
  figureLabel: string;
  figure: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="lg" className="min-w-0 h-full">
      <SectionHeading className="mb-2">{figureLabel}</SectionHeading>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-headline-m text-on-surface tabular-nums">{figure}</p>
        {note && <p className="text-body-s text-on-surface-variant wrap-anywhere">{note}</p>}
      </div>
      <div className="mt-6">{children}</div>
    </Card>
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
        <Skeleton className="h-6 w-24" />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="mt-6">
          <div className="mb-4 flex min-h-8 items-center justify-between gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-28 pointer-coarse:my-1" />
          </div>
          <Skeleton className="h-60 w-full rounded-sm" />
          <div className="mt-4 border-t border-outline-variant pt-3">
            <Skeleton className="h-4 w-12" />
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index}>
                  <Skeleton className="h-4.5 w-12" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Card variant="outlined" padding="lg" className="mt-6">
        <Skeleton className="h-6 w-24" />
        <div className="mt-4 flex h-12 items-center px-5">
          <Skeleton className="h-4 w-full rounded-sm" />
        </div>
        <div className="mt-1 flex justify-between gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
      </Card>
      <Skeleton className="mt-6 h-4 w-4/5" />
    </div>
  );
}

export default function StatsScreen({
  seed,
  defaultWindow,
}: {
  seed: StatsSeed | null;
  defaultWindow: StatsWindow;
}) {
  const [period, setPeriod] = useState<StatsWindow>(() =>
    seed ? { start: seed.data.start, end: seed.data.end } : defaultWindow,
  );
  /* `keepPrevious`: changing the window keeps the tabs, the chosen view and the last chart on
     screen while the next answer is out, instead of unmounting the whole body for a skeleton. */
  const read = useResource(siteStats, period, { initial: seed ?? undefined, keepPrevious: true });
  const data = read.data;
  const loading = data === undefined && read.error === undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="站点统计"
        subtitle="统计数据按北京时间聚合"
      />

      {data === undefined && read.error !== undefined && (
        <Card variant="outlined" padding="lg">
          <ErrorRetry
            size="pane"
            title="站点统计加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        </Card>
      )}
      {/* The previous window's chart stays visible, so a failed turn reports itself in place. */}
      {data !== undefined && read.error !== undefined && (
        <Card variant="outlined" padding="md" className="mb-6" role="status">
          <ErrorRetry
            size="inline"
            title="此时间范围加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
            entrance={false}
          />
        </Card>
      )}
      {loading && <StatsSkeleton />}
      {data !== undefined && (
        <StatsBody
          data={data}
          period={period}
          maxDay={defaultWindow.end}
          onPeriodChange={setPeriod}
          loading={read.isLoading}
        />
      )}
    </div>
  );
}

function StatsBody({
  data,
  period,
  maxDay,
  onPeriodChange,
  loading,
}: {
  data: SiteStats;
  period: StatsWindow;
  maxDay: string;
  onPeriodChange: (next: StatsWindow) => void;
  loading: boolean;
}) {
  const [category, setCategory] = useState<StatsTab>('stats-users');
  const [view, setView] = useState<ChartView>('total');
  const points = data.series;
  const labels = points.map((point) => bucketLabel(point.date, data.granularity));
  const unit = periodWord(data.granularity);
  const first = points[0];
  const last = points[points.length - 1];

  const newUsers = sum(points.map((point) => point.new_users));
  const newChineseTags = sum(points.map((point) => point.new_chinese_tags));
  const newContent = sum(
    points.map((point) => point.new_posts + point.new_comments + point.new_favorites + point.new_badges),
  );

  const userTotal: ChartSeries[] = [
    { key: 'total-users', label: '累计用户', values: points.map((point) => point.total_users), tone: 'primary' },
  ];
  const userNew: ChartSeries[] = [
    { key: 'new-users', label: `${unit}新增`, values: points.map((point) => point.new_users), tone: 'secondary' },
  ];
  const tagTotal: ChartSeries[] = [
    {
      key: 'total-tags',
      label: '累计中文词条',
      values: points.map((point) => point.total_chinese_tags),
      tone: 'primary',
    },
  ];
  const tagNew: ChartSeries[] = [
    {
      key: 'new-tags',
      label: `${unit}新增`,
      values: points.map((point) => point.new_chinese_tags),
      tone: 'secondary',
    },
  ];
  const visits: ChartSeries[] = [
    { key: 'visitors', label: '独立访客', values: points.map((point) => point.visitors), tone: 'primary' },
    { key: 'hits', label: '浏览量', values: points.map((point) => point.hits), tone: 'secondary' },
  ];
  const contentTotal: ChartSeries[] = [
    { key: 'posts', label: '帖子', values: points.map((point) => point.total_posts), tone: 'primary' },
    { key: 'comments', label: '评论', values: points.map((point) => point.total_comments), tone: 'secondary' },
    { key: 'favorites', label: '收藏', values: points.map((point) => point.total_favorites), tone: 'tertiary' },
    { key: 'badges', label: '徽章', values: points.map((point) => point.total_badges), tone: 'neutral' },
  ];
  const contentNew: ChartSeries[] = [
    { key: 'new-posts', label: '帖子', values: points.map((point) => point.new_posts), tone: 'primary' },
    { key: 'new-comments', label: '评论', values: points.map((point) => point.new_comments), tone: 'secondary' },
    { key: 'new-favorites', label: '收藏', values: points.map((point) => point.new_favorites), tone: 'tertiary' },
    { key: 'new-badges', label: '徽章', values: points.map((point) => point.new_badges), tone: 'neutral' },
  ];

  /* The slider's left bound is the first ranked day; fall back to 90 days when the deployed
     backend predates that field, and never hide the window the page opened on. */
  const earliest = data.earliest ?? shiftDay(maxDay, -89);
  const domainStart = earliest < period.start ? earliest : period.start;
  const domainEnd = period.end > maxDay ? period.end : maxDay;
  const toggle = <ChartViewToggle value={view} onChange={setView} dailyLabel={unit} />;

  return (
    <div data-stats-start={data.start} data-stats-end={data.end}>
      <p className="sr-only" role="status">
        {loading ? '正在更新统计数据…' : `当前显示 ${formatChineseDay(data.start)} 至 ${formatChineseDay(data.end)} 的统计数据`}
      </p>
      <Tabs
        tabs={STAT_TABS}
        value={category}
        onChange={setCategory}
        label="统计项目"
        className="mb-6"
      />
      <TabPanes value={category} size="largest">
        <TabPane value="stats-users">
          <MetricCard
            figureLabel="累计用户"
            figure={formatExactCount(data.totals.users)}
            note={`此期间新增 ${formatExactCount(newUsers)} 人`}
          >
            <StatChart
              active={category === 'stats-users'}
              series={view === 'total' ? userTotal : userNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? `累计用户折线图（${first ? formatExactCount(first.total_users) : 0} 至 ${last ? formatExactCount(last.total_users) : 0}）`
                  : `${unit}新增用户折线图`
              }
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-tags">
          <MetricCard
            figureLabel="累计中文词条"
            figure={formatExactCount(data.totals.chinese_tags)}
            note={`此期间新增 ${formatExactCount(newChineseTags)} 条`}
          >
            <StatChart
              active={category === 'stats-tags'}
              series={view === 'total' ? tagTotal : tagNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? `累计中文词条折线图（${first ? formatExactCount(first.total_chinese_tags) : 0} 至 ${last ? formatExactCount(last.total_chinese_tags) : 0}）`
                  : `${unit}新增中文词条折线图`
              }
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-visits">
          <MetricCard
            figureLabel="此期间独立访客"
            figure={formatExactCount(data.window.visitors)}
            note={`此期间浏览量 ${formatExactCount(data.window.hits)}`}
          >
            <StatChart
              active={category === 'stats-visits'}
              series={visits}
              labels={labels}
              loading={loading}
              ariaLabel={`${unit}独立访客与浏览量折线图`}
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-community">
          <MetricCard
            figureLabel="累计内容"
            figure={formatExactCount(
              data.totals.posts + data.totals.comments + data.totals.favorites + data.totals.badges,
            )}
            note={`帖子 ${formatExactCount(data.totals.posts)} · 评论 ${formatExactCount(data.totals.comments)} · 收藏 ${formatExactCount(data.totals.favorites)} · 徽章 ${formatExactCount(data.totals.badges)}`}
          >
            <StatChart
              active={category === 'stats-community'}
              series={view === 'total' ? contentTotal : contentNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? '帖子、评论、收藏与徽章的累计折线图'
                  : `${unit}新增社区内容折线图，此期间共 ${formatExactCount(newContent)} 条`
              }
            />
          </MetricCard>
        </TabPane>
      </TabPanes>

      <Card variant="outlined" padding="lg" className="mt-6">
        <SectionHeading>时间范围</SectionHeading>
        <DateRangeSlider
          min={domainStart}
          max={domainEnd}
          value={period}
          onCommit={onPeriodChange}
        />
      </Card>

      <p className="text-body-s text-on-surface-variant mt-6">
        访客为匿名访问计数，仅保留最近 90 天；中文词条按首次获得中文译名的时间计入。
      </p>
    </div>
  );
}
