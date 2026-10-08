'use client';

import type { ComponentType, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { ICON } from '@/lib/icons';
import type { Role } from '@/lib/roles';
import AdminPaneSkeleton from './AdminPaneSkeleton';
import { ADMIN_SECTIONS, type AdminSectionId } from './sections';

/**
 * The admin console's one tab registry: the rail, the access rule, the address and the lazy
 * panel all come from an entry here, so a new section is one entry and one panel file.
 *
 * A panel is a default-exported component taking `AdminPanelProps`, built from the console's
 * panel pattern (`SectionHeader`, `AdminNote`, `AdminForm`, `DataTable` + `AdminPager`, the
 * inline editor): see the D3 handoff §2 and the note on each of those modules.
 *
 * Panels are `dynamic(…, { ssr: false })`: the console is client-only (it needs the session),
 * and every tab in one chunk would make the first section wait for all of them. The
 * `loading` fallback is the panel's own silhouette, so a first visit to a tab never shows an
 * empty well while its chunk arrives.
 */

export interface AdminPanelProps {
  token: string;
  /** The viewer's role — what a panel offers depends on it (only 创始人 edits wealth, …). */
  role: Role;
  /** The viewer's account id: no panel offers a destructive action on the viewer's own row. */
  viewerId: number;
  /** Switch the console to another section, exactly as the rail does (the address is replaced, never pushed). */
  openTab: (id: AdminTabId) => void;
}

/** Who sees a section: every staff role, administrators, or 创始人 alone. */
export type AdminAccess = 'staff' | 'admin' | 'super_admin';

interface AdminTabEntry {
  id: string;
  label: string;
  icon: ReactNode;
  access: AdminAccess;
  component: ComponentType<AdminPanelProps>;
}

const panel = (load: () => Promise<{ default: ComponentType<AdminPanelProps> }>) =>
  dynamic<AdminPanelProps>(load, { ssr: false, loading: () => <AdminPaneSkeleton /> });

/* Rail glyphs at 24dp: a rail tab is a navigation row (`ICON.standard`, the `Tabs` rail's size). */
const icon = (Glyph: ComponentType<{ size?: number }>) => <Glyph size={ICON.standard} />;

/** A rail entry: its name and mark come from `ADMIN_SECTIONS`, which the panel's heading reads too. */
const entry = <const Id extends AdminSectionId>(
  id: Id,
  access: AdminAccess,
  load: () => Promise<{ default: ComponentType<AdminPanelProps> }>,
) => ({ id, label: ADMIN_SECTIONS[id].label, icon: icon(ADMIN_SECTIONS[id].glyph), access, component: panel(load) });

/** In rail order. The first entry is where bare `/admin` lands, and every staff role can open it. */
export const ADMIN_TABS = [
  entry('welcome', 'staff', () => import('./WelcomeTab')),
  entry('glossary', 'staff', () => import('./glossary/GlossaryTab')),
  entry('users', 'admin', () => import('./UsersTab')),
  entry('notifications', 'admin', () => import('./NotificationsTab')),
  entry('announcement', 'admin', () => import('./siteTools/AnnouncementsTab')),
  entry('messages', 'admin', () => import('./MessagesAuditTab')),
  entry('badges', 'admin', () => import('./BadgesTab')),
  entry('blocktags', 'admin', () => import('./BlockTagsTab')),
  entry('developer', 'admin', () => import('./DeveloperTab')),
  entry('team', 'admin', () => import('./TeamTab')),
  entry('shop', 'admin', () => import('./ShopTab')),
  entry('mascots', 'admin', () => import('./catalogTools/MascotsTab')),
  entry('ponies', 'admin', () => import('./catalogTools/PoniesTab')),
  entry('data-import', 'admin', () => import('./catalogTools/ImportToolsTab')),
  entry('reports', 'admin', () => import('./ReportsTab')),
  entry('blacklist', 'admin', () => import('./BlacklistTab')),
  entry('wealth', 'super_admin', () => import('./WealthTab')),
  entry('other', 'admin', () => import('./OtherTab')),
  entry('routes', 'admin', () => import('./siteTools/RoutesTab')),
  entry('statistics', 'admin', () => import('./siteTools/StatisticsTab')),
  entry('semantic', 'admin', () => import('./siteTools/SemanticTab')),
  entry('relay', 'admin', () => import('./siteTools/RelayTab')),
  entry('rate-management', 'admin', () => import('./siteTools/RateLimitsTab')),
  entry('ai-assistant', 'admin', () => import('./siteTools/AssistantTab')),
] as const satisfies readonly AdminTabEntry[];

export type AdminTabId = (typeof ADMIN_TABS)[number]['id'];
export type AdminTab = (typeof ADMIN_TABS)[number];

/** The section bare `/admin` shows — the address spells it by leaving `?tab=` out. */
export const DEFAULT_ADMIN_TAB: AdminTabId = 'welcome';

const RANK: Record<Role, number> = { user: 0, editor: 1, admin: 2, super_admin: 3 };

/** The role a session's `role` field names; anything unknown is an ordinary account. */
export function adminRole(value: unknown): Role {
  const role = typeof value === 'string' ? value.toLowerCase() : '';
  return role === 'super_admin' || role === 'admin' || role === 'editor' ? role : 'user';
}

export function canAccess(access: AdminAccess, role: Role): boolean {
  if (access === 'staff') return RANK[role] >= RANK.editor;
  if (access === 'admin') return RANK[role] >= RANK.admin;
  return role === 'super_admin';
}

/** The sections this role is offered, in rail order. */
export function adminTabsFor(role: Role): AdminTab[] {
  return ADMIN_TABS.filter((tab) => canAccess(tab.access, role));
}

export function isAdminTab(value: unknown): value is AdminTabId {
  return ADMIN_TABS.some((tab) => tab.id === value);
}

/** Where a request for `tab` lands for this role: itself when offered, else the overview. */
export function landingAdminTab(tab: AdminTabId | null, role: Role): AdminTabId {
  return tab && adminTabsFor(role).some((item) => item.id === tab) ? tab : DEFAULT_ADMIN_TAB;
}

/** The address of a section: `adminHref('reports')` → `/admin?tab=reports`; the overview is bare `/admin`. */
export function adminHref(tab?: AdminTabId): string {
  return tab && tab !== DEFAULT_ADMIN_TAB ? `/admin?tab=${tab}` : '/admin';
}
