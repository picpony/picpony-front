import type { ChartBucket, ChartSeries, ChartTone } from '@/components/StatChart';
import type { SiteStats, StatsGranularity } from '@/lib/api/stats';
import { formatChineseDay } from '@/lib/statsDates';

type GrowthKey = keyof SiteStats['totals'];
type TrafficKey = keyof SiteStats['window'];

type Metric<Key> = { key: Key; label: string; tone: ChartTone };
type StatsSection = {
  value: `stats-${string}`;
  label: string;
  heading: string;
  note?: string;
} & (
  | { kind: 'growth'; metrics: readonly Metric<GrowthKey>[] }
  | { kind: 'traffic'; metrics: readonly Metric<TrafficKey>[] }
);

export const STATS_SECTIONS = [
  {
    value: 'stats-users', label: '用户', heading: '用户趋势', kind: 'growth',
    metrics: [{ key: 'users', label: '用户数', tone: 'primary' }],
  },
  {
    value: 'stats-tags', label: '中文词条', heading: '中文词条趋势', kind: 'growth',
    note: '按首次获得中文译名的时间计入',
    metrics: [{ key: 'chinese_tags', label: '中文词条数', tone: 'primary' }],
  },
  {
    value: 'stats-visits', label: '访客与浏览量', heading: '访问趋势', kind: 'traffic',
    note: '访客按时段匿名计数，访问数据仅保留最近 90 天',
    metrics: [
      { key: 'visitors', label: '访客数', tone: 'primary' },
      { key: 'hits', label: '浏览量', tone: 'secondary' },
    ],
  },
  {
    value: 'stats-community', label: '社区内容', heading: '社区内容趋势', kind: 'growth',
    metrics: [
      { key: 'posts', label: '帖子', tone: 'primary' },
      { key: 'comments', label: '评论', tone: 'secondary' },
      { key: 'favorites', label: '收藏', tone: 'tertiary' },
      { key: 'badges', label: '徽章', tone: 'neutral' },
    ],
  },
] as const satisfies readonly StatsSection[];

export type StatsTab = (typeof STATS_SECTIONS)[number]['value'];
export type ChartView = 'added' | 'total';

export function periodWord(granularity: StatsGranularity): string {
  return granularity === 'day' ? '每日' : granularity === 'week' ? '每周' : '每月';
}

export function chartBuckets(data: SiteStats): ChartBucket[] {
  return data.series.map(({ date }) => {
    const [year, month, day] = date.split('-').map(Number);
    if (data.granularity === 'month') return { key: date, tick: `${year}/${month}`, detail: `${year}年${month}月` };
    const detail = data.granularity === 'week' ? `${formatChineseDay(date)}当周` : formatChineseDay(date);
    return { key: date, tick: `${month}/${day}`, detail };
  });
}

/** Each series contributes one overview value with the same scope as its trend. */
export function chartMetrics(section: StatsSection, data: SiteStats, view: ChartView) {
  const unit = periodWord(data.granularity);
  if (section.kind === 'traffic') {
    const series: ChartSeries[] = section.metrics.map((metric) => ({
      ...metric,
      values: data.series.map((point) => point[metric.key]),
      summary: data.window[metric.key],
    }));
    // The API owns the visitor window calculation; do not infer cross-day uniqueness.
    return { series, overviewLabel: '区间合计', ariaLabel: `${unit}访客与浏览量折线图` };
  }

  const cumulative = view === 'total';
  const series: ChartSeries[] = section.metrics.map(({ key, label, tone }) => {
    const field = cumulative ? `total_${key}` as const : `new_${key}` as const;
    const values = data.series.map((point) => point[field]);
    const last = values.at(-1);
    // The final bucket is the cumulative snapshot within this window, not today's site total.
    const summary = cumulative ? last : values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
    return { key: field, label, tone, values, summary: summary ?? null };
  });
  return {
    series,
    overviewLabel: cumulative ? '区间末累计' : '区间新增',
    detailQualifier: cumulative ? '累计' : '新增',
    ariaLabel: cumulative ? `累计${section.label}折线图` : `${unit}新增${section.label}折线图`,
  };
}
