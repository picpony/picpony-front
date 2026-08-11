'use client';

import { Suspense, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import Skeleton from '@/components/Skeleton';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';

/* One loading shape for all fourteen lazy tabs. Without it, the first switch to
   a tab rendered nothing at all until its chunk arrived — an empty well the height
   of the panel, then a jump. This is the panel's own geometry: a section heading,
   a header row and a run of grouped rows, which is what every tab resolves to.

   It used to call `SkeletonRows`, which emits bare `<tr>`/`<td>` — markup left
   over from when `DataTable` was a real `<table>`. React does not drop those the
   way an HTML parser would; it creates them and the UA stylesheet wraps them in
   an anonymous table box, so the fallback rendered a five-column grid of stubs
   in front of a list that is `.m3-row` blocks. The comment above claimed it was
   the panel's own geometry and it was a different geometry entirely. */
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

const WelcomeTab = dynamic(() => import('@/components/admin/WelcomeTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const GlossaryTab = dynamic(() => import('@/components/admin/GlossaryTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const UsersTab = dynamic(() => import('@/components/admin/UsersTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const NotificationsTab = dynamic(() => import('@/components/admin/NotificationsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const MessagesAuditTab = dynamic(() => import('@/components/admin/MessagesAuditTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BadgesTab = dynamic(() => import('@/components/admin/BadgesTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BlockTagsTab = dynamic(() => import('@/components/admin/BlockTagsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const DeveloperTab = dynamic(() => import('@/components/admin/DeveloperTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const TeamTab = dynamic(() => import('@/components/admin/TeamTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const ShopTab = dynamic(() => import('@/components/admin/ShopTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const ReportsTab = dynamic(() => import('@/components/admin/ReportsTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const BlacklistTab = dynamic(() => import('@/components/admin/BlacklistTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const WealthTab = dynamic(() => import('@/components/admin/WealthTab'), {
  ssr: false,
  loading: AdminTabFallback,
});
const OtherTab = dynamic(() => import('@/components/admin/OtherTab'), {
  ssr: false,
  loading: AdminTabFallback,
});

type TabId =
  | 'welcome'
  | 'glossary'
  | 'users'
  | 'notifications'
  | 'messages'
  | 'reports'
  | 'blacklist'
  | 'shop'
  | 'wealth'
  | 'other'
  | 'badges'
  | 'blocktags'
  | 'developer'
  | 'team';

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  editorOnly?: boolean;
}

const TABS: TabConfig[] = [
  { id: 'welcome', label: '欢迎', icon: <MdDashboard size={20} />, editorOnly: true },
  { id: 'glossary', label: '词库编辑', icon: <MdBook size={20} />, editorOnly: true },
  { id: 'users', label: '用户管理', icon: <MdPeople size={20} />, adminOnly: true },
  {
    id: 'notifications',
    label: '通知管理',
    icon: <MdNotifications size={20} />,
    adminOnly: true,
  },
  { id: 'messages', label: '私信审计', icon: <MdMessage size={20} />, adminOnly: true },
  { id: 'badges', label: '徽章管理', icon: <MdEmojiEvents size={20} />, adminOnly: true },
  { id: 'blocktags', label: '屏蔽标签', icon: <MdShield size={20} />, adminOnly: true },
  { id: 'developer', label: '开发者', icon: <MdBuild size={20} />, adminOnly: true },
  { id: 'team', label: '团队管理', icon: <MdPeople size={20} />, adminOnly: true },
  { id: 'shop', label: '商店管理', icon: <MdStore size={20} />, adminOnly: true },
  { id: 'reports', label: '举报处理', icon: <MdReport size={20} />, adminOnly: true },
  { id: 'blacklist', label: '屏蔽图库', icon: <MdBlock size={20} />, adminOnly: true },
  { id: 'wealth', label: '经验金币', icon: <MdAttachMoney size={20} />, superAdminOnly: true },
  { id: 'other', label: '其他功能', icon: <MdBuild size={20} />, adminOnly: true },
];

/** The tab `/admin` with no `?tab=` lands on, and the one that is spelled by
 *  its absence — same rule the home tabs use for 图库. */
const DEFAULT_TAB: TabId = 'welcome';

/**
 * Long enough to sit past the pane's own fade (`--animate-page-transition`,
 * 80ms delay + 320ms), for the same reason the home tab bar defers its push:
 * an RSC navigation lands as a commit, and in the middle of the swap that is a
 * dropped frame. Nothing here is waiting for the URL — `pendingTab` owns what
 * is on screen — so the only cost of deferring is how soon the address bar
 * agrees. It also swallows a run down the sidebar into a single push rather
 * than one history entry per tab passed through.
 */
const TAB_PUSH_COALESCE_MS = 400;

function readAdminIdentity(): { userRole: string; token: string } {
  const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user_info') : null;
  if (storedUser) {
    try {
      const user = JSON.parse(storedUser);
      return { userRole: user.role || 'user', token: user.token || '' };
    } catch {
      // ignore
    }
  }
  return { userRole: 'user', token: '' };
}

function AdminPanel() {
  const router = useRouter();
  const searchParams = useBackgroundSearchParams();
  const [{ userRole, token }] = useState(readAdminIdentity);
  const [isLoading] = useState(false);

  const isEditor = userRole === 'editor';
  const isAdmin = ['super_admin', 'admin'].includes(userRole);
  const isSuperAdmin = userRole === 'super_admin';
  const visibleTabs = TABS.filter((tab) => {
    if (isEditor) return tab.editorOnly;
    if (tab.superAdminOnly) return isSuperAdmin;
    if (tab.adminOnly) return isAdmin;
    return true;
  });

  /* The tab the URL is asking for. An unknown name, or one this role cannot
     see, falls back rather than erroring — a bookmarked `?tab=wealth` kept by
     someone who has since lost super-admin should still open the panel. */
  const tabParam = searchParams.get('tab');
  const urlTab: TabId =
    visibleTabs.find((tab) => tab.id === tabParam)?.id ?? visibleTabs[0]?.id ?? DEFAULT_TAB;

  /* Optimistic tab, so a click paints immediately. `router.push` only changes
     the search params, but that is still an RSC navigation, and waiting for it
     would leave the sidebar highlighting the tab you just left for as long as
     the round trip takes — made worse by the coalescing window below. */
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const [isNavigating, startNavigation] = useTransition();
  const activeTab = pendingTab ?? urlTab;

  /* Adjust-during-render: hand control back to the URL once it has *finished*
     catching up. `isNavigating` is what distinguishes that from the URL merely
     passing through this tab on its way to a later one in the same burst. */
  if (pendingTab && pendingTab === urlTab && !isNavigating) setPendingTab(null);

  const pushTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    },
    [],
  );

  const handleTabChange = (tabId: TabId) => {
    if (tabId === activeTab) return;
    setPendingTab(tabId);

    const params = new URLSearchParams(searchParams.toString());
    if (tabId === DEFAULT_TAB) params.delete('tab');
    else params.set('tab', tabId);
    const qs = params.toString();
    const href = qs ? `/admin?${qs}` : '/admin';

    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = null;
    /* A burst that comes back to the tab the URL already names needs no push —
       and has to cancel the one it queued on the way out, or that lands as a
       second history entry for the page we never left. Only while nothing is in
       flight, though: a push that has already started will move the URL off
       this tab, and then it is exactly the push that has to put it back. */
    if (tabId === urlTab && !isNavigating) return;

    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      /* `scroll: false`: the panel is one screen with a sidebar beside it, so
         there is no new segment to scroll to — only the reading position of
         whatever list you were in to lose. */
      startNavigation(() => router.push(href, { scroll: false }));
    }, TAB_PUSH_COALESCE_MS);
  };

  if (isLoading) {
    return null;
  }
  if (!isAdmin && !isEditor) {
    return (
      <ErrorRetry size="page" title="没有访问权限" message="您没有权限访问此页面" />
    );
  }
  return (
    <div className="max-w-6xl mx-auto">
      {' '}
      {/* `surface-container-low`, not `surface`. The app scroller behind this is
          itself `bg-surface`, so a panel painted the same tone was a card the
          exact colour of the page it sits on — the `rounded-md overflow-hidden`
          reaching for a raised block and clipping nothing anyone could see. It
          is the same fault the layout note in AGENTS.md records for /settings'
          six invisible section wrappers. */}
      <div className="bg-surface-container-low rounded-md overflow-hidden flex flex-col md:flex-row">
        {' '}
        <div className="md:w-48 shrink-0 border-b md:border-b-0 border-outline-variant">
          {' '}
          <nav className="flex md:flex-col p-2 gap-1 overflow-x-auto scrollbar-hide">
            {' '}
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                data-ripple
                aria-current={activeTab === tab.id}
                className={`group flex items-center gap-2 rounded-full px-3 py-3 text-label-l transition-ui whitespace-nowrap shrink-0 outline-none focus-visible:ring-2 focus-ring ${
                  activeTab === tab.id
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant state-layer'
                }`}
              >
                {/* `standard`, not `spring`: the active icon *stays* scaled, and
                    `--ease-spring` overshoots past 110% and settles back — which
                    reads as a wobble on arrival rather than as a state change.
                    `motion-reduce` because a named `transition-transform` is not
                    covered by the keyframe enumeration. */}
                <span
                  className={`shrink-0 transition-transform duration-300 ease-[var(--ease-standard)] motion-reduce:transition-none ${
                    activeTab === tab.id ? 'scale-110' : 'group-hover:scale-105'
                  }`}
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex-1 p-4 sm:p-6 min-h-96 md:min-h-150 relative">
          {/* A fade, and deliberately *not* the tab shared axis.
              `TabPanes` needs both panes alive to slide one out as the other comes
              in, and these fourteen are `dynamic(..., { ssr: false })` — keeping
              them mounted would mount fourteen admin tabs at once, each with its
              own fetch. So the outgoing pane genuinely cannot survive here, and a
              cross-fade is the honest transition for a swap where it can't.

              What was here was `animate-page-transition`, which is the *route*
              animation: `pageIn`, a 12px rise with an 80ms backwards-filled delay,
              designed for a page arriving from another page. On a lateral move
              between siblings it read as the panel dropping in from above.
              `animate-fade-in` is the same 400ms `decelerate` without the travel.

              The `key` stays: it is what restarts the animation on each switch,
              and with `{cond && ...}` mounting there is nothing for it to destroy
              that was not being destroyed anyway. */}
          <div key={activeTab} className="animate-fade-in">
            {activeTab === 'welcome' && <WelcomeTab />}
            {activeTab === 'glossary' && <GlossaryTab />}
            {activeTab === 'users' && <UsersTab token={token} myRole={userRole} />}
            {activeTab === 'notifications' && <NotificationsTab token={token} />}
            {activeTab === 'messages' && <MessagesAuditTab token={token} />}
            {activeTab === 'badges' && <BadgesTab token={token} />}
            {activeTab === 'blocktags' && <BlockTagsTab token={token} />}
            {activeTab === 'developer' && <DeveloperTab token={token} />}
            {activeTab === 'team' && <TeamTab token={token} />}
            {activeTab === 'shop' && <ShopTab token={token} />}
            {activeTab === 'reports' && <ReportsTab token={token} />}
            {activeTab === 'blacklist' && <BlacklistTab token={token} />}
            {activeTab === 'wealth' && <WealthTab token={token} />}
            {activeTab === 'other' && <OtherTab token={token} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    /* `useSearchParams` needs a boundary above it; the fallback is the panel's
       own loading state so the shell does not jump. */
    <Suspense
      fallback={
        /* `AdminTabFallback`, not a centred dot. It is the panel's own
           silhouette and it already exists two functions up — a spinner here
           reflows the whole console when the real panel lands, which is the one
           thing a fallback is for avoiding. */
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <AdminTabFallback />
        </div>
      }
    >
      <AdminPanel />
    </Suspense>
  );
}
