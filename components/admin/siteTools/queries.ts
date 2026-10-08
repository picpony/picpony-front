'use client';

import { defineResource, SKIP, useResource } from '@/lib/resource';
import { readToken } from '@/lib/hooks';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import * as api from '@/lib/api/adminSiteTools';
import { defineAdminQuery, derived } from '../queries';
import { useShownListKey } from '../paging';
import { siteStatusQuery, type AdminUsers, type SiteStatus } from '../sharedQueries';

/**
 * 全站线路 and 智能搜索 read the console's one status document (`siteStatusQuery`) and derive their
 * editors from it — never a second read of `get_maintenance_status` beside it (G2-019). Saving
 * invalidates the one document, so 其他功能 cannot hold a copy older than the editor just saved.
 */
export const statusQuery = siteStatusQuery;
const toolsOfDocument = derived(api.siteToolsStatus);
/** Keyed on the document, not the status around it: 其他功能's optimistic `write` spreads the status
 *  and keeps the document, so the editors' `initial` keeps its identity through it. */
export const selectToolsStatus = (status: SiteStatus) => toolsOfDocument(status.document);
/** 访问统计's tiles from the shared users read (`usersQuery`) — no read of their own (G2-019). */
export const selectVisitorStats = derived((users: AdminUsers) => api.visitorStats(users.stats));
export const relayConfigQuery = defineAdminQuery('relay-config', api.readRelayConfig);
export const rateQuery = defineAdminQuery('rate-management', api.readRateLimits);
export const dailyQuery = defineAdminQuery('daily-user-stats', api.readDailyStats);
export const quotaQuery = defineAdminQuery('ai-quota', api.readAiQuota);
export const assistantQuery = defineAdminQuery('ai-assistant', api.readAssistantConfig);

function paged<A, T>(name: string, fetcher: (token: string, args: A, signal?: AbortSignal) => Promise<T>) {
  return defineResource<A & { token: string }, T>({ name: `admin-site-tools-${name}`, key: (args) => JSON.stringify(args), ttl: 60000, maxEntries: 12,
    fetch: (args, signal) => {
      if (readToken() !== args.token) throw new Error('登录状态已失效，请重新登录');
      return fetcher(args.token, args, signal);
    },
  });
}
export const feedbackQuery = paged('feedback', api.readFeedback);
export const relayStatsQuery = paged('relay-stats', api.readRelayStats);
export const relayErrorsQuery = paged('relay-errors', api.readRelayErrors);
export const announcementsQuery = paged('announcements', (_token, args: { page: number }, signal) => api.readAnnouncementHistory(args.page, signal));
export function useToolPage<A extends { page: number }, T>(resource: ReturnType<typeof paged<A, T>>, token: string, args: A, scope: string) {
  const read = useResource(resource, token ? { ...args, token } : SKIP, { keepPrevious: `${token}:${scope}` });
  const listKey = useShownListKey(`${scope}
${JSON.stringify(args)}`, read.isPrevious);
  return { ...read, listKey, loading: read.data === undefined && !read.error, refreshing: read.isLoading && read.data !== undefined,
    message: read.error ? apiErrorMessage(read.error) : undefined, retry: read.error && isRetryable(read.error) ? read.refresh : undefined };
}
