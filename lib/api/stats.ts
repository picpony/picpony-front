import { api } from './http';
import { ApiError } from './errors';

/**
 * `/stats`'s aggregate read: `GET /api/v1/stats?range=7|30|90|all` (`stats::site_stats`).
 *
 * Public and anonymous — the backend returns counts only, never accounts, visitor hashes or
 * paths. An explicit range is bucketed by Asia/Shanghai day; `all` widens to weeks or months
 * once the install is old enough, and `granularity` says which unit the dates use.
 */
export type StatsRange = '7' | '30' | '90' | 'all';

export type StatsGranularity = 'day' | 'week' | 'month';

/** One bucket. Cumulative fields describe the end of the bucket; `visitors`/`hits` are its own counts. */
export interface StatsPoint {
  date: string;
  new_users: number;
  total_users: number;
  new_chinese_tags: number;
  total_chinese_tags: number;
  visitors: number;
  hits: number;
  new_posts: number;
  total_posts: number;
  new_comments: number;
  total_comments: number;
  new_favorites: number;
  total_favorites: number;
  new_badges: number;
  total_badges: number;
}

/** All-time totals — the headline figures, independent of the selected range. */
export interface StatsTotals {
  users: number;
  chinese_tags: number;
  posts: number;
  comments: number;
  favorites: number;
  badges: number;
}

export interface SiteStats {
  timezone: string;
  range: StatsRange;
  granularity: StatsGranularity;
  start: string;
  end: string;
  totals: StatsTotals;
  /** Visitor counts summed over the selected window (they are not cumulative totals). */
  window: { visitors: number; hits: number };
  series: StatsPoint[];
}

export async function readSiteStats(range: StatsRange, signal?: AbortSignal): Promise<SiteStats> {
  const data = await api<SiteStats>('GET', '/stats', { query: { range }, signal, cache: 'no-store' });
  /* The screen maps over both, so a malformed answer is an `invalid` failure rather than a
     render-time crash. Field names are the backend's own; there is nothing to alias. */
  if (!Array.isArray(data.series) || typeof data.totals?.users !== 'number') {
    throw new ApiError('invalid', { status: 200 });
  }
  return data;
}
