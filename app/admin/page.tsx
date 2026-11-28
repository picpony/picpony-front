'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdDashboard, MdHome } from 'react-icons/md';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import EmptyState from '@/components/EmptyState';
import FollowHeight from '@/components/FollowHeight';
import ScrollArea from '@/components/ScrollArea';
import SignInRequired from '@/components/SignInRequired';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import ButtonLink from '@/components/ButtonLink';
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
    <Suspense
      fallback={
        <ConsoleColumn>
          <ConsoleSkeleton />
        </ConsoleColumn>
      }
    >
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
    <div ref={ref} className="@container mx-auto max-w-6xl">
      <h1 className="sr-only">管理面板</h1>
      {children}
    </div>
  );
}

/** Centred M3E loading indicator while session readiness resolves (may settle to sign-in, refusal or console). */
function ConsoleSkeleton() {
  return <PageLoadingIndicator size="page" holdFooter delay={160} label="正在加载管理面板…" />;
}

function AdminGate() {
  const { user, token, ready } = useSession();
  if (!ready)
    return (
      <ConsoleColumn>
        <ConsoleSkeleton />
      </ConsoleColumn>
    );
  if (!token) {
    return (
      <ConsoleColumn>
        <SignInRequired description="登录管理员或小编账号后即可使用管理面板" />
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
          description="管理面板仅限管理员与小编使用；若权限刚刚变更，请重新登录"
          action={
            <ButtonLink href="/" variant="filled" icon={<MdHome />}>
              回到首页
            </ButtonLink>
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
  /* Our own `replaceAdminAddress` writes echo back through `useSearchParams` asynchronously;
     tracking them in order stops an earlier echo during rapid clicks from reverting a newer tab. */
  const [ownWrites, setOwnWrites] = useState<readonly AdminTabId[]>([]);
  /* A link followed while the console is up selects its section. */
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    const landed = landingAdminTab(requested, role);
    const echo = ownWrites.indexOf(landed);
    if (echo !== -1) {
      setOwnWrites(ownWrites.slice(echo + 1));
    } else {
      if (ownWrites.length > 0) setOwnWrites([]);
      setTab(landed);
    }
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
  /* Drop any coalesced own-write echo once the address already matches the shown section. */
  useEffect(() => {
    if (ownWrites.length === 0 || landingAdminTab(requested, role) !== shown) return;
    const timer = window.setTimeout(() => setOwnWrites([]), 500);
    return () => window.clearTimeout(timer);
  }, [ownWrites.length, requested, role, shown]);
  useEffect(() => dropQueuedAdminAddress, []);

  const select = (next: AdminTabId) => {
    if (next === shown) return;
    setTab(next);
    setOwnWrites((prev) => (prev[prev.length - 1] === next ? prev : [...prev.slice(-7), next]));
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

  const railTabs = (
    <Tabs
      variant="rail"
      orientation={wide ? 'vertical' : 'horizontal'}
      activation="manual"
      label="管理面板分区"
      className="p-2"
      value={shown}
      onChange={select}
      tabs={offered.map((item) => ({
        value: item.id,
        label: item.label,
        icon: item.icon,
        activeIcon: item.activeIcon,
      }))}
    />
  );

  return (
    <ConsoleColumn ref={columnRef}>
      {/* `surface-container-low`, not `surface`: the app scroller behind this is itself
          `bg-surface`, so a panel of the same tone was a card the colour of the page it sits on.
          Nothing inside needs clipping at rest — the horizontal rail scrolls its own row, and
          wide, the vertical rail sticks inside the viewport so 25 sections never stretch a short
          panel into blank space or scroll away while working down a long table. */}
      <div className={`bg-surface-container-low rounded-md flex ${wide ? 'flex-row' : 'flex-col'}`}>
        <div
          className={wide ? 'w-48 shrink-0 border-r border-outline-variant' : 'min-w-0 border-b border-outline-variant'}
        >
          {wide ? (
            <div className="sticky top-4 sm:top-6">
              <ScrollArea
                axis="y"
                viewportClassName="popover-scrollbar max-h-[calc(100dvh-var(--app-chrome-bottom,4rem)-2rem)] overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-var(--app-chrome-bottom,4rem)-3rem)]"
              >
                {railTabs}
              </ScrollArea>
            </div>
          ) : (
            railTabs
          )}
        </div>
        {/* The window a section switch slides past (`data-tab-window`): the panel's own region,
            not the scroller — sliding the scroller's width swept the panes across the rail and out
            past the card. The sections' own sub-tabs slide past it too. */}
        <div data-tab-window="" className={`min-w-0 flex-1 p-4 sm:p-6 ${wide ? 'min-h-150' : 'min-h-96'}`}>
          {/* The card's height follows the section on screen instead of jumping to it. A switch
              stacks both panes in one cell for its run and conceals the leaving one at settle — by
              attribute, outside React — and a section's first read swaps its skeleton for rows of
              another height; each of those snapped the card's bottom edge (and the page under it)
              by the difference in one frame. `track` follows every such change, not only commits. */}
          <FollowHeight track>
            <TabPanes value={shown}>
              {offered.map(({ id, component: Panel }) =>
                visited.has(id) ? (
                  <TabPane key={id} value={id}>
                    <Panel token={token} role={role} viewerId={viewerId} openTab={select} />
                  </TabPane>
                ) : null,
              )}
            </TabPanes>
          </FollowHeight>
        </div>
      </div>
    </ConsoleColumn>
  );
}
