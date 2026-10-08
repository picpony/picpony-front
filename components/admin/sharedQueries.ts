'use client';

import * as adminApi from '@/lib/api/admin';
import { adminData, adminList, defineAdminQuery } from './queries';
import type { AdminUser } from './users/UserEditor';

/*
 * Reads more than one panel shows — the overview's tiles and the panel each tile opens. One
 * resource per read, so the overview's answer is the panel's first paint and opening the panel
 * costs no second request.
 */

/** One `admin_get_users` answer: the accounts, and the visitor counts the backend sends beside them. */
export interface AdminUsers {
  rows: AdminUser[];
  /** `stats` as sent — 访问统计 reads it (`api.visitorStats`), and is the only panel that fails on it. */
  stats: unknown;
}

/**
 * `admin_get_users` — every account, in one response, read once for every panel that shows any of
 * it: 用户管理 the accounts, 经验与金币 the same rows' two figures, 开发者's API 加速 table their
 * `api_accel_banned`, and 访问统计 the `stats` beside them. It was a resource per panel — three
 * reads in one visit, each with its own invalidation, so a write in one left the others stale
 * (G4-020, G2-019). Each panel shapes the rows itself (`useAdminSelect`).
 */
export const usersQuery = defineAdminQuery<AdminUsers>('users', async (token, signal) => {
  const data = await adminApi.adminGetUsers(token, signal);
  return { rows: adminList<AdminUser>(data, 'users', '用户列表'), stats: data.stats };
});

export type ReportStatus = 'pending' | 'processed' | 'rejected';

export interface Report {
  id: number;
  image_id: number;
  username: string;
  reason: string;
  status: ReportStatus;
  created_at: string;
}

export const reportsQuery = defineAdminQuery<Report[]>('reports', async (token, signal) => {
  const data = await adminApi.adminGetReports(token, signal);
  return adminList<Report>(data, 'reports', '举报');
});

export interface SiteStatus {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  translateEnabled: boolean;
  /**
   * The whole document, for the panels that read more of it (全站线路, 智能搜索 — `selectToolsStatus`).
   * A `write` here spreads the status and keeps this reference, so what those panels derive from it
   * keeps its identity through 其他功能's optimistic updates.
   */
  document: Record<string, unknown>;
}

/**
 * `get_maintenance_status`, the console's one read of it (G2-019): 其他功能's switches and the overview
 * take the three fields above, 全站线路 and 智能搜索 derive their editors from `document`. It was two
 * resources over the one action, invalidated independently, so a route saved in one could stand
 * beside a stale copy of the same document in the other. The failure carries no noun — each of the
 * four panels prints it under its own title.
 */
export const siteStatusQuery = defineAdminQuery<SiteStatus>('site-status', async (token, signal) => {
  const data = await adminApi.getMaintenanceStatus(token, signal);
  return adminData(data, {
    maintenanceMode: data.maintenance_mode === true,
    maintenanceMessage: typeof data.maintenance_message === 'string' ? data.maintenance_message : '',
    translateEnabled: data.translate_enabled !== false,
    document: data,
  }, null);
});
