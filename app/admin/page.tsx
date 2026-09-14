'use client';

import { Suspense, useRef, type ComponentType, type ReactNode } from 'react';
import {
  MdBook,
  MdDashboard,
  MdPeople,
  MdNotifications,
  MdMessage,
  MdEmojiEvents,
  MdShield,
  MdBuild,
  MdStore,
  MdReport,
  MdBlock,
  MdAttachMoney,
} from 'react-icons/md';
import dynamic from 'next/dynamic';
import ErrorRetry from '@/components/ErrorRetry';
import Tabs from '@/components/Tabs';
import { tabId, tabPanelId } from '@/components/TabPanes';
import Skeleton from '@/components/Skeleton';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import { ICON } from '@/lib/icons';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';
import { useSession } from '@/lib/hooks';

/* One loading shape for all fourteen lazy tabs — without it, the first switch to a tab
   rendered an empty well the height of the panel until its chunk arrived. This is the
   panel's own geometry: a section heading, a header row, a run of grouped rows. */
function AdminTabFallback() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-40" />
      <div>
        <div className="m3-row bg-surface-container-high px-4 py-3">
          <Skeleton className="h-4 w-32" />
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container-low p-4">
            <Skeleton className="h-4 w-2/5" delay={i * 80} />
            <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
            <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface AdminPanelProps {
  token: string;
  myRole: string;
}

const WelcomeTab = dynamic<AdminPanelProps>(() => import('@/components/admin/WelcomeTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const GlossaryTab = dynamic<AdminPanelProps>(() => import('@/components/admin/GlossaryTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const UsersTab = dynamic<AdminPanelProps>(() => import('@/components/admin/UsersTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const NotificationsTab = dynamic<AdminPanelProps>(() => import('@/components/admin/NotificationsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const MessagesAuditTab = dynamic<AdminPanelProps>(() => import('@/components/admin/MessagesAuditTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BadgesTab = dynamic<AdminPanelProps>(() => import('@/components/admin/BadgesTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BlockTagsTab = dynamic<AdminPanelProps>(() => import('@/components/admin/BlockTagsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const DeveloperTab = dynamic<AdminPanelProps>(() => import('@/components/admin/DeveloperTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const TeamTab = dynamic<AdminPanelProps>(() => import('@/components/admin/TeamTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const ShopTab = dynamic<AdminPanelProps>(() => import('@/components/admin/ShopTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const ReportsTab = dynamic<AdminPanelProps>(() => import('@/components/admin/ReportsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BlacklistTab = dynamic<AdminPanelProps>(() => import('@/components/admin/BlacklistTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const WealthTab = dynamic<AdminPanelProps>(() => import('@/components/admin/WealthTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const OtherTab = dynamic<AdminPanelProps>(() => import('@/components/admin/OtherTab'), {
  ssr: false,
  loading: AdminTabFallback,
});

interface TabConfig {
  id: string;
  label: string;
  icon: ReactNode;
  access: 'staff' | 'admin' | 'super_admin';
  component: ComponentType<AdminPanelProps>;
}

/** Navigation, access and the lazy panel share one entry per destination. */
const TABS = [
  { id: 'welcome', label: '欢迎', icon: <MdDashboard size={ICON.control} />, access: 'staff', component: WelcomeTab },
  { id: 'glossary', label: '词库编辑', icon: <MdBook size={ICON.control} />, access: 'staff', component: GlossaryTab },
  { id: 'users', label: '用户管理', icon: <MdPeople size={ICON.control} />, access: 'admin', component: UsersTab },
  {
    id: 'notifications',
    label: '通知管理',
    icon: <MdNotifications size={ICON.control} />,
    access: 'admin',
    component: NotificationsTab,
  },
  { id: 'messages', label: '私信审计', icon: <MdMessage size={ICON.control} />, access: 'admin', component: MessagesAuditTab },
  { id: 'badges', label: '徽章管理', icon: <MdEmojiEvents size={ICON.control} />, access: 'admin', component: BadgesTab },
  { id: 'blocktags', label: '屏蔽标签', icon: <MdShield size={ICON.control} />, access: 'admin', component: BlockTagsTab },
  { id: 'developer', label: '开发者', icon: <MdBuild size={ICON.control} />, access: 'admin', component: DeveloperTab },
  { id: 'team', label: '团队管理', icon: <MdPeople size={ICON.control} />, access: 'admin', component: TeamTab },
  { id: 'shop', label: '商店管理', icon: <MdStore size={ICON.control} />, access: 'admin', component: ShopTab },
  { id: 'reports', label: '举报处理', icon: <MdReport size={ICON.control} />, access: 'admin', component: ReportsTab },
  { id: 'blacklist', label: '屏蔽图库', icon: <MdBlock size={ICON.control} />, access: 'admin', component: BlacklistTab },
  { id: 'wealth', label: '经验金币', icon: <MdAttachMoney size={ICON.control} />, access: 'super_admin', component: WealthTab },
  { id: 'other', label: '其他功能', icon: <MdBuild size={ICON.control} />, access: 'admin', component: OtherTab },
] as const satisfies readonly TabConfig[];

type TabId = (typeof TABS)[number]['id'];

/** The tab bare `/admin` lands on — the one spelled by `?tab=`'s absence, same rule
 *  the home tabs use for 图库. */
const DEFAULT_TAB: TabId = 'welcome';

/** Rapid changes replace the latest tab entry; the first change remains undoable. */
const TAB_PUSH_COALESCE_MS = Math.round(400 * MOTION_SPEED_SCALE.slow);

function AdminPanel() {
  const searchParams = useBackgroundSearchParams();
  const { user, token: sessionToken, ready } = useSession();
  const userRole = typeof user?.role === 'string' ? user.role : 'user';
  const token = sessionToken ?? '';

  const isEditor = userRole === 'editor';
  const isAdmin = ['super_admin', 'admin'].includes(userRole);
  const isSuperAdmin = userRole === 'super_admin';
  const visibleTabs = TABS.filter((tab) =>
    tab.access === 'staff' || (tab.access === 'admin' ? isAdmin : isSuperAdmin));

  /* The tab the URL asks for. An unknown name, or one this role cannot see, falls back
     rather than erroring — a bookmarked `?tab=wealth` kept by someone who has since
     lost super-admin should still open the panel. */
  const tabParam = searchParams.get('tab');
  const selectedTab = visibleTabs.find((tab) => tab.id === tabParam) ?? visibleTabs[0] ?? TABS[0];
  const activeTab = selectedTab.id;
  const ActivePanel = selectedTab.component;
  const lastTabWrite = useRef<{ at: number; href: string } | null>(null);

  const handleTabChange = (tabId: TabId) => {
    if (tabId === activeTab) return;
    const params = new URLSearchParams(window.location.search);
    if (tabId === DEFAULT_TAB) params.delete('tab');
    else params.set('tab', tabId);
    const qs = params.toString();
    const href = qs ? `/admin?${qs}` : '/admin';

    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (href === currentHref) return;
    const now = performance.now();
    const previous = lastTabWrite.current;
    const withinBurst = previous !== null && previous.href === currentHref &&
      now - previous.at < TAB_PUSH_COALESCE_MS;
    // Native history is synchronous and does not start an RSC request that can
    // overtake a route the user opens immediately after selecting a tab.
    window.history[withinBurst ? 'replaceState' : 'pushState'](null, '', href);
    lastTabWrite.current = { at: now, href };
  };

  if (!ready) {
    return <AdminTabFallback />;
  }
  if (!isAdmin && !isEditor) {
    return (
      <ErrorRetry size="page" title="没有访问权限" message="您没有权限访问此页面" />
    );
  }
  return (
    <div className="max-w-6xl mx-auto">
      {/* `surface-container-low`, not `surface`: the app scroller behind this is itself
          `bg-surface`, so a panel painted the same tone was a card the exact colour of
          the page it sits on. Same fault AGENTS.md's layout note records for /settings'
          six invisible section wrappers. */}
      <div className="bg-surface-container-low rounded-md overflow-hidden flex flex-col md:flex-row">
        
        <div className="md:w-48 shrink-0 border-b md:border-b-0 border-outline-variant">
          {/* `Tabs variant="rail"`, not a hand-rolled pill list: this was one of the app's
              four tab implementations and declared no ARIA roles — fourteen destinations a
              screen reader read as a run of buttons, no arrow keys, no current-tab
              statement beyond `aria-current` on a control that is not a link. The icon's
              active `scale-110` is gone with it: not something M3 does to a navigation
              item, and the row already says "current" with a container pair. */}
          <Tabs
            variant="rail"
            label="管理面板分区"
            className="p-2"
            value={activeTab}
            onChange={handleTabChange}
            tabs={visibleTabs.map((tab) => ({
              value: tab.id,
              label: tab.label,
              icon: tab.icon,
            }))}
          />
        </div>
        <div className="flex-1 p-4 sm:p-6 min-h-96 md:min-h-150 relative">
          {/* A fade, deliberately not the tab shared axis: `TabPanes` needs both panes
              alive to slide, and these fourteen are `dynamic(..., { ssr: false })` — keeping
              them mounted would mount fourteen admin tabs, each with its own fetch. The
              outgoing pane genuinely cannot survive here.

              What was here was `animate-page-transition` — the *route* animation, a 12px
              rise with an 80ms backwards-filled delay — which on a lateral move between
              siblings read as the panel dropping in from above. `animate-fade-in` is the
              same 400ms `decelerate` without the travel. The `key` stays: it restarts the
              animation on each switch and resets form state when the account changes.

              It carries the panel half of `role="tab"`'s contract itself — one panel,
              re-identified as the active tab changes, so the selected tab's
              `aria-controls` always resolves. */}
          <div
            key={`${token}:${activeTab}`}
            id={tabPanelId(activeTab)}
            role="tabpanel"
            aria-labelledby={tabId(activeTab)}
            tabIndex={0}
            className="animate-fade-in"
          >
            <ActivePanel token={token} myRole={userRole} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    /* `useSearchParams` needs a boundary above it; the fallback is the panel's own
       loading state so the shell does not jump. */
    <Suspense
      fallback={
        /* `AdminTabFallback`, not a centred dot — it is the panel's own silhouette and
           already exists two functions up. No padding of its own: `[data-page-content]`
           is already `p-4 sm:p-6` and the real console takes none, so padding here
           insetting the fallback 32/48px made the console shift on arrival. */
        <div className="mx-auto max-w-6xl">
          <AdminTabFallback />
        </div>
      }
    >
      <AdminPanel />
    </Suspense>
  );
}
