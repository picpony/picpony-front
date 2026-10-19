'use client';

import * as adminApi from '@/lib/api/admin';
import type { Resource } from '@/lib/resource';
import { defineAdminQuery } from './queries';
import type { AdminUser } from './users/UserEditor';

/*
 * Reads more than one panel shows — the overview's tiles and the panel each tile opens. One
 * resource per read, so the overview's answer is the panel's first paint and opening the panel
 * costs no second request.
 */

/** The accounts, as `GET /admin/users` lists them (every page). */
export interface AdminUsers {
  rows: AdminUser[];
}

/**
 * Every account, read once for every panel that shows any of it: 用户管理 the accounts, 经验与金币
 * the same rows' two figures, 开发者's API 加速 table their names. It was a resource per panel —
 * three reads in one visit, each with its own invalidation, so a write in one left the others stale
 * (G4-020, G2-019). Each panel shapes the rows itself (`useAdminSelect`).
 */
export const usersQuery = defineAdminQuery<AdminUsers>('users', async (token, signal) => ({
  rows: await adminApi.adminGetUsers(token, signal),
}));

export type ReportStatus = adminApi.ReportStatus;
export type Report = adminApi.AdminReport;

export const reportsQuery = defineAdminQuery<Report[]>('reports', (token, signal) => adminApi.adminGetReports(token, signal));

export interface SiteStatus {
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

/**
 * The maintenance switch, the console's one read of it (G2-019): 其他功能's switch and the overview
 * take its two fields. The failure carries no noun — each panel prints it under its own title.
 */
export const siteStatusQuery: Resource<string, SiteStatus> = defineAdminQuery<SiteStatus>('site-status', async (token, signal): Promise<SiteStatus> => {
  const data = await adminApi.getMaintenanceStatus(token, signal);
  return { maintenanceMode: data.maintenance_mode, maintenanceMessage: data.maintenance_message };
});

/**
 * Image translation as the console sees it (`GET /admin/translation`): 其他功能's switch and 数据维护's
 * queue counts, one read.
 */
export const translationQuery: Resource<string, adminApi.AdminTranslation> = defineAdminQuery('translation', adminApi.adminGetTranslation);
