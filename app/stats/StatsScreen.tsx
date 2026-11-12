'use client';

import { useState, type ReactNode } from 'react';
import PageHeader from '@/components/PageHeader';
import Card from '@/components/Card';
import DateInput from '@/components/admin/DateInput';
import ErrorRetry from '@/components/ErrorRetry';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import StatChart, { type ChartSeries } from '@/components/StatChart';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { SiteStats, StatsGranularity } from '@/lib/api/stats';
import { formatExactCount } from '@/lib/format';
import { useResource } from '@/lib/resource';
import { siteStats } from '@/lib/resources';
import { formatChineseDay, type StatsWindow } from '@/lib/statsDates';
import type { StatsSeed } from '@/lib/stats.server';

/**
 * /stats — the public site statistics screen.
 *
 * Four reads' worth of data arrive as one `stats` answer: cumulative users, cumulative Chinese
 * dictionary tags, visit counts and community content, all bucketed by the same Beijing calendar
 * unit. The page owns only the chosen start and end days; the server picks daily, weekly or
 * monthly buckets from the span so a long window stays bounded.
 */

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

/** One metric section: a heading, the headline figure, and one or two charts. */
function MetricCard({
  title,
  figureLabel,
  figure,
  note,
  children,
}: {
  title: string;
  figureLabel: string;
  figure: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <SectionHeading className="mb-3">{title}</SectionHeading>
      <Card padding="lg">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div>
            <p className="text-label-m text-on-surface-variant">{figureLabel}</p>
            <p className="text-headline-m text-on-surface tabular-nums">{figure}</p>
          </div>
          {note && <p className="text-body-s text-on-surface-variant">{note}</p>}
        </div>
        <div className="mt-5 space-y-6">{children}</div>
      </Card>
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="正在加载站点统计">
      {[0, 1, 2, 3].map((index) => (
        <div key={index}>
          <Skeleton className="mb-3 h-5 w-20" />
          <Card padding="lg">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="mt-5 h-48 w-full" />
          </Card>
        </div>
      ))}
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
  const read = useResource(siteStats, period, { initial: seed ?? undefined });
  const data = read.data;
  const loading = data === undefined && read.error === undefined;

  /* Keep the two fields in calendar order while typing or picking: a start after the current
     end carries the end with it, and an end before the start carries the start back. The native
     inputs also carry min/max, so the invalid intermediate state cannot be committed. */
  const changeStart = (value: string) => {
    if (!value) return;
    setPeriod((current) => ({ start: value, end: value > current.end ? value : current.end }));
  };
  const changeEnd = (value: string) => {
    if (!value) return;
    setPeriod((current) => ({ start: value < current.start ? value : current.start, end: value }));
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="站点统计"
        subtitle="数据按北京时间聚合。累计数字是截至每个时间点的总量；访客与浏览量是各时段自身的计数。"
      />
      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-4">
        <DateInput
          label="开始日期"
          fieldClassName="w-full sm:w-44"
          value={period.start}
          max={period.end}
          onChange={(event) => changeStart(event.currentTarget.value)}
        />
        <span aria-hidden="true" className="text-title-m text-on-surface-variant pb-4">
          ～
        </span>
        <DateInput
          label="结束日期"
          fieldClassName="w-full sm:w-44"
          value={period.end}
          min={period.start}
          max={defaultWindow.end}
          onChange={(event) => changeEnd(event.currentTarget.value)}
        />
      </div>
      <p className="text-body-m text-on-surface-variant mb-6">
        统计区间：
        <span className="text-on-surface tabular-nums">
          {formatChineseDay(period.start)} ～ {formatChineseDay(period.end)}
        </span>
      </p>

      {data === undefined && read.error !== undefined && (
        <Card padding="lg">
          <ErrorRetry
            size="inline"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        </Card>
      )}
      {loading && <StatsSkeleton />}
      {data !== undefined && <StatsBody data={data} />}
    </div>
  );
}

function StatsBody({ data }: { data: SiteStats }) {
  const points = data.series;
  const labels = points.map((point) => bucketLabel(point.date, data.granularity));
  const period = periodWord(data.granularity);
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
    { key: 'new-users', label: `${period}新增`, values: points.map((point) => point.new_users), tone: 'secondary' },
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
      label: `${period}新增`,
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
      label: `${period}新增内容`,
      values: points.map(
        (point) => point.new_posts + point.new_comments + point.new_favorites + point.new_badges,
      ),
      tone: 'tertiary',
    },
  ];

  return (
    <div>
      <MetricCard
        title="用户"
        figureLabel="累计用户"
        figure={formatExactCount(data.totals.users)}
        note={`本期间新增 ${formatExactCount(newUsers)} 人`}
      >
        <StatChart
          series={userTotal}
          labels={labels}
          ariaLabel={`累计用户折线图，从 ${first ? formatExactCount(first.total_users) : 0} 增长到 ${last ? formatExactCount(last.total_users) : 0}`}
        />
        <StatChart
          series={userNew}
          labels={labels}
          ariaLabel={`${period}新增用户折线图`}
          className="border-outline-variant border-t pt-6"
        />
      </MetricCard>

      <MetricCard
        title="中文词条"
        figureLabel="累计中文词条"
        figure={formatExactCount(data.totals.chinese_tags)}
        note={`本期间新增 ${formatExactCount(newChineseTags)} 条`}
      >
        <StatChart
          series={tagTotal}
          labels={labels}
          ariaLabel={`累计中文词条折线图，从 ${first ? formatExactCount(first.total_chinese_tags) : 0} 增长到 ${last ? formatExactCount(last.total_chinese_tags) : 0}`}
        />
        <StatChart
          series={tagNew}
          labels={labels}
          ariaLabel={`${period}新增中文词条折线图`}
          className="border-outline-variant border-t pt-6"
        />
      </MetricCard>

      <MetricCard
        title="访客与浏览量"
        figureLabel="本期间独立访客"
        figure={formatExactCount(data.window.visitors)}
        note={`本期间浏览量 ${formatExactCount(data.window.hits)}`}
      >
        <StatChart series={visits} labels={labels} ariaLabel={`${period}独立访客与浏览量折线图`} />
      </MetricCard>

      <MetricCard
        title="社区内容"
        figureLabel="累计内容"
        figure={formatExactCount(
          data.totals.posts + data.totals.comments + data.totals.favorites + data.totals.badges,
        )}
        note={`帖子 ${formatExactCount(data.totals.posts)} · 评论 ${formatExactCount(data.totals.comments)} · 收藏 ${formatExactCount(data.totals.favorites)} · 徽章 ${formatExactCount(data.totals.badges)}`}
      >
        <StatChart
          series={contentTotal}
          labels={labels}
          ariaLabel="帖子、评论、收藏与徽章的累计折线图"
        />
        <StatChart
          series={contentNew}
          labels={labels}
          ariaLabel={`${period}新增社区内容折线图，本期间共 ${formatExactCount(newContent)} 条`}
          className="border-outline-variant border-t pt-6"
        />
      </MetricCard>

      <p className="text-body-s text-on-surface-variant">
        访客为匿名访问计数，仅保留最近 90 天；中文词条按首次获得中文译名的时间计入。
      </p>
    </div>
  );
}
