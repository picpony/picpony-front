'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MdDashboard, MdHome } from 'react-icons/md';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import EmptyState from '@/components/EmptyState';
import SignInRequired from '@/components/SignInRequired';
import { buttonClasses } from '@/components/buttonStyles';
import { ICON } from '@/lib/icons';
import { useSession } from '@/lib/hooks';
import type { Role } from '@/lib/roles';
import { useBackgroundSearchParams } from '@/components/BackgroundLocation';
import {
  adminRole,
  adminTabsFor,
  DEFAULT_ADMIN_TAB,
  isAdminTab,
  landingAdminTab,
  type AdminTabId,
} from '@/components/admin/registry';
import AdminPaneSkeleton from '@/components/admin/AdminPaneSkeleton';
import { dropQueuedAdminAddress, replaceAdminAddress } from './address';

/**
 * /admin — the console.
 *
 * Three states, each with a way forward (R9-001). **No session**: the shared 需要登录 block with a
 * 登录 button (owner decision 4 — a gated page never opens the dialog by itself). **Signed in
 * without a staff role**: 没有访问权限, an `EmptyState` rather than the failure preset, with a way
 * back to the app — a refusal, not a broken page. **Staff**: the console.
 *
 * The rail is one `Tabs` (`variant="rail"`, `activation="manual"` — R9-004: arrows move focus only,
 * so arrowing through the sections starts no reads) and the panes are `TabPanes` without `lean`
 * (decision 25: a work tool). A panel stays mounted once visited, so returning to a section keeps
 * its half-filled form and its place; a never-visited panel is not mounted at all.
 *
 * The section is named in the address with `replaceState` (decision 18, the /settings pattern): a
 * reload or a shared link opens it, and Back leaves the console rather than walking the sections.
 */
export default function AdminPage() {
  return (
    /* `useSearchParams` needs a boundary above it; the fallback is the console's own arrival
       state, so the shell does not jump. */
    <Suspense fallback={<ConsoleColumn><AdminPaneSkeleton /></ConsoleColumn>}>
      <AdminGate />
    </Suspense>
  );
}

/**
 * The console's column, and the route's heading in every state — signed out, refused and loading as
 * well as staff (G4-005: only the staff branch had it). The rail names the sections, so the page's
 * own name serves the outline and is where focus lands after a navigation (R3-042).
 */
function ConsoleColumn({ children, ref }: { children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="mx-auto max-w-6xl">
      <h1 className="sr-only">管理面板</h1>
      {children}
    </div>
  );
}

function AdminGate() {
  const { user, token, ready } = useSession();
  if (!ready) return <ConsoleColumn><AdminPaneSkeleton /></ConsoleColumn>;
  if (!token) {
    return (
      <ConsoleColumn>
        <SignInRequired description="登录管理员或小编账号后即可使用管理面板。" />
      </ConsoleColumn>
    );
  }
  const role = adminRole(user?.role);
  if (role === 'user') {
    return (
      <ConsoleColumn>
        <EmptyState
          icon={<MdDashboard size={ICON.display} />}
          title="没有访问权限"
          description="管理面板仅对管理员与小编开放。权限刚刚变更的话，重新登录后再试。"
          action={
            <Link scroll={false} href="/" className={buttonClasses({ variant: 'filled' })}>
              <MdHome size={ICON.dense} aria-hidden="true" />
              回到首页
            </Link>
          }
        />
      </ConsoleColumn>
    );
  }
  /* One console per account: a sign-in in another tab starts every panel afresh. */
  return <AdminConsole key={token} token={token} role={role} viewerId={Number(user?.id) || 0} />;
}

/** 12rem of rail, 3rem of panel insets and 33rem for the panel itself. */
const SPLIT_MIN_REM = 48;

function AdminConsole({ token, role, viewerId }: { token: string; role: Role; viewerId: number }) {
  const offered = adminTabsFor(role);
  const tabParam = useBackgroundSearchParams().get('tab');
  const requested = isAdminTab(tabParam) ? tabParam : null;

  const [tab, setTab] = useState<AdminTabId>(() => landingAdminTab(requested, role));
  /* A link followed while the console is up selects its section. */
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    setTab(landingAdminTab(requested, role));
  }
  /* Never a section the role is not offered: a bookmarked `?tab=wealth` kept by someone who has
     since lost 创始人 lands on the overview. */
  const shown = landingAdminTab(tab, role);
  if (shown !== tab) setTab(shown);

  const [visited, setVisited] = useState<ReadonlySet<AdminTabId>>(() => new Set([shown]));
  if (!visited.has(shown)) setVisited(new Set([...visited, shown]));

  /* The address names the section on screen: corrected in place when it names one this role is
     not offered (or nothing it knows), kept bare for the overview. */
  useEffect(() => {
    if (tabParam === null && shown === DEFAULT_ADMIN_TAB) return;
    if (requested === shown) return;
    replaceAdminAddress(shown);
  }, [shown, requested, tabParam]);
  useEffect(() => dropQueuedAdminAddress, []);

  const select = (next: AdminTabId) => {
    setTab(next);
    replaceAdminAddress(next);
  };

  /* The split follows the console's own width — the docked drawer takes width the viewport cannot
     see — and the rail's orientation is a keyboard contract, so it is decided here rather than by a
     container query alone. */
  const columnRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setWide(column.clientWidth >= SPLIT_MIN_REM * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  return (
    <ConsoleColumn ref={columnRef}>
      {/* `surface-container-low`, not `surface`: the app scroller behind this is itself
          `bg-surface`, so a panel of the same tone was a card the colour of the page it sits on.
          Nothing inside needs clipping — the horizontal rail scrolls its own row. */}
      <div className={`bg-surface-container-low rounded-md flex ${wide ? 'flex-row' : 'flex-col'}`}>
        <div className={wide ? 'w-48 shrink-0' : 'min-w-0 border-b border-outline-variant'}>
          <Tabs
            variant="rail"
            orientation={wide ? 'vertical' : 'horizontal'}
            activation="manual"
            label="管理面板分区"
            className="p-2"
            value={shown}
            onChange={select}
            tabs={offered.map((item) => ({ value: item.id, label: item.label, icon: item.icon }))}
          />
        </div>
        <div className={`min-w-0 flex-1 p-4 sm:p-6 ${wide ? 'min-h-150' : 'min-h-96'}`}>
          <TabPanes value={shown}>
            {offered.map(({ id, component: Panel }) =>
              visited.has(id) ? (
                <TabPane key={id} value={id}>
                  <Panel token={token} role={role} viewerId={viewerId} openTab={select} />
                </TabPane>
              ) : null,
            )}
          </TabPanes>
        </div>
      </div>
    </ConsoleColumn>
  );
}
