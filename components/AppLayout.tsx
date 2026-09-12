'use client';

import {
  useState,
  FormEvent,
  Suspense,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import {
  MdMenu,
  MdSearch,
  MdNotifications,
  MdDarkMode,
  MdLightMode,
  MdPhotoLibrary,
  MdForum,
  MdBrightnessAuto,
} from 'react-icons/md';

import dynamic from 'next/dynamic';
import { ICON } from '@/lib/icons';
const AnnouncementModal = dynamic(() => import('./AnnouncementModal'), { ssr: false });
const Modal = dynamic(() => import('./Modal'), { ssr: false });
import Logo from './Logo';
import Avatar from './Avatar';
import { CountBadge } from './Badge';
import DevBanner from './DevBanner';
import SidebarNav from './SidebarNav';
import { useAuthModal } from './AuthModal';
import { BackgroundLocationProvider, useBackgroundSearchParams } from './BackgroundLocation';
import { bindResourceRefresh, clearAllResources, SKIP, useResource } from '@/lib/resource';
import { clearScreenState } from '@/lib/screenState';
import { markAppPainted } from '@/lib/splash';
import { clearSnapshots } from '@/lib/pageCache';
import { sessionUser, unreadCounts } from '@/lib/resources';
import {
  getImageHeroRuntime,
  getImageHeroBackgroundLocation,
  initializeImageHeroHistory,
  subscribeImageHeroRuntime,
} from '@/lib/hero';
import HeroStage from '@/components/HeroStage';
import Badge from '@/components/Badge';
import RouteCrossFade from '@/components/RouteCrossFade';
import { warmRouteCrossFade } from '@/lib/routeCrossFade';
import RouteScrollMemory from '@/lib/scrollMemory';
import Button from '@/components/Button';
import Tabs from '@/components/Tabs';
import IconButton, { iconButtonClasses } from '@/components/IconButton';
/* Through the lazy facade, not `lib/motion` directly: that module registers GSAP and
   five plugins at module scope, and this component wraps every route. Each entry point
   falls back to the 关闭 tier's own behaviour until the chunk lands. See `lib/motionLazy.tsx`. */
import {
  changeScheme,
  DrawerSwipe,
  setTabIntent,
  startTabTransition,
  warmMotion,
} from '@/lib/motionLazy';
import {
  MOTION_SPEED_SCALE,
  refreshSystemMotion,
  useScheme,
  useSchemeSetting,
  type SchemeSetting,
} from '@/lib/appearance';
import { clearUserInfo, readToken, readUserInfo, updateUserInfo, useMediaQuery, useSession } from '@/lib/hooks';
import { ensureRoutePolicy, setLineNotifier } from '@/lib/route';
import { showToast } from '@/components/Toast';
import { cn, runWhenIdle } from '@/lib/utils';
import { COOKIE_KEYS, LS_KEYS, MEDIA } from '@/lib/constants';
import { useOverlayLayer, useScrollLock } from '@/lib/overlay';

function SearchBar() {
  const router = useRouter();

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    router.push('/search', { scroll: false });
  };

  return (
    <form onSubmit={handleSearch} className="flex shrink-0">
      {/* `type="submit"` is why this is an `IconButton` rather than a `Link`: the form
          owns the navigation. `md` + `touch-size` matches the other bar controls, and
          the Suspense fallback must reserve exactly this box. */}
      <IconButton
        type="submit"
        variant="on-primary"
        size="md"
        className="touch-size"
        aria-label="搜索"
        icon={<MdSearch size={ICON.standard} />}
      />
    </form>
  );
}

interface UserInfo {
  id?: number;
  username: string;
  avatar: string;
  role: string;
  token: string;
  level?: number;
  derpi_username?: string;
}

/**
 * How long to wait before committing the tab to the URL.
 *
 * Sits past the end of the slide (`DURATION.emphasized` is 500ms, plus stagger), so the
 * push — a React commit and an RSC navigation, two ~40ms frames measured mid-slide —
 * never lands inside the travel. It also swallows a burst of taps into one push.
 * Scaled by the *slowest* speed rather than held at 520: the slide's clock goes through
 * `--motion-scale`, so at 缓慢 it settles at ~722ms and a fixed 520ms push would land
 * ~200ms inside the travel. Pushing later costs nothing; nothing on screen waits for it.
 */
const TAB_PUSH_COALESCE_MS = Math.round(520 * MOTION_SPEED_SCALE.slow);

function TabNavBar({ hidden }: { hidden: boolean }) {
  const searchParams = useBackgroundSearchParams();
  const currentTab = searchParams.get('tab') === 'forum' ? 'forum' : 'gallery';
  // Optimistic tab so the pill and label colors respond on click, before the
  // route (and its search params) actually commit.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? currentTab;

  /* Whether a tab navigation we started is still on its way. `router.push` is
     run inside this transition purely so React will tell us — it is the only
     signal that distinguishes "the URL agrees with the user" from "the URL is
     briefly agreeing on its way somewhere else". */
  /* **The URL is written on the tap, synchronously, and a burst replaces rather than
     accumulates.** No queue, no timer. The former deferred `router.push` made a tab
     change an RSC navigation that could land *after* some other navigation the user had
     started and overwrite it (measured: tapping 论坛 then opening a thread 200ms later
     gave three different answers over five runs); cancelling the queue on unmount did
     not fix it — the timer still fired inside the other navigation's commit.
     `history.pushState`/`replaceState` are integrated into Next's router and sync
     `useSearchParams`, so the panes and pill still see the change, nothing is started,
     nothing can race, and a tab switch stops costing an RSC round trip. The coalescing
     window survives as the push-vs-replace decision: the first change in a burst adds a
     history entry, the rest rewrite it. */
  const lastTabWrite = useRef(0);

  /* The panes see only the URL. It no longer *lags* — `switchTab` writes it synchronously — but
     `useSearchParams` still propagates on the router's own schedule, so during a burst there is a
     commit or two where the panes would otherwise animate towards a tab the user has already left.
     Hand them the tab the user is really on. Cleared on unmount, which is what keeps an intent from
     outliving the home route. */
  useEffect(() => {
    setTabIntent(pendingTab);
    return () => setTabIntent(null);
  }, [pendingTab]);

  /* **The optimistic tab must not outlive the URL catching up, in either direction.**
     `pendingTab` only covers the commits between the synchronous `history.pushState` and
     `useSearchParams` propagating. Left stale it is worse than useless: tap 论坛 then
     press Back — the URL returns to `/` but `setTabIntent` keeps reporting forum, so
     `useTabPanesOn` bails before `clearPaneFlags`, leaving the gallery pane hidden on a
     stale flag, the forum pane on screen, the pill on 论坛, and tapping 论坛 a no-op.
     Keyed on `currentTab` alone, so it fires whether the URL caught up with the tap or
     moved somewhere else; either way the optimistic value has done its job.
     `queueMicrotask` satisfies `react-hooks/set-state-in-effect`; on mount it writes
     null over null, which React bails out of. */
  useEffect(() => {
    queueMicrotask(() => setPendingTab(null));
  }, [currentTab]);


  const switchTab = (tab: string) => {
    if (tab === activeTab) return;
    setPendingTab(tab);
    /* Both panes are already mounted, so the transition does not need the route — only
       the attribute that gives the incoming pane a box, which it sets itself. Gallery
       sits left of forum, so moving right sends the outgoing pane left. */
    /* `lean` on — the one bar in the app that gets it. The wave is sampled over the
       blocks *inside* each pane, which needs those blocks to survive the run: true here
       because the forum pane is mounted ahead of the tap on an idle callback. The
       counter-example is `/messages`, whose panes fetch on selection — it must stay
       without it. */
    startTabTransition(activeTab, tab, tab === 'forum' ? 1 : -1, true);

    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'gallery') params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    const href = qs ? `/?${qs}` : '/';

    const now = performance.now();
    const withinBurst = now - lastTabWrite.current < TAB_PUSH_COALESCE_MS;
    lastTabWrite.current = now;
    if (href !== `${window.location.pathname}${window.location.search}`) {
      window.history[withinBurst ? 'replaceState' : 'pushState'](null, '', href);
    }
  };

  return (
    /* Kept mounted while an image-detail overlay is open rather than unmounted:
       the sliding indicator measures its target on mount, and unmounting it makes the
       pill jump back to x=0 mid-flight. The fade mirrors the hero flight's 200ms
       card-chrome fade — leave on `accelerate`, return on the arrival row (a one-sided
       curve needs one per direction). `z-page-chrome` keeps it under the drawer scrim:
       the host `<section>` is positioned but not a stacking context, so the pill's z
       competes directly with the shell's. See the stacking-order block in globals.css. */
    <div
      data-image-detail-chrome
      data-chrome-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-page-chrome flex items-center justify-center py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,translate] ${
        hidden
          ? 'translate-y-2 opacity-0 duration-exit ease-[var(--ease-accelerate)]'
          : 'translate-y-0 opacity-100 duration-enter ease-[var(--ease-decelerate)]'
      }`}
    >
      {/* `Tabs variant="pill"`, not a hand-rolled segmented control — the primitive owns
          the ARIA roles, the keyboard contract, the sliding indicator and the elevation.
          What stays here is what is genuinely this screen's: the optimistic tab, the
          coalesced push and the hide-while-flying wrapper. */}
      <Tabs
        className="pointer-events-auto"
        label="首页分区"
        value={activeTab}
        onChange={switchTab}
        variant="pill"
        tabs={[
          { value: 'gallery', label: '图库', icon: <MdPhotoLibrary size={ICON.control} /> },
          { value: 'forum', label: '论坛', icon: <MdForum size={ICON.control} /> },
        ]}
      />
    </div>
  );
}

export default function AppLayout({
  children,
  overlay,
  initialCollapsed,
}: {
  children: React.ReactNode;
  overlay: React.ReactNode;
  initialCollapsed: boolean;
}) {
  // Keep the first client render identical to SSR. Browser-only sources
  // (viewport, localStorage) are applied after mount to avoid hydration mismatch.
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);

  /* The colour scheme is not local state. It is two localStorage keys, a cookie and a
     class on `<html>`, all owned by `lib/appearance`; these two hooks are a view onto
     that store, which is what keeps the app bar's glyph and /settings' dropdown from
     disagreeing about which mode is on. The old `useState(initialDark)` pair could not:
     changing the mode from /settings left this button showing the previous one. */
  const schemeSetting = useSchemeSetting();
  const darkMode = useScheme() === 'dark';
  const followSystem = schemeSetting === 'system';
  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const themeIconRef = useRef<HTMLSpanElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const liveSearchParams = useSearchParams();
  const liveSearch = liveSearchParams.toString();
  const imageDetailSegment = useSelectedLayoutSegment('imageDetail');
  const imageDetailId = pathname.match(/^\/pic\/([^/]+)$/)?.[1];
  const isImageDetailOpen = Boolean(imageDetailId && imageDetailSegment === imageDetailId);
  /* Any `/pic/:id` screen, intercepted overlay or direct navigation —
     `isImageDetailOpen` only covers the overlay, and a direct visit left the drawer's
     edge-swipe armed underneath a screen you pan and swipe on. */
  const isImageDetailRoute = Boolean(imageDetailId);
  const imageHeroRuntime = useSyncExternalStore(
    subscribeImageHeroRuntime,
    getImageHeroRuntime,
    getImageHeroRuntime,
  );
  const { openAuth } = useAuthModal();
  const retainedHeroBackground = getImageHeroBackgroundLocation();
  const activeHeroBackground = imageHeroRuntime.background ?? retainedHeroBackground;
  const activeBackgroundSearch = activeHeroBackground
    ? new URLSearchParams(activeHeroBackground.search).toString()
    : '';
  const reactRouteAtBackground = Boolean(
    activeHeroBackground &&
    pathname === activeHeroBackground.pathname &&
    liveSearch === activeBackgroundSearch,
  );
  const browserAtBackground = Boolean(
    activeHeroBackground &&
    typeof window !== 'undefined' &&
    window.location.pathname === activeHeroBackground.pathname &&
    new URLSearchParams(window.location.search).toString() === activeBackgroundSearch,
  );
  // History reaches the background before App Router publishes pathname,
  // parallel-slot and search snapshots together. Keep the controller's exact
  // background location through that one-way lag so query pages never observe
  // a transient empty search and refetch themselves.
  const bridgeRouteCommit = Boolean(
    activeHeroBackground && browserAtBackground && !reactRouteAtBackground,
  );
  // An intercepted detail also opens without a hero flight (reduced/off motion,
  // or an unavailable source bitmap). Keep that route's real background too:
  // guessing '/' changes the content key and remounts a multi-page favourites
  // list or clears a search query beneath the overlay.
  const [lastPageLocation, setLastPageLocation] = useState({ pathname, search: liveSearch });
  if (!isImageDetailOpen && !imageHeroRuntime.background && !bridgeRouteCommit &&
    (lastPageLocation.pathname !== pathname || lastPageLocation.search !== liveSearch)) {
    setLastPageLocation({ pathname, search: liveSearch });
  }
  const imageHeroBackground =
    imageHeroRuntime.background ?? (bridgeRouteCommit ? retainedHeroBackground : null) ??
    (isImageDetailOpen ? lastPageLocation : null);
  const backgroundPathname = imageHeroBackground?.pathname ?? pathname;
  /* The hero owns the same pixels during a flight, so the first two conditions stand the
     route cross-fade down while one is in progress. `!isImageDetailOpen` is the narrow
     third term, and the distinction is load-bearing: with the intercepted overlay
     mounted, the snapshot source is the gallery *underneath* it, and fading that
     dissolves a page the user cannot see. A direct `/pic/123` visit has no overlay —
     the detail page *is* the content, and the fade is correct. The overlay case stays a
     cut on purpose: fixing it needs the clone to carry the overlay's inner scroll
     offset, which `getBoundingClientRect` does not encode and a clone starts at zero. */
  const crossFadeEnabled =
    imageHeroRuntime.phase === 'gallery-idle' &&
    !imageHeroRuntime.background &&
    !isImageDetailOpen;
  const frozenBackgroundSearch = imageHeroBackground?.search ?? null;

  useEffect(() => {
    initializeImageHeroHistory({
      push: (href) => router.push(href, { scroll: false }),
      replace: (href) => router.replace(href, { scroll: false }),
    });
  }, [router]);

  const getRevealOrigin = useCallback(() => {
    // The icon, not the button's box: the wipe grows out of the glyph, and the button
    // may gain padding or a label — its box is also larger than its paint under
    // `touch-size` on a touch device.
    const element = themeIconRef.current ?? themeButtonRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return undefined;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  /* Restore the docked drawer's remembered state after mount. (The layout already puts
     the appearance preferences on `<html>` from cookies, so the scheme needs no second
     write here.) Genuinely post-mount, because it depends on the viewport;
     queueMicrotask keeps setState out of the effect's synchronous body while still
     running before the next paint. */
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      // Render handles the width; this only restores the docked drawer's remembered
      // state, and must not fight it on a phone.
      if (window.matchMedia(MEDIA.md).matches) {
        const savedSidebar = localStorage.getItem(LS_KEYS.sidebarCollapsed);
        if (savedSidebar !== null) setIsCollapsed(savedSidebar === 'true');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* While following the system, an OS-level scheme flip re-runs the wipe — the one theme
     change reachable with no user input, which is why `circularReveal` consults
     `heroOwnsScreen()` before freezing rendering. */
  useEffect(() => {
    if (schemeSetting !== 'system') return;
    const mediaQuery = window.matchMedia(MEDIA.dark);
    const handler = () => changeScheme('system', getRevealOrigin());
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [schemeSetting, getRevealOrigin]);

  /* The same for the motion tier, the other `system`-resolved preference: without it,
     turning on the OS's reduce-motion setting changed nothing until a reload (the store
     listener bumps a version, but the *attribute* the CSS keys on was never rewritten).
     A separate watcher because a tier change has nothing to animate by definition. */
  useEffect(() => {
    const mediaQuery = window.matchMedia(MEDIA.reducedMotion);
    mediaQuery.addEventListener('change', refreshSystemMotion);
    return () => mediaQuery.removeEventListener('change', refreshSystemMotion);
  }, []);

  /* The request line's two shell-level chores: `setLineNotifier` is a seam (a line that
     switches under you has to say so, but `lib/route.ts` must not reach into
     `components/`), and `ensureRoutePolicy` is kicked here only to overlap the fetch
     with the first render. */
  useEffect(() => {
    setLineNotifier((message, tone) => showToast(message, tone));
    void ensureRoutePolicy();
  }, []);

  /* Coming back to the tab after a while, and coming back online, re-read whatever is on screen —
     underneath it, with no loading state and nothing removed. See `bindResourceRefresh`. */
  useEffect(() => bindResourceRefresh(), []);

  /* Tell the splash the app is on screen, so it can leave.
   *
   * A double `requestAnimationFrame` lands *after* the commit has actually been
   * presented, not merely committed — a single frame can report "painted" on a frame
   * still being composited, and the overlay would fade over a blank page. This is the
   * shell rather than any one route on purpose: every route renders inside it, and it
   * sits above `[data-page-content]`, so it does not re-fire on navigation.
   * See `lib/splash.ts`. */
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => markAppPainted());
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, []);

  /* The animation engine, after the page is on screen: both are needed at the *first
   * interaction*, which is at minimum a user gesture away, so neither belongs in the
   * document. `runWhenIdle` avoids competing with hydration; each has a documented
   * no-animation fallback if somebody beats it. */
  useEffect(() => runWhenIdle(() => {
    warmMotion();
    warmRouteCrossFade();
  }), []);

  const cycleThemeMode = () => {
    const next: SchemeSetting =
      schemeSetting === 'light' ? 'dark' : schemeSetting === 'dark' ? 'system' : 'light';
    changeScheme(next, getRevealOrigin());
  };


  const { user: storedUser, token } = useSession();
  const storedSession = storedUser as unknown as UserInfo | null;
  const [sessionEpoch, setSessionEpoch] = useState(0);

  /* Clear account-owned state before the next render, for manual logout, a 401,
     and a change in another tab alike. Initial hydration adopts the current token
     without remounting the public SSR content or discarding the login's warm read. */
  useEffect(() => {
    let previous = readToken();
    const changed = () => {
      const current = readUserInfo();
      const next = current?.token ?? null;
      if (previous !== next && previous !== null) {
        clearAllResources();
        clearScreenState();
        clearSnapshots();
        setSessionEpoch((epoch) => epoch + 1);
      }
      previous = next;
      const key = current?.api_key;
      if (typeof key === 'string' && key) localStorage.setItem(LS_KEYS.derpiApiKey, key);
      else localStorage.removeItem(LS_KEYS.derpiApiKey);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LS_KEYS.userInfo) changed();
    };
    window.addEventListener('user_info_updated', changed);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('user_info_updated', changed);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /* Two shell reads through `lib/resource.ts`, keyed on the token string, deduplicated by
     the resource, refreshed on their own TTLs (5min session / 1min badge). Never key these
     on an object identity: the earlier pathname/object-keyed pair re-read the session on
     every navigation and twice per run. */
  const session = useResource(sessionUser, token ? { token } : SKIP);
  const unread = useResource(unreadCounts, token ? { token } : SKIP);

  /* `/messages` marking a tab read moves this badge with no event and no second request: it
     force-reads the same resource entry, and this component is subscribed to it. */
  const totalUnread = token ? (unread.data?.total ?? 0) : 0;

  /* Fold the server's answer back into storage. Separate from the read because it is a
     *write*: the merge keeps the four fields the server does not return (token + three
     Derpibooru identifiers) and hands the rest over. Guarded on the serialised result so
     a cache hit does not set an identical object and re-render the whole shell. */
  useEffect(() => {
    const result = session.data;
    if (!result) return;
    /* Storage read rather than `storedSession`, so this effect does not depend on the
       state it sets — with it in the dependency list the guard below is all that
       stands between this and a loop. */
    const stored = readUserInfo();
    if (!stored || stored.token !== token) return;

    if (result.kind === 'unauthorized') {
      clearUserInfo(stored.token);
      return;
    }
    /* `unreadable` = a 200 with an empty body (dropped PHP session, proxy hiccup);
       the stored user is left exactly as it is. */
    if (result.kind !== 'ok') return;

    /* The four fields the server does not return, kept from storage. */    const merged = {
      ...stored,
      ...result.user,
      token: stored.token,
      api_key: result.user.api_key ?? stored.api_key,
      derpi_user_id: result.user.derpi_user_id ?? stored.derpi_user_id,
      derpi_username: result.user.derpi_username ?? stored.derpi_username,
    };
    updateUserInfo(stored.token, merged);
  }, [session.data, token]);

  const userInfo = storedSession;

  // Below `md` the drawer overlays the content; at and above it is docked, and
  // the swipe gesture and auto-collapse-on-navigate both switch off.
  const isOverlayDrawer = !useMediaQuery(MEDIA.md, true);

  /* Entering overlay territory collapses the drawer, so it never sits open across a
     phone-width viewport. Adjusted during render rather than from an effect, and that
     is the point: SSR cannot know the viewport, so the first paint assumes the docked
     desktop drawer — and on a phone with a persisted "expanded" preference the drawer
     painted open over the content for a frame or two before any effect could close it.
     Reacting during render closes it before the browser ever paints it. */
  const [wasOverlayDrawer, setWasOverlayDrawer] = useState(isOverlayDrawer);
  if (isOverlayDrawer !== wasOverlayDrawer) {
    setWasOverlayDrawer(isOverlayDrawer);
    if (isOverlayDrawer) setIsCollapsed(true);
  }

  const toggleSidebar = () => {
    setIsCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem(LS_KEYS.sidebarCollapsed, String(newState));
      // Cookie keeps SSR in sync with the last desktop preference.
      document.cookie = `${COOKIE_KEYS.sidebarCollapsed}=${newState};path=/;max-age=${365 * 24 * 60 * 60}`;
      return newState;
    });
  };

  const handleMobileNavigation = () => {
    if (isOverlayDrawer) setIsCollapsed(true);
  };

  const setDrawerOpen = useCallback((next: boolean) => setIsCollapsed(!next), []);
  const modalDrawerOpen = isOverlayDrawer && !isCollapsed;
  useScrollLock(modalDrawerOpen);
  useOverlayLayer(modalDrawerOpen, sidebarRef, { onClose: () => setIsCollapsed(true) });



  const handleLogoutClick = () => {
    setIsLogoutDialogOpen(true);
  };

  const handleLogoutConfirm = () => {
    if (token) clearUserInfo(token);
    setIsLogoutDialogOpen(false);
    router.push('/', { scroll: false });
  };

  const handleLogoutCancel = () => {
    setIsLogoutDialogOpen(false);
  };

  return (
    <BackgroundLocationProvider frozenSearch={frozenBackgroundSearch}>
      <div className="h-full flex flex-col overflow-hidden">
        <DevBanner />
        {/* **64dp app bar at every density** (`AppBarSmallTokens.ContainerHeight`) — the
            bar is the one fixed band, not repeated chrome, so the density step does not
            apply; the 56dp-feel came from the controls in it, which are 40dp now.
            Horizontal inset 16px on a phone, 104px from `sm`: deliberate breathing room
            around the brand — the bar spans drawer and content and belongs to neither,
            so aligning it to either grid is false precision.
            **`--touch-floor: 48px` locally, so the bar opts out of the pointer axis.**
            These five are the app's most-used controls, alone on a 64dp coloured band;
            at 40dp with 104px of air either side they read as small glyphs rather than
            chrome. One declaration on the band rather than five on the controls. */}
        <header inert={modalDrawerOpen || isImageDetailOpen || undefined} className="h-16 [--touch-floor:48px] bg-primary text-on-primary flex items-center px-4 sm:px-26 shrink-0 relative z-app-bar">
          {/* `IconButton variant="on-primary"`. The app bar's four controls
              were each a hand-rolled 48px box repeating the same eight classes,
              because the primitive had no variant whose focus ring survives a
              pink background.
              `size="md"` — 40dp, `SmallIconButtonTokens`, which is what AOSP's own app
              bar uses. These were `lg` (56, the *medium* icon button), the largest step
              the primitive offers, on all five: a 56px box around a 24px glyph puts 16px
              of live target outside the mark on every side, and five of them side by side
              read as a toolbar of buttons rather than a row of actions. `touch-size` grows
              the hit region back on a touch device without moving the glyph. */}
          <IconButton
            variant="on-primary"
            size="md"
            onClick={toggleSidebar}
            aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!isCollapsed}
            aria-controls="app-sidebar"
            className="mr-1 touch-size sm:mr-3"
            icon={<MdMenu size={ICON.standard} />}
          />
          <Link
            scroll={false}
            href="/"
            aria-label="PicPony 主页"
            /* Visible on a phone too, which it was not — `hidden sm:flex` cost
               the brand its only appearance on the majority viewport *and* the
               one-tap route home, leaving the drawer as the only way back to the
               gallery. The space was always there: at 390px the five 40dp controls
               plus the mark need 300px of the 350 the bar has.
               `touch-size` because this is the bar's one *inverse* problem. The
               wordmark is 28px tall (its aspect ratio against `w-20`), and an anchor
               wrapping it inherits that — a 28px target in a 56px bar, while every
               button beside it clears the floor. The anchor has no padding of its own
               to grow, so the floor has to come from the utility.
               `shrink-0` keeps the mark intact if anything else ever grows. */
            className="relative mr-2 flex shrink-0 touch-size items-center"
          >
            {/* One wordmark component for header and drawer; `keyline` is the part
                that was genuinely header-specific. */}
            <Logo className="h-auto w-20 sm:w-25" keyline />
          </Link>
          <IconButton
            ref={themeButtonRef}
            variant="on-primary"
            size="md"
            onClick={cycleThemeMode}
            aria-label="切换主题模式"

            className="ml-1 touch-size"
            icon={
              <span
              ref={themeIconRef}
              key={followSystem ? 'system' : String(darkMode)}
              className="block animate-icon-swap"
            >
              {/* The glyph shows the mode you are *in*, not the one you would switch
                  to — matching the tooltip beside it. */}
              {followSystem ? (
                <MdBrightnessAuto size={ICON.standard} />
              ) : darkMode ? (
                <MdDarkMode size={ICON.standard} />
              ) : (
                <MdLightMode size={ICON.standard} />
              )}
              </span>
            }
          />
          <div className="flex-1" />
          {/* The fallback reserves the control's own box, moving with it — including
              through `touch-size` — so the bar does not jump by 8px on mount on a
              touch device. */}
          <Suspense fallback={<div className="h-10 w-10 touch-size" aria-hidden="true" />}>
            <SearchBar />
          </Suspense>
          {/* A `<Link>` wearing the same recipe from `iconButtonClasses` rather than a
              fifth copy of it (same reason `buttonClasses` exists beside `Button`).
              The badge is a **sibling** of the anchor, not a child: `data-ripple` sets
              `overflow: hidden`, and a corner badge on a circular clip always loses its
              outer arc (centre distance + badge radius > clip radius). The anchor's
              `aria-label` already carries the count, so the badge is decorative. */}
          <span className="relative ml-1 flex shrink-0">
            <Link
              scroll={false}
              href="/messages"
              aria-label={totalUnread > 0 ? `消息（${totalUnread} 条未读）` : '消息'}
              data-ripple
              className={cn(iconButtonClasses({ variant: 'on-primary', size: 'md' }), 'touch-size')}
            >
              <MdNotifications size={ICON.standard} />
            </Link>
            <span className="pointer-events-none absolute top-0 right-0">
              <CountBadge count={totalUnread} />
            </span>
          </span>
        </header>

        <div className="flex flex-1 overflow-hidden relative bg-surface-container-low">
          {/* The panel's own springs, per direction. The scrim is not a component
              fading in place — it is the other half of the drawer moving — so it
              shares whatever clock the panel is on, and it has to share the
              *asymmetry* too or the two halves arrive separately. */}
          <div
            ref={scrimRef}
            className={`fixed inset-0 bg-scrim-veil z-detail-overlay md:hidden transition-opacity ${
              isCollapsed
                ? 'spring-fast-effects opacity-0 pointer-events-none'
                : 'spring-default-spatial opacity-100'
            }`}
            onClick={() => setIsCollapsed(true)}
            aria-hidden="true"
          />
          <aside
            ref={sidebarRef}
            id="app-sidebar"
            role={modalDrawerOpen ? 'dialog' : undefined}
            aria-modal={modalDrawerOpen || undefined}
            aria-label="主导航"
            tabIndex={-1}
            /* Hidden from assistive tech while closed, so the nav links inside
               are not reachable by Tab from behind the scrim. */
            aria-hidden={isCollapsed ? 'true' : undefined}
            inert={isCollapsed || isImageDetailOpen || undefined}
            /* 288dp, a **deliberate divergence** from M3's 360dp navigation drawer,
               and not to be "fixed": this drawer is *docked* from `md` up, so its width
               comes out of the content area — on an image gallery those 72px are a
               column of thumbnails. The number lives here only; the negative right
               margin below must match it.

               **The panel slides; it is not clipped.** Animating width with the contents
               pinned was the defect two easing curves were blamed for: the nav's own
               left edge never moved while the main content's travelled the full run, so
               two things moved at once, one at the curve's rate and one at zero — a
               guillotine no timing function can fix. Now the whole aside translates and
               a negative margin closes the layout behind it: the content travels because
               it is *inside* the thing that moves, the panel's box never resizes so its
               subtree never re-lays-out, and `translate` is composited.

               **A spring, and a different one per direction — because that is what M3
               does.** `NavigationDrawer.kt`: open = `DefaultSpatial` (ζ0.9, 194ms),
               close = `FastEffects` (ζ1.0, 108ms) — critically damped, because a panel
               leaving must not overshoot back into view. (`effects` means ζ=1, and ζ=1
               is exactly what a *position* wants when overshoot would be wrong.) A
               docked panel travelling in place is neither of M3's one-sided curve verbs
               — on `standard` its fastest tenth carries 97x its last, i.e. a jump then a
               stall — so a spring, which leaves and arrives at zero velocity by
               construction, is the right physics. Vuetify is still the reference for the
               *arrangement*: one gesture, one clock, the scrim sharing both. The springs
               are applied per branch because a transition is governed by the
               *after-change* style — the class the element is gaining is the one whose
               timing runs. */
            className={`bg-surface-container-low flex w-72 flex-col shrink-0 transition-[margin-right,translate] overflow-hidden absolute md:relative h-full z-app-bar md:z-auto rounded-r-lg md:rounded-none ${
              isCollapsed
                ? 'spring-fast-effects -translate-x-full md:-mr-72'
                : 'spring-default-spatial translate-x-0'
            }`}
          >
            {/* `w-full`, not a second width declaration: the aside no longer resizes, so
                a second copy of the number is just two places to change it. */}
            <div className="main-scrollbar flex w-full flex-1 flex-col overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="p-3 pb-0">
                {userInfo ? (
                  <Link
                    scroll={false}
                    href={`/user/${userInfo.id}`}
                    onClick={handleMobileNavigation}
                    data-ripple
                    /* A two-line list item (avatar, name, supporting line), so the
                       geometry comes from `ListTokens` rather than the drawer's item —
                       16dp corner, 16dp leading, 40dp avatar, 12dp between. It is the
                       drawer's *header*, not a nav row: a pill is the shape the rows
                       below use to mean "you are here". The avatar still starts on the
                       same 28dp leading column as every nav icon (12dp nav inset + 16dp
                       item inset), which is the part that has to agree.
                       **64dp, with `ListTokens`' own 40dp avatar.** 72 is a *list row*'s
                       height; 64 is one step down, leaving 12px above and below the text
                       stack — exactly M3's own item padding. `/messages`' contact row
                       keeps 72 with the same portrait: that one *is* a list row, and the
                       rail's collapsed width is derived from its height. */
                    className="state-layer flex h-16 w-full items-center gap-3 rounded-lg px-4 outline-none focus-visible:ring-2 focus-ring"
                  >
                    <Avatar src={userInfo.avatar} name={userInfo.username} size={40} />
                    <div className="min-w-0 flex-1">
                      {/* `title-s` (14px, weight 500), the same size as the links below
                          it, so the drawer reads as one column. `ListTokens`
                          names `body-large`; a stated divergence, because the row it
                          labels is not in a list. */}
                      <p className="text-title-s text-on-surface truncate">{userInfo.username}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge tone="primary" size="sm">
                          Lv.{userInfo.level ?? '?'}
                        </Badge>
                        {userInfo.derpi_username && (
                          <span
                            className="text-label-s text-success max-w-[100px] truncate"
                            title={userInfo.derpi_username}
                          >
                            ✓ {userInfo.derpi_username}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      openAuth('login');
                      handleMobileNavigation();
                    }}
                    data-ripple
                    className="state-layer group flex h-16 w-full cursor-pointer items-center gap-3 rounded-lg px-4 text-left outline-none focus-visible:ring-2 focus-ring"
                  >
                    <Avatar size={40} />
                    <span className="min-w-0">
                      <span className="text-title-s text-on-surface block truncate">未登录</span>
                      <span className="text-body-m text-on-surface-variant block truncate">
                        点击登录
                      </span>
                    </span>
                  </button>
                )}
              </div>
              {/* Always drawn, signed in or out: the division it marks is structural,
                  not conditional — above it is who you are, below it is where you can
                  go. A rule that blinks on login reports a change in the shell's shape
                  as a change in your account. */}
              {/* `shrink-0` is the whole of the "disappeared after logging in" bug: a
                  flex item in a column carries flex-shrink 1 by default, and signed in
                  the column overflows — the nav below is `flex-1` (basis 0) and
                  contributes nothing to the shrink pool, so this 1px line absorbed the
                  entire overflow and shrank to 0. Inset matches `SidebarNav`'s own rule
                  and its vertical rhythm matches the rule inside it — one kind of line,
                  one geometry. */}
              <div className="bg-outline-variant mx-4 my-2 h-px shrink-0" />
              <SidebarNav
                user={userInfo}
                backgroundPathname={backgroundPathname}
                unread={totalUnread}
                onNavigate={handleMobileNavigation}
                onLogout={handleLogoutClick}
              />
            </div>
          </aside>
          <section
            data-image-detail-host
            inert={modalDrawerOpen || undefined}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface sm:m-3 sm:rounded-md"
          >
            
            <div className="relative min-h-0 flex-1">
              
              <main
                data-image-detail-background
                inert={isImageDetailOpen || undefined}
                data-image-hero-gallery-scroll
                data-scroll-hidden={isImageDetailOpen || undefined}
                className="app-scroller main-scrollbar absolute inset-0 w-full overflow-y-scroll bg-surface"
              >
                {' '}
                <div
                  data-image-detail-background-visual
                  className="flex min-h-full w-full flex-col"
                >
                  
                  <div
                    key={`${backgroundPathname}:${sessionEpoch}`}
                    data-page-content
                    className="animate-page-transition flex flex-1 flex-col p-4 sm:p-6"
                  >
                    
                    {/* A flex column, and `[&>*]:w-full` is not optional with it.
                        The column exists so `StatusView`'s `fill` can be `flex-1` — a
                        percentage min-height resolves only against a *definite* parent
                        height, and this element's comes from flex distribution, which
                        Chrome treats as indefinite.
                        The `w-full` is load-bearing: a flex item in a column is
                        stretched on the cross axis by `align-items: stretch` **unless
                        it has an auto margin there**, because an auto cross-axis margin
                        absorbs the free space and disables the stretch. Every page root
                        here is `mx-auto max-w-*`, so without it they all fall back to
                        shrink-to-fit (measured 755px on one tab, 240px on the next).
                        Setting the width makes the cross size definite; `max-width` caps
                        it and `mx-auto` centres it — block behaviour restored.
                        Safe because every route puts exactly one element in here. */}
                    <div className="flex flex-1 flex-col [&>*]:w-full">{children}</div>
                    {/* Inside the page, not beside it: as a sibling of the content the
                        mark was the one thing a page transition could not move — it sat
                        still while its page slid out from under it. Inside, it is
                        cloned, slid and landed with everything else. `page-chrome` is
                        left on for the one move it still cannot join — a tab switch,
                        where the panes that slide are above it inside the same page. */}
                    <footer className="page-chrome mt-auto pt-10 text-label-l text-on-surface-variant sm:pt-12">
                      {' '}
                      <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-4 md:flex-row">
                        
                        <div className="flex w-full flex-col items-center gap-4 md:w-auto md:items-start">
                          
                          {/* `text-outline`, not a dimmed copy of the footer's own ink:
                              `Logo` paints through a mask from `currentColor`, and
                              `outline` is the documented role for a *graphic* that
                              should read quieter than the prose beside it (clears the
                              3:1 non-text bar). */}
                          <Logo className="h-8 w-auto text-outline" />
                          <nav aria-label="站内导航" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            
                            <Link scroll={false} href="/about" className="transition-ui hover:text-on-surface hover:underline">
                              关于本站
                            </Link>
                            <span aria-hidden="true" className="text-outline">·</span>
                            <Link scroll={false} href="/policy" className="transition-ui hover:text-on-surface hover:underline">
                              声明与政策
                            </Link>
                          </nav>
                          <div>
                            {' '}
                            <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                            <p>本站为 Derpibooru 第三方镜像站点</p>
                          </div>
                        </div>
                      </div>
                    </footer>
                  </div>
                </div>
                <div
                  data-image-hero-gallery-anchor
                  aria-hidden="true"
                  className="image-hero-gallery-anchor"
                />
              </main>
              {/* The sibling immediately above `RouteCrossFade`, so the ordering is
                  stated rather than incidental: within one commit phase React runs
                  siblings in render order. See `lib/scrollMemory.ts`. */}
              <RouteScrollMemory />
              <RouteCrossFade pathname={backgroundPathname} enabled={crossFadeEnabled} />
              {/* Renders nothing; it exists so the swipe's hook can be mounted only
                  once the engine has arrived. Above 768px the drawer is docked and
                  this never loads. */}
              <DrawerSwipe
                drawerRef={sidebarRef}
                scrimRef={scrimRef}
                open={!isCollapsed}
                onOpenChange={setDrawerOpen}
                enabled={isOverlayDrawer && !isImageDetailRoute && !imageHeroRuntime.background}
              />
              {/* Where `PageBack` lands: the back affordance is chrome, not content.
                  Rendered inside the page it was cloned by the route snapshot and
                  translated by the shared axis — an X-axis slide carried it a whole
                  window out and back to the pixel it started on. A portal keeps the
                  page as owner of handler and label while the node lives out here.
                  `z-page-chrome` is load-bearing both ways: above the cross-fade layer
                  (the live button must show over the clone), below the image-detail
                  overlay and Stage (they bring their own). See the stacking-order
                  block in globals.css. */}
              <div
                data-page-back-slot
                /* No `aria-hidden` here, despite this being a positioning shim:
                   what gets portalled into it is a real, focusable control. */
                className="pointer-events-none absolute inset-0 z-page-chrome"
              />
              <Suspense fallback={null}>
                {' '}
                <HeroStage />
              </Suspense>
              {overlay}
            </div>
            {backgroundPathname === '/' && (
              <Suspense fallback={null}>
                {/* `isImageDetailOpen` alone is not enough: the overlay is torn down
                    before the hero flies home, so keying off it would pop the pill
                    back in behind the still-moving image. The hero runtime reports
                    the flight itself. */}
                <TabNavBar hidden={isImageDetailOpen || Boolean(imageHeroRuntime.background)} />
              </Suspense>
            )}
          </section>
        </div>
        <AnnouncementModal />

        <Modal
          isOpen={isLogoutDialogOpen}
          onClose={handleLogoutCancel}
          title="登出"
          footer={
            <>
              <Button variant="text" type="button" onClick={handleLogoutCancel}>
                取消
              </Button>
              <Button variant="danger" onClick={handleLogoutConfirm}>
                确认登出
              </Button>
            </>
          }
        >
          <p className="text-body-m text-on-surface-variant">确定要登出当前账号吗？</p>
        </Modal>
      </div>
    </BackgroundLocationProvider>
  );
}
