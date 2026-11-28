'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import ErrorRetry from '@/components/ErrorRetry';
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
 * Panels load lazily on first visit through a plain client loader rather than `next/dynamic`:
 * `next/dynamic` wraps `React.lazy` in `<Suspense>`, whose 300ms fallback throttle in React 19
 * held `AdminPaneSkeleton` on screen long after fast chunks had arrived, causing the pane-level
 * indicator to appear and then jump down into the panel's own table/settings indicator the moment
 * the panel mounted.
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
  /** Rest state — the section's outlined mark, or its filled one where Material has no pair. */
  icon: ReactNode;
  /** Selected state: the filled mark the panel's own heading also shows. */
  activeIcon: ReactNode;
  access: AdminAccess;
  component: ComponentType<AdminPanelProps>;
}

const panel = (
  load: () => Promise<{ default: ComponentType<AdminPanelProps> }>,
  label: string,
): ComponentType<AdminPanelProps> => {
  let loaded: ComponentType<AdminPanelProps> | null = null;
  let pending: Promise<ComponentType<AdminPanelProps>> | null = null;
  const loadOnce = () => {
    if (loaded) return Promise.resolve(loaded);
    if (!pending) {
      pending = load().then(
        (mod) => {
          if (!mod?.default) {
            pending = null;
            throw new Error(`Missing admin panel export for ${label}`);
          }
          loaded = mod.default;
          pending = null;
          return loaded;
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };
  return function LazyAdminPanel(props: AdminPanelProps) {
    const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(() => (loaded ? 'ready' : 'loading'));
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      if (status !== 'loading') return;
      let alive = true;
      void loadOnce().then(
        () => {
          if (alive) setStatus('ready');
        },
        () => {
          if (alive) setStatus('failed');
        },
      );
      return () => {
        alive = false;
      };
    }, [status, attempt]);

    if (status === 'ready' && loaded) {
      const Panel = loaded;
      return <Panel {...props} />;
    }
    if (status === 'failed') {
      return (
        <ErrorRetry
          size="pane"
          title={`${label}加载失败`}
          message="页面模块未能载入，请检查网络后重试"
          onRetry={() => {
            setStatus('loading');
            setAttempt((count) => count + 1);
          }}
        />
      );
    }
    return <AdminPaneSkeleton label={`正在加载${label}…`} />;
  };
};

/* Rail glyphs at 24dp: a rail tab is a navigation row (`ICON.standard`, the `Tabs` rail's size). */
const icon = (Glyph: ComponentType<{ size?: number }>) => <Glyph size={ICON.standard} />;

/**
 * A rail entry: its name and both marks come from `ADMIN_SECTIONS`, which the panel's heading reads
 * too. The outlined form is the rest state, the filled one the selected state — a navigation row
 * that only thickens once it is chosen, as `SidebarNav` does. Nine sections have no second weight
 * in Material Icons (listed in `sections.ts`) and pass the same glyph twice.
 */
const entry = <const Id extends AdminSectionId>(
  id: Id,
  access: AdminAccess,
  load: () => Promise<{ default: ComponentType<AdminPanelProps> }>,
) => {
  const section = ADMIN_SECTIONS[id];
  return {
    id,
    label: section.label,
    /* `in`: the nine sections with no second weight do not declare `outline` at all. */
    icon: icon('outline' in section ? section.outline : section.glyph),
    activeIcon: icon(section.glyph),
    access,
    component: panel(load, section.label),
  };
};

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
  entry('text-translation', 'admin', () => import('./siteTools/TextTranslationTab')),
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
