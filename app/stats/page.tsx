import type { Metadata } from 'next';
import StatsScreen from './StatsScreen';
import { defaultStatsWindow } from '@/lib/statsDates';
import { readStatsSeed } from '@/lib/stats.server';

export const metadata: Metadata = {
  title: '站点统计',
  description: '按时间展示本站用户、中文词条、访客与社区内容的增长。',
};

/**
 * Server shell for /stats. The default seven-day answer is read here and handed down as a seed,
 * so the first paint carries the numbers; the island reads every other window itself. The
 * default window travels with the seed so both render passes agree on the date controls even
 * when the upstream read failed.
 */
export default async function StatsPage() {
  const seed = await readStatsSeed();
  return <StatsScreen seed={seed} defaultWindow={defaultStatsWindow()} />;
}
