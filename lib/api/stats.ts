import { api } from './http';
import { ApiError } from './errors';
import type { StatsWindow } from '@/lib/statsDates';

/**
 * `/stats`'s aggregate read: `GET /api/v1/stats?start=YYYY-MM-DD&end=YYYY-MM-DD`
 * (`stats::site_stats`).
 *
 * Public and anonymous — the backend returns counts only, never accounts, visitor hashes or
 * paths. The window is inclusive and interpreted as Asia/Shanghai calendar days; `granularity`
 * says whether the returned buckets are days, weeks or months.
 */
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
  granularity: StatsGranularity;
  start: string;
  end: string;
  /**
   * The first day any ranked record exists — the range slider's left bound. Optional so the
   * screen still works against a backend deployed before this field existed.
   */
  earliest?: string;
  totals: StatsTotals;
  /** Visitor counts summed over the selected window (they are not cumulative totals). */
  window: { visitors: number; hits: number };
  series: StatsPoint[];
}

export async function readSiteStats({ start, end }: StatsWindow, signal?: AbortSignal): Promise<SiteStats> {
  const data = await api<SiteStats>('GET', '/stats', {
    query: { start, end },
    signal,
    cache: 'no-store',
  });
  /* The screen maps over both, so a malformed answer is an `invalid` failure rather than a
     render-time crash. Field names are the backend's own; there is nothing to alias. */
  if (!Array.isArray(data.series) || typeof data.totals?.users !== 'number') {
    throw new ApiError('invalid', { status: 200 });
  }
  return data;
}
