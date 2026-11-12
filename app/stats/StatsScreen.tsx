'use client';

import { useState, type ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DateRangeSlider from '@/components/DateRangeSlider';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import StatChart, { type ChartSeries } from '@/components/StatChart';
import Tabs, { type TabItem } from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { SiteStats, StatsGranularity } from '@/lib/api/stats';
import { formatExactCount } from '@/lib/format';
import { useResource } from '@/lib/resource';
import { siteStats } from '@/lib/resources';
import { shiftDay, type StatsWindow } from '@/lib/statsDates';
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
function ChartViewToggle({ value, onChange }: { value: ChartView; onChange: (next: ChartView) => void }) {
  return (
    <div role="group" aria-label="图表视图" className="flex items-center gap-1">
      <Chip variant="filter" tone="primary" selected={value === 'daily'} onClick={() => onChange('daily')}>
        每日
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
    <Card variant="transparent" padding="lg">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <p className="text-label-m text-on-surface-variant">{figureLabel}</p>
          <p className="text-headline-m text-on-surface tabular-nums">{figure}</p>
        </div>
        {note && <p className="text-body-s text-on-surface-variant">{note}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在加载站点统计">
      <div className="mb-6 flex gap-6">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-6 w-16" delay={index * 80} />
        ))}
      </div>
      <Card variant="transparent" padding="lg">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-5 h-48 w-full" />
      </Card>
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
        subtitle="数据按北京时间聚合。累计数字是截至每个时间点的总量；访客与浏览量是各时段自身的计数。"
      />

      {data === undefined && read.error !== undefined && (
        <Card padding="lg">
          <ErrorRetry
            size="inline"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        </Card>
      )}
      {/* The previous window's chart stays visible, so a failed turn reports itself in place. */}
      {data !== undefined && read.error !== undefined && (
        <p className="text-body-s text-error mb-3">{apiErrorMessage(read.error)}</p>
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
    {
      key: 'new-content',
      label: `${unit}新增内容`,
      values: points.map(
        (point) => point.new_posts + point.new_comments + point.new_favorites + point.new_badges,
      ),
      tone: 'tertiary',
    },
  ];

  /* The slider's left bound is the first ranked day; fall back to 90 days when the deployed
     backend predates that field, and never hide the window the page opened on. */
  const earliest = data.earliest ?? shiftDay(maxDay, -89);
  const domainStart = earliest < period.start ? earliest : period.start;
  const domainEnd = period.end > maxDay ? period.end : maxDay;
  const toggle = <ChartViewToggle value={view} onChange={setView} />;

  return (
    <div>
      <Tabs
        tabs={STAT_TABS}
        value={category}
        onChange={setCategory}
        label="统计项目"
        className="mb-6"
      />
      <TabPanes value={category}>
        <TabPane value="stats-users" className="mb-4">
          <MetricCard
            figureLabel="累计用户"
            figure={formatExactCount(data.totals.users)}
            note={`本期间新增 ${formatExactCount(newUsers)} 人`}
          >
            <StatChart
              series={view === 'total' ? userTotal : userNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? `累计用户折线图，从 ${first ? formatExactCount(first.total_users) : 0} 增长到 ${last ? formatExactCount(last.total_users) : 0}`
                  : `${unit}新增用户折线图`
              }
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-tags" className="mb-4">
          <MetricCard
            figureLabel="累计中文词条"
            figure={formatExactCount(data.totals.chinese_tags)}
            note={`本期间新增 ${formatExactCount(newChineseTags)} 条`}
          >
            <StatChart
              series={view === 'total' ? tagTotal : tagNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? `累计中文词条折线图，从 ${first ? formatExactCount(first.total_chinese_tags) : 0} 增长到 ${last ? formatExactCount(last.total_chinese_tags) : 0}`
                  : `${unit}新增中文词条折线图`
              }
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-visits" className="mb-4">
          <MetricCard
            figureLabel="本期间独立访客"
            figure={formatExactCount(data.window.visitors)}
            note={`本期间浏览量 ${formatExactCount(data.window.hits)}`}
          >
            <StatChart
              series={visits}
              labels={labels}
              loading={loading}
              ariaLabel={`${unit}独立访客与浏览量折线图`}
            />
          </MetricCard>
        </TabPane>

        <TabPane value="stats-community" className="mb-4">
          <MetricCard
            figureLabel="累计内容"
            figure={formatExactCount(
              data.totals.posts + data.totals.comments + data.totals.favorites + data.totals.badges,
            )}
            note={`帖子 ${formatExactCount(data.totals.posts)} · 评论 ${formatExactCount(data.totals.comments)} · 收藏 ${formatExactCount(data.totals.favorites)} · 徽章 ${formatExactCount(data.totals.badges)}`}
          >
            <StatChart
              series={view === 'total' ? contentTotal : contentNew}
              labels={labels}
              loading={loading}
              actions={toggle}
              ariaLabel={
                view === 'total'
                  ? '帖子、评论、收藏与徽章的累计折线图'
                  : `${unit}新增社区内容折线图，本期间共 ${formatExactCount(newContent)} 条`
              }
            />
          </MetricCard>
        </TabPane>
      </TabPanes>

      {/* Directly under the chart, as the one control for its window; its own labels move with
          the handles. */}
      <div className="mt-2">
        <DateRangeSlider
          min={domainStart}
          max={domainEnd}
          value={period}
          onCommit={onPeriodChange}
        />
      </div>

      <p className="text-body-s text-on-surface-variant mt-6">
        访客为匿名访问计数，仅保留最近 90 天；中文词条按首次获得中文译名的时间计入。
      </p>
    </div>
  );
}
