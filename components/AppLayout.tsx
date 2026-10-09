'use client';

import {
  Fragment,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import {
  MdMenu,
  MdSearch,
  MdNotifications,
  MdDarkMode,
  MdLightMode,
  MdPhotoLibrary,
  MdForum,
} from 'react-icons/md';

import dynamic from 'next/dynamic';
import { ICON } from '@/lib/icons';
const AnnouncementModal = dynamic(() => import('./AnnouncementModal'), { ssr: false });
import Logo from './Logo';
import Avatar from './Avatar';
import { CountBadge } from './Badge';
import DevBanner from './DevBanner';
import OfflineBanner from './OfflineBanner';
import CompanionHost from './mascot/CompanionHost';
import { MaintenanceNotice, useStaleStaffHintCleanup } from './MaintenanceScreen';
import SidebarNav from './SidebarNav';
import { useAuthModal } from './AuthModal';
import { useConfirm } from './ConfirmDialog';
import { BackgroundLocationProvider, useBackgroundSearchParams } from './BackgroundLocation';
import { readDetailBackground, rememberDetailBackground } from '@/lib/detailBackground';
import { bindResourceRefresh, clearAllResources, SKIP, useResource } from '@/lib/resource';
import { clearScreenState } from '@/lib/screenState';
import { sessionUser, unreadCounts } from '@/lib/resources';
/* The runtime store only: the engine binds itself where a picture can open, and the shell renders
   on every route — see `lib/hero/runtime.ts`. */
import {
  getImageHeroRuntime,
  initializeImageHeroHistory,
  requestImageDetailClose,
  subscribeImageHeroRuntime,
} from '@/lib/hero/runtime';
import HeroStage from '@/components/HeroStage';
import Badge from '@/components/Badge';
import RouteCrossFade from '@/components/RouteCrossFade';
import DetailOverlayTransit from '@/components/DetailOverlayTransit';
import { ImageDetailSlot } from '@/components/ImageDetailSlot';
import { warmRouteCrossFade } from '@/lib/routeCrossFade';
import RouteScrollMemory from '@/lib/scrollMemory';
import Tabs from '@/components/Tabs';
import IconButton, { iconButtonClasses } from '@/components/IconButton';
import { buttonClasses } from '@/components/buttonStyles';
/* Through the lazy facade, not `lib/motion` directly: that module registers GSAP and its
   plugins at module scope, and this component wraps every route. Each entry point falls back
   to the 关闭 tier's own behaviour until the chunk lands. See `lib/motionLazy.tsx`. */
import {
  changeScheme,
  DrawerSwipe,
  setTabIntent,
  startTabTransition,
  warmMotion,
} from '@/lib/motionLazy';
import {
  MOTION_SPEED_SCALE,
  recoverCustomPalette,
  refreshSystemMotion,
  useScheme,
  useSchemeSetting,
  type ColorScheme,
} from '@/lib/appearance';
import { PAGE_FADE_TIMING } from '@/lib/motionTokens';
import { heroOwnsScreen } from '@/lib/appScroller';
import { clearAllTabScroll } from '@/lib/tabScroll';
import { holdFooterWhileLoading } from '@/lib/pageLoadingHold';
import {
  ensureHomeBackStack,
  homeTabOf,
  setHomeTabSwitcher,
  writeHomeTab,
  type HomeTab,
} from '@/lib/homeTabs';
import { clearUserInfo, readToken, readUserInfo, resolveDerpiCredentials, updateUserInfo, useMediaQuery, useSession } from '@/lib/hooks';
import { ensureRoutePolicy, setLineNotifier } from '@/lib/route';
import { showToast } from '@/components/Toast';
import { cn, runWhenIdle } from '@/lib/utils';
import { COOKIE_KEYS, LS_KEYS, MEDIA } from '@/lib/constants';
import { hasModalLayer, useOverlayLayer, useScrollLock } from '@/lib/overlay';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { prefetchRoute } from '@/lib/prefetchRoute';
import { scrollAppToElement } from '@/lib/scrollTo';
import { focusLanding } from '@/lib/focusLanding';
import { useMaintenanceStatus } from '@/lib/useSiteStatus';

/**
 * The account's Derpibooru key, mirrored where the request layer reads it. Outside the component
 * on purpose: the React Compiler cannot lower a conditional inside a try block, and one inside
 * the shell's session effect made it skip the whole shell.
 */
function mirrorDerpiApiKey(key: unknown) {
  try {
    if (typeof key === 'string' && key) localStorage.setItem(LS_KEYS.derpiApiKey, key);
    else localStorage.removeItem(LS_KEYS.derpiApiKey);
  } catch {
    /* Blocked storage: the key stays in the session object, which is where reads go. */
  }
}

function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const intent = useIntentPrefetch(() => {
    router.prefetch('/search');
    /* The artwork and the quick tags — what the empty screen shows first. */
    prefetchRoute('/search');
  });

  /* On /search the control means the field that is already there: it is brought into view and
     focused. Pushing /search again added a history entry for the screen on view (Back then seemed
     to do nothing) and replayed the route's transition onto itself (G0-002). */
  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (pathname === '/search') {
      const field = document.querySelector<HTMLInputElement>('[data-page-content] input[data-search-field]');
      if (field) {
        scrollAppToElement(field, { offset: 16 });
        field.focus({ preventScroll: true });
        return;
      }
    }
    router.push('/search', { scroll: false });
  };

  return (
    <form onSubmit={handleSearch} className="flex shrink-0">
      {/* `type="submit"` is why this is an `IconButton` rather than a `Link`: the form
          owns the navigation. `md` + `touch-size` matches the other bar controls, and
          the Suspense fallback must reserve exactly this box. */}
      <IconButton
        {...intent}
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

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Storage and cookies are the device's memory, and both can refuse (a blocked-storage
 *  browser, a sandboxed frame): a refused persist costs the preference, never the page. */
function persistDockedCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(LS_KEYS.sidebarCollapsed, String(collapsed));
  } catch {
    /* The cookie below still carries it to the next load. */
  }
  try {
    document.cookie = `${COOKIE_KEYS.sidebarCollapsed}=${collapsed};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  } catch {
    /* Nothing left to carry it; the drawer simply opens expanded next time. */
  }
}


/** How long a route change's landing waits for the incoming page to be focusable: the whole
 *  route entrance at the slowest speed. The page is hidden only for the fade's opening overlap,
 *  so this bound is generous rather than tight. */
const LANDING_WAIT_MS = (PAGE_FADE_TIMING.delay + PAGE_FADE_TIMING.duration) * 1000 * MOTION_SPEED_SCALE.slow;

/** How long the landing waits for a list's return target that the route still covers — a forum
 *  row or a folder card the container transform hides for its run: that run is the route's 400ms
 *  at the slowest speed too, but its leg starts pending, a frame or more after the commit (on a
 *  busy main thread, a development build has spent 280ms there), so twice the landing's bound. */
const RETURN_WAIT_MS = LANDING_WAIT_MS * 2;

/**
 * The home route's 图库 / 论坛 pill.
 *
 * **Mounted on every route, shown only on `/`.** Mounting it with the route made it cut in and
 * out on the first frame of a route change while the page itself slid or faded for 400–500ms;
 * mounted, its own hide transition carries it, on the page's clock. The same transition hides
 * it while an image detail is open or the hero flies home, when unmounting would also make the
 * sliding indicator re-measure and jump back to x = 0 mid-flight.
 *
 * **Bottom navigation, not a tab row that writes history** — see `lib/homeTabs.ts`: 图库 → 论坛
 * pushes one entry, 论坛 → 图库 goes back to it, so Back from 论坛 returns to 图库 once and then
 * leaves. The pane transition starts on the tap; the URL follows once its first frame is out
 * (at once if another input comes first — see `lib/homeTabs.ts`).
 */
function TabNavBar({ onHome, hidden }: { onHome: boolean; hidden: boolean }) {
  const searchParams = useBackgroundSearchParams();
  const currentTab: HomeTab = homeTabOf(searchParams);
  // Optimistic tab so the pill and label colours respond on the tap, before the URL (and its
  // search params) commit.
  const [pendingTab, setPendingTab] = useState<HomeTab | null>(null);
  const activeTab = pendingTab ?? currentTab;
  const shown = onHome && !hidden;

  /* The panes see only the URL, and `useSearchParams` propagates on the router's own schedule
     — one of our writes is even a traversal, landing a task later. Hand the panes the tab the
     user is really on for those commits. Cleared on leaving home, which is what keeps an
     intent from outliving the route. */
  useEffect(() => {
    setTabIntent(onHome ? pendingTab : null);
    return () => setTabIntent(null);
  }, [onHome, pendingTab]);

  /* **The optimistic tab must not outlive the URL catching up, in either direction.** Left
     stale it is worse than useless: tap 论坛 then press Back — the URL returns to `/` but the
     intent keeps reporting forum, so the panes bail before clearing their flags, leaving the
     gallery hidden, the forum on screen and tapping 论坛 a no-op. Keyed on `currentTab` alone,
     so it fires whether the URL caught up with the tap or moved somewhere else.
     `queueMicrotask` satisfies `react-hooks/set-state-in-effect`; on mount it writes null
     over null, which React bails out of. */
  useEffect(() => {
    queueMicrotask(() => setPendingTab(null));
  }, [currentTab, onHome]);

  /* A cold entry at `/?tab=forum` gets the gallery put beneath it (see `lib/homeTabs.ts`). */
  useEffect(() => {
    if (onHome && currentTab === 'forum') ensureHomeBackStack();
  }, [onHome, currentTab]);

  const switchTab = useCallback(
    (tab: HomeTab) => {
      if (tab === activeTab) return;
      setPendingTab(tab);
      /* Both panes are already mounted, so the transition does not need the route — only the
         attribute that gives the incoming pane a box, which it sets itself. Gallery sits left
         of forum, so moving right sends the outgoing pane left. Each pane moves as one piece,
         its 全部 / 本站讨论 row included, and leans on top of that because the route's panel says
         so (`TabPanes lean`, read off the panel by both paths). */
      startTabTransition(activeTab, tab, tab === 'forum' ? 1 : -1);
      writeHomeTab(tab);
    },
    [activeTab],
  );

  /* The drawer's 主页 / 论坛 rows are this control too while the pill is live. */
  useEffect(() => {
    if (!shown) return;
    setHomeTabSwitcher(switchTab);
    return () => setHomeTabSwitcher(null);
  }, [shown, switchTab]);

  /* **`--app-bottom-chrome`**: the band's height while the pill is live, the bottom-edge twin of
     `--app-chrome-bottom` — so whatever floats at the bottom of the content area (the mascot)
     rises above the navigation instead of being cut across by it, as M3 places a floating element
     over a navigation bar. Written on the root like its twin; removed when the pill goes, so the
     floating element settles back down with the page that had the pill. `data-bottom-chrome`
     beside it says which way the band went, so the floating element can take the pill's own leg
     — the arriving page's 80ms + 320ms decelerate, or the leaving page's 100ms accelerate. */
  const band = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = band.current;
    const root = document.documentElement;
    if (!shown || !node) {
      root.style.removeProperty('--app-bottom-chrome');
      root.removeAttribute('data-bottom-chrome');
      return;
    }
    const write = () => root.style.setProperty('--app-bottom-chrome', `${Math.round(node.offsetHeight)}px`);
    write();
    root.setAttribute('data-bottom-chrome', '');
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-bottom-chrome');
      root.removeAttribute('data-bottom-chrome');
    };
  }, [shown]);

  return (
    /* **It leaves and arrives with its page, on the page's own clock** — the route cross-fade's:
       the page being left is gone in 100ms on `accelerate`, the page arriving fades in over
       320ms on `decelerate` behind an 80ms overlap (`PAGE_FADE_TIMING`), and the pill takes
       those two legs. It had its own 400ms/200ms pair and so showed up over a thread still on
       screen and lingered over a thread already arriving. The same legs serve the image detail
       and the hero's return, whose page is the gallery. `z-page-chrome` keeps it under the
       drawer scrim: the host `<section>` is positioned but not a stacking context, so the pill's
       z competes directly with the shell's. A `<nav>` landmark: it is the home route's own
       navigation, and it sits outside `main`. */
    <nav
      ref={band}
      aria-label="首页导航"
      data-image-detail-chrome
      data-chrome-hidden={!shown || undefined}
      aria-hidden={!shown || undefined}
      inert={!shown || undefined}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-page-chrome flex select-none items-center justify-center py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,translate] ${
        shown
          ? 'translate-y-0 opacity-100 delay-[calc(80ms*var(--motion-scale))] duration-[calc(320ms*var(--motion-scale))] ease-[var(--ease-decelerate)]'
          : 'translate-y-2 opacity-0 duration-press ease-[var(--ease-accelerate)]'
      }`}
    >
      {/* `Tabs variant="pill"`, not a hand-rolled segmented control — the primitive owns the
          ARIA roles, the keyboard contract, the sliding indicator and the elevation. What stays
          here is what is genuinely this screen's: the optimistic tab, the history model and the
          hide-while-away wrapper. */}
      <Tabs
        className="pointer-events-auto"
        label="首页分区"
        value={activeTab}
        onChange={(tab) => switchTab(tab as HomeTab)}
        variant="pill"
        tabs={[
          { value: 'gallery', label: '图库', icon: <MdPhotoLibrary size={ICON.control} /> },
          { value: 'forum', label: '论坛', icon: <MdForum size={ICON.control} /> },
        ]}
      />
    </nav>
  );
}

const SCHEME_LABEL: Record<ColorScheme, string> = { light: '浅色模式', dark: '深色模式' };

export default function AppLayout({
  children,
  overlay,
  initialCollapsed,
  initialScheme,
  devBannerVisible,
  maintenance: initialMaintenance = false,
}: {
  children: React.ReactNode;
  overlay: React.ReactNode;
  /** The docked drawer's remembered state, from the cookie. */
  initialCollapsed: boolean;
  /** The scheme the server painted, from the cookie — the theme glyph's first render. */
  initialScheme: ColorScheme;
  /** Whether the server rendered the dev banner (its dismissal is mirrored into a cookie). */
  devBannerVisible: boolean;
  /** Maintenance is on and this device is rendered the app as staff: the chrome says so. */
  maintenance?: boolean;
}) {
  const maintenance = useMaintenanceStatus(initialMaintenance);
  /* **Two drawer states, not one.** The docked drawer (from `md`) has a remembered
     preference, known to the server from its cookie. The phone's modal drawer has none: it
     is closed until someone opens it, and it can never be open on a server render. One
     `isCollapsed` served both, so a desktop that had expanded its drawer server-rendered
     every phone with the drawer painted open until hydration closed it — and opening the
     drawer on a phone persisted itself as the desktop's preference. */
  const [dockedCollapsed, setDockedCollapsed] = useState(initialCollapsed);
  const [modalOpen, setModalOpen] = useState(false);

  /* The colour scheme is not local state. It is two localStorage keys, a cookie and a class
     on `<html>`, all owned by `lib/appearance`; these hooks are a view onto that store, which
     is what keeps the app bar's glyph and /settings' dropdown from disagreeing. The server
     value is the cookie's scheme, so the glyph the server paints is the one hydration keeps. */
  const schemeSetting = useSchemeSetting();
  const scheme = useScheme(initialScheme);
  const nextScheme: ColorScheme = scheme === 'dark' ? 'light' : 'dark';
  /* The glyph turns only in answer to a press — never on a load or on a change made from
     /settings. `swapTo` is the scheme a press asked for; the glyph animates while it is the
     one shown, and the record is dropped once the scheme moves on. */
  const [swapTo, setSwapTo] = useState<ColorScheme | null>(null);
  const [shownScheme, setShownScheme] = useState(scheme);
  if (shownScheme !== scheme) {
    setShownScheme(scheme);
    if (swapTo !== null && shownScheme === swapTo) setSwapTo(null);
  }

  const themeButtonRef = useRef<HTMLButtonElement>(null);
  const themeIconRef = useRef<HTMLSpanElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const liveSearchParams = useSearchParams();
  const liveSearch = liveSearchParams.toString();
  const imageDetailSegments = useSelectedLayoutSegments('imageDetail');
  const imageDetailId = pathname.match(/^\/pic\/([^/]+)$/)?.[1];
  /* The intercepted overlay is open when the slot holds its segment. Not "the slot's id equals the
     URL's": 上一张 / 下一张 rewrite the URL through the router's native path, which keeps the tree
     (and so the slot's id) where it was while `usePathname` follows. `includes`, because the slot's
     path is not the route's alone — Next leads it with a slot group of its own. */
  const isImageDetailOpen = Boolean(imageDetailId && imageDetailSegments.includes('(.)pic'));
  /* Any `/pic/:id` screen, intercepted overlay or direct navigation — `isImageDetailOpen`
     only covers the overlay, and a direct visit left the drawer's edge-swipe armed underneath
     a screen you pan and swipe on. */
  const isImageDetailRoute = Boolean(imageDetailId);
  const imageHeroRuntime = useSyncExternalStore(
    subscribeImageHeroRuntime,
    getImageHeroRuntime,
    getImageHeroRuntime,
  );
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  /* A traversal reaches the list before the router publishes it: the browser is back on the
     background while React still renders the overlay (a close's own history collapse, a Back
     from a detail with no ladder). Through that one-way lag the background is simply where the
     browser already is — exact to its search, so a query page never sees a transient empty
     search and refetches itself. Only while the overlay is still what React renders: on any
     other route React and the location agree by the next commit, and reading a finished close's
     record there kept `/` as the background of the next page — 主页 highlighted and the home
     pill floating over /search (R12-018). */
  const browserLeftDetail =
    isImageDetailOpen && typeof window !== 'undefined' && !/^\/pic\/[^/]+$/.test(window.location.pathname);
  const heroSettledOnDetail = imageHeroRuntime.phase === 'detail-idle';
  /* The gallery under an open detail is inert — **only once the detail has settled**. `inert` on
     this `<main>` restyles its whole subtree (every card; measured 1,450 elements and up to 66ms
     on a desktop, several times that on a phone), so it must not flip inside a flight's frames:
     the intercepted route commits mid-flight on an open, and a cancelled close turning back
     towards the detail used to flip it at the instant it reversed, taking the head of the
     reversed leg with it. The overlay already covers the gallery while it flies. A return
     exposes the gallery at once — left inert until the route commit, a wheel or touch stream
     latched onto the non-scrollable host and stayed there after the flight landed — and the
     close waits a frame for that restyle before it flies (`runClosing`). */
  const detailCovers = isImageDetailOpen && imageHeroRuntime.direction !== 'back';
  const galleryInert = detailCovers && heroSettledOnDetail;
  // An intercepted detail also opens without a hero flight (reduced/off motion,
  // or an unavailable source bitmap). Keep that route's real background too:
  // guessing '/' changes the content key and remounts a multi-page favourites
  // list or clears a search query beneath the overlay.
  const [lastPageLocation, setLastPageLocation] = useState({ pathname, search: liveSearch });
  if (!isImageDetailOpen && !imageHeroRuntime.background &&
    (lastPageLocation.pathname !== pathname || lastPageLocation.search !== liveSearch)) {
    setLastPageLocation({ pathname, search: liveSearch });
  }
  /* A navigation away from an open detail — a drawer row, a link inside it — commits before the
     engine hears of it, so for that one commit the engine's record still names the list the
     detail covered. Read as the background, it kept the page underneath on the list's key: the
     destination mounted under it and then again under its own, and the route cross-fade
     compared the list with itself. With no detail open, a record whose page is not the one
     being rendered is already stale. (A close lands on its record's own page, so it keeps it.) */
  const recordedBackground =
    imageHeroRuntime.background && (isImageDetailOpen || imageHeroRuntime.background.pathname === pathname)
      ? imageHeroRuntime.background
      : null;
  const imageHeroBackground =
    recordedBackground ??
    (browserLeftDetail
      ? { pathname: window.location.pathname, search: window.location.search }
      : null) ??
    (isImageDetailOpen ? readDetailBackground(pathname) ?? lastPageLocation : null);
  const backgroundPathname = imageHeroBackground?.pathname ?? pathname;
  const frozenBackgroundSearch = imageHeroBackground?.search ?? null;
  useLayoutEffect(() => {
    // The browser URL may still be the source during render; Next writes it during commit.
    // The helper checks the committed pathname, so do not gate on the render-time URL here.
    if (isImageDetailOpen && frozenBackgroundSearch !== null) {
      rememberDetailBackground(pathname, { pathname: backgroundPathname, search: frozenBackgroundSearch });
    }
  }, [isImageDetailOpen, pathname, backgroundPathname, frozenBackgroundSearch]);
  const onHome = backgroundPathname === '/';
  /* The hero owns the same pixels during a flight, so the route cross-fade stands down while
     one is in progress. Two moments are its own: an idle gallery, and an idle detail being
     left for another page — the commit in which the overlay goes (`isImageDetailOpen` false)
     while the engine still reports the detail. There the snapshot is the *detail*, not the
     list under it (`captureRouteSnapshot`), carried at its own inner scroll offset
     (`lib/pageSnapshot.ts`), and it leaves on a plain fade: a drawer row or a link inside the
     picture used to cut straight to the next page. A close never gets here — it lands on its
     record's own page, so the background does not change. */
  const crossFadeEnabled =
    (imageHeroRuntime.phase === 'gallery-idle' && !imageHeroRuntime.background && !isImageDetailOpen) ||
    (imageHeroRuntime.phase === 'detail-idle' && !isImageDetailOpen);

  useEffect(() => {
    initializeImageHeroHistory({
      push: (href) => router.push(href, { scroll: false }),
      replace: (href) => router.replace(href, { scroll: false }),
      prefetch: (href) => router.prefetch(href),
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

  /* Restore the docked drawer's remembered state after mount — `localStorage` is the
     authority, the cookie the server's copy. Only from `md`, where there is a docked drawer
     to restore. queueMicrotask keeps setState out of the effect's synchronous body while
     still running before the next paint. */
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !window.matchMedia(MEDIA.md).matches) return;
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(LS_KEYS.sidebarCollapsed);
      } catch {
        return;
      }
      if (saved !== null) setDockedCollapsed(saved === 'true');
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

  /* A custom palette whose seed cookie did not reach this request is put back from storage
     (see `recoverCustomPalette`); nothing happens, and nothing loads, otherwise. */
  useEffect(() => recoverCustomPalette(), []);

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

  /* The animation engine, after the page is on screen: both are needed at the *first
   * interaction*, which is at minimum a user gesture away, so neither belongs in the
   * document. `runWhenIdle` avoids competing with hydration; each has a documented
   * no-animation fallback if somebody beats it. */
  useEffect(() => runWhenIdle(() => {
    warmMotion();
    warmRouteCrossFade();
  }), []);

  /* **`--app-chrome-bottom`**: the viewport y of the chrome's bottom edge — the dev banner,
     the app bar, the offline banner and the top safe-area inset — which toasts hang below and
     the navigation progress line rides. The CSS default is right for the server's first
     paint; this keeps it exact and live (a dismissed banner, the offline row opening, a
     rotation changing the inset all resize the chrome). */
  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const root = document.documentElement;
    const write = () =>
      root.style.setProperty('--app-chrome-bottom', `${chrome.getBoundingClientRect().bottom}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-chrome-bottom');
    };
  }, []);

  /* The theme control shows the scheme on screen and toggles the other one — light ↔ dark,
     relative to what is visible. 跟随系统 lives in /settings: here it made a three-way
     cycle over a two-way picture, where one press in three changed only the glyph. */
  const toggleScheme = () => {
    setSwapTo(nextScheme);
    changeScheme(nextScheme, getRevealOrigin());
  };

  const { user: storedUser, token } = useSession();
  const storedSession = storedUser as unknown as UserInfo | null;
  const [sessionEpoch, setSessionEpoch] = useState(0);
  useStaleStaffHintCleanup();

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
        clearAllTabScroll();
        setSessionEpoch((epoch) => epoch + 1);
      }
      previous = next;
      mirrorDerpiApiKey(current?.api_key);
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
     every navigation and twice per run.
     The badge also **polls every 60s while the tab is visible** (owner decision 13): a
     message arriving while the user reads a thread must reach the bell without a
     navigation. `refetchInterval` skips hidden and offline ticks and reads once on return. */
  const session = useResource(sessionUser, token ? { token } : SKIP);
  const unread = useResource(unreadCounts, token ? { token } : SKIP, { refetchInterval: 60_000 });

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

    /* The four fields the server does not return, kept from storage. */
    const merged = {
      ...stored,
      ...result.user,
      token: stored.token,
      /* One rule for every merge of a Derpibooru binding (review P2-F9's follow-up): absent or
         null keeps what is stored, only an explicit empty string clears it. */
      ...resolveDerpiCredentials(result.user as unknown as Record<string, unknown>, stored as unknown as Record<string, unknown>),
    };
    updateUserInfo(stored.token, merged);
  }, [session.data, token]);

  const userInfo = storedSession;

  // Below `md` the drawer overlays the content; at and above it is docked, and the swipe
  // gesture and close-on-navigate both switch off.
  const isOverlayDrawer = !useMediaQuery(MEDIA.md, true);

  /* The phone's drawer does not survive leaving phone territory (widening past `md` docks it),
     nor a route change, however that change was started. Adjusted during render: an effect
     would paint one frame of the old state first. */
  const [drawerRoute, setDrawerRoute] = useState(pathname);
  if (modalOpen && (!isOverlayDrawer || drawerRoute !== pathname)) setModalOpen(false);
  if (drawerRoute !== pathname) setDrawerRoute(pathname);

  const modalDrawerOpen = isOverlayDrawer && modalOpen;
  const drawerExpanded = isOverlayDrawer ? modalOpen : !dockedCollapsed;

  /* Persisted outside the state updater (an updater runs twice under StrictMode and must be
     pure) and only for the docked drawer: a phone's open drawer is not a desktop preference. */
  const toggleSidebar = () => {
    if (isOverlayDrawer) {
      setModalOpen((open) => !open);
      return;
    }
    const next = !dockedCollapsed;
    setDockedCollapsed(next);
    persistDockedCollapsed(next);
  };

  const closeModalDrawer = useCallback(() => setModalOpen(false), []);
  const handleMobileNavigation = () => {
    if (isOverlayDrawer) setModalOpen(false);
  };

  useScrollLock(modalDrawerOpen);
  /* `history`: Back closes the open drawer first, like every other modal surface (owner
     decision 1) — the layer holds one same-URL entry while it is up. */
  useOverlayLayer(modalDrawerOpen, sidebarRef, { onClose: closeModalDrawer, history: true });

  /* **Navigate first, sign out on arrival.** Signing out on the gated page re-rendered it
     signed out, which asked for a sign-in — two dialogs on the way out, the second still open
     over `/`. The session is cleared once the navigation has landed (or at once, on `/`). */
  const pendingLogout = useRef<{ token: string; from: string } | null>(null);
  useEffect(() => {
    const pending = pendingLogout.current;
    if (!pending || pending.from === pathname) return;
    pendingLogout.current = null;
    clearUserInfo(pending.token);
  }, [pathname]);

  const handleLogoutClick = async () => {
    if (!token) return;
    const confirmed = await confirm({
      title: '确认登出',
      message: '确定要登出当前账号吗？',
      tone: 'danger',
    });
    if (!confirmed) return;
    if (pathname === '/') {
      clearUserInfo(token);
      return;
    }
    pendingLogout.current = { token, from: pathname };
    router.push('/', { scroll: false });
  };

  /* **Focus has somewhere to land after a route change.** A link inside the page unmounts with
     it, which left focus on `<body>`: the next Tab started wherever the removed link had been
     (the first team card, halfway down /about) with nothing announced. When focus is lost —
     and only then, so a drawer row keeps its own — it moves to the incoming page's heading, or
     to `main` while the page has none yet. Never while the hero owns the screen (the detail
     places its own focus) or while a modal layer does.

     **Back to a list lands on what was opened from it.** A list marks the card or row of the page
     the reader has just left (`data-return-focus`: a folder card, `lib/folderTransit.ts`; a forum
     row, `components/ForumPostList.tsx`) — only for a moment after leaving it — and the landing
     takes that before the heading, as closing a picture returns the focus to its card. It is a
     control, so it is focused as itself (a keyboard sees its ring), never scrolled to: the
     restored offset owns the position, and a card it left off screen is still where the reader
     was. While the route's container transform still hides it (`visibility`, for its run) the
     landing waits for it rather than take the heading a frame before it shows.

     A focus resting on the scroller itself counts as lost too: that is where an earlier landing
     put it when the page had no heading yet (a folder page still reading its pictures), and it
     belongs to no page — left there, the next route change found focus "somewhere" and moved
     nothing. */
  const focusedPathname = useRef(pathname);
  useEffect(() => {
    /* Only a client navigation, never the document's own load: a pathname this effect has
       already seen is the cold load — whose page may still be hydrating, and whose nodes are
       React's to reconcile — or StrictMode's development re-run of the same effect (which is
       how a first-run flag failed: the re-run found the flag spent and wrote attributes onto a
       heading that had not hydrated). After a client navigation the incoming page is a client
       render, so nothing in it is waiting to hydrate. */
    if (focusedPathname.current === pathname) return;
    focusedPathname.current = pathname;
    /* Frame by frame until the heading takes focus: the route fade holds the incoming page
       hidden for its first beat, and focusing it there did nothing at all. Each attempt
       re-asks whether focus is still lost, so a click in the meantime wins. Past the bound the
       scroller itself takes it, which is always visible. */
    const started = performance.now();
    const giveUpAt = started + LANDING_WAIT_MS;
    let frame = 0;
    const land = () => {
      const main = mainRef.current;
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || active === main;
      if (!lost || !main || heroOwnsScreen() || hasModalLayer()) return;
      const back = main.querySelector<HTMLElement>('[data-page-content] [data-return-focus]');
      if (back) {
        back.focus({ preventScroll: true });
        if (document.activeElement === back) {
          back.removeAttribute('data-return-focus');
          return;
        }
        if (getComputedStyle(back).visibility === 'hidden' && performance.now() < started + RETURN_WAIT_MS) {
          frame = requestAnimationFrame(land);
          return;
        }
      }
      const heading = main.querySelector<HTMLElement>('[data-page-content] h1');
      if (focusLanding(heading ?? main)) return;
      if (performance.now() < giveUpAt) frame = requestAnimationFrame(land);
      else if (heading) focusLanding(main);
    };
    frame = requestAnimationFrame(land);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const skipToMain = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    /* An image detail over a list is the main content while it is up; the list under it is
       inert, and a landing there would silently fail. */
    const detail = document.querySelector<HTMLElement>('[data-image-detail-overlay]');
    if (isImageDetailOpen && detail) {
      focusLanding(detail);
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    const heading = main.querySelector<HTMLElement>('[data-page-content] h1');
    focusLanding(heading ?? main);
  };

  /* The chrome — both banners and the app bar — is covered by the phone's modal drawer and
     its scrim, and taken out of the tab order with it. **An image detail does not cover it.**
     The overlay fills the content area only, so the app bar and a docked drawer stay live beside
     it, exactly as they are on the detail's own page; making them inert as well left chrome on
     screen that no click reached (the list under the overlay is what goes inert —
     `galleryInert`). */
  const chromeInert = modalDrawerOpen;
  /* The drawer row — and the wordmark — of the very page an image detail covers means 返回, as
     re-selecting the current destination does in a native navigation bar. A close already on its
     way home has answered the press. */
  const reselectCovered = useCallback(
    () => getImageHeroRuntime().direction === 'back' || requestImageDetailClose(),
    [],
  );
  const coveredHomeGallery =
    isImageDetailOpen && onHome && new URLSearchParams(frozenBackgroundSearch ?? '').get('tab') !== 'forum';

  return (
    <BackgroundLocationProvider frozenSearch={frozenBackgroundSearch}>
      {/* `data-app-root`: while a modal surface portalled outside the shell is up, this is
          made `inert` (`lib/overlay.ts`); toasts, dialogs and live regions live outside it.
          The phone's drawer is a modal layer *inside* it, so it inerts its siblings here
          instead. */}
      <div data-app-root className="h-full flex flex-col overflow-hidden">
        {/* The first tab stop. Visually hidden until it takes focus; moves focus to the page's
            heading rather than following a fragment, which would add a history entry. */}
        <a
          href="#app-main"
          onClick={skipToMain}
          className={buttonClasses({
            variant: 'surface',
            className:
              'sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-[calc(env(safe-area-inset-top)+0.75rem)] focus-visible:left-[max(1rem,env(safe-area-inset-left))] focus-visible:z-skip-link',
          })}
        >
          跳到主要内容
        </a>

        {/* The chrome band. Everything in it counts towards `--app-chrome-bottom`; the band,
            not each row, takes the app-bar layer. */}
        <div ref={chromeRef} className="relative z-app-bar flex shrink-0 flex-col">
          <DevBanner initiallyVisible={devBannerVisible} inert={chromeInert} />
          {/* **64dp app bar at every density** (`AppBarSmallTokens.ContainerHeight`) — the
              bar is the one fixed band, not repeated chrome, so the density step does not
              apply; the 56dp-feel came from the controls in it, which are 40dp now.
              Horizontal inset 16px on a phone, 104px from `sm`: deliberate breathing room
              around the brand — the bar spans drawer and content and belongs to neither,
              so aligning it to either grid is false precision. Both insets yield to a
              larger safe-area inset (a notch in landscape), and the bar pays the top inset
              itself unless the dev banner above it does (`data-app-bar` rule in globals.css).
              **`--touch-floor: 48px` locally, so the bar opts out of the pointer axis.**
              These five are the app's most-used controls, alone on a 64dp coloured band;
              at 40dp with 104px of air either side they read as small glyphs rather than
              chrome. One declaration on the band rather than five on the controls.
              `select-none`: chrome, not content — a long-press must not select a label. */}
          <header
            data-app-bar
            inert={chromeInert || undefined}
            className="box-content flex h-16 shrink-0 select-none items-center bg-primary text-on-primary-variant [--touch-floor:48px] pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(6.5rem,env(safe-area-inset-left))] sm:pr-[max(6.5rem,env(safe-area-inset-right))]"
          >
            {/* `IconButton variant="on-primary"`: the primitive's variant whose focus ring
                survives a pink background. `size="md"` — 40dp, `SmallIconButtonTokens`, what
                AOSP's own app bar uses; `touch-size` grows the hit region back on a touch
                device without moving the glyph. */}
            <IconButton
              variant="on-primary"
              size="md"
              onClick={toggleSidebar}
              aria-label={drawerExpanded ? '收起侧边栏' : '展开侧边栏'}
              aria-expanded={drawerExpanded}
              aria-controls="app-sidebar"
              className="mr-1 touch-size sm:mr-3"
              icon={<MdMenu size={ICON.standard} />}
            />
            <Link
              scroll={false}
              href="/"
              /* The wordmark is the 主页 row's twin: over the gallery an image detail covers, it
                 closes the detail rather than pushing the gallery again. */
              onClick={(event) => {
                if (coveredHomeGallery && reselectCovered()) event.preventDefault();
              }}
              aria-label="PicPony 主页"
              /* Visible on a phone too: the brand's only appearance on the majority viewport
                 and the one-tap route home. `touch-size` because the wordmark is 28px tall
                 and an anchor wrapping it inherits that, while every button beside it clears
                 the floor. The app's own ring on the bar (`focus-ring-on-primary`), not the
                 browser's outline. Under 360px the mark steps down a size: at 320px the five
                 48px targets and the full mark overran the bar's right inset. */
              className="relative mr-2 flex shrink-0 touch-size items-center rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-ring-on-primary"
            >
              {/* One wordmark component for header and footer; `keyline` is the part that is
                  genuinely header-specific, and so is the one-time boot signature. */}
              <Logo className="h-auto w-20 max-[359px]:w-16 sm:w-25" keyline introOnce />
            </Link>
            <IconButton
              ref={themeButtonRef}
              variant="on-primary"
              size="md"
              onClick={toggleScheme}
              /* States the scheme on screen and the one a press gives — the tooltip follows
                 from the label. */
              aria-label={`${SCHEME_LABEL[scheme]}，切换为${SCHEME_LABEL[nextScheme]}`}
              className="ml-1 touch-size"
              icon={
                <span
                  ref={themeIconRef}
                  key={scheme}
                  className={cn('block', swapTo === scheme && 'animate-icon-swap')}
                >
                  {/* The glyph shows the scheme you are *in*, not the one you would switch
                      to — matching the label beside it. */}
                  {scheme === 'dark' ? (
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
                fifth copy of it. The badge is a **sibling** of the anchor, not a child:
                `data-ripple` sets `overflow: hidden`, and a corner badge on a circular clip
                always loses its outer arc. The anchor's `aria-label` carries the count, so
                the badge is decorative. */}
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
          {maintenance && <MaintenanceNotice inert={chromeInert} />}
          <OfflineBanner inert={chromeInert} />
        </div>

        {/* The phone's modal drawer and its scrim clear the chrome band (M3's modal drawer
            covers the window and dims everything else, the app bar and banners included — a
            bright app bar above an open drawer looked live and was not). Both are fixed and
            take their own layers above the band's. The scrim is not a component fading in
            place — it is the other half of the drawer moving — so it shares whatever clock
            the panel is on, including the asymmetry. */}
        <div
          ref={scrimRef}
          className={cn(
            'fixed inset-0 z-drawer-scrim bg-scrim-veil transition-opacity md:hidden',
            modalOpen
              ? 'spring-default-spatial opacity-100'
              : 'spring-fast-effects pointer-events-none opacity-0',
          )}
          onClick={closeModalDrawer}
          aria-hidden="true"
        />

        <div className="relative flex flex-1 overflow-hidden bg-surface-container-low">
          <aside
            ref={sidebarRef}
            id="app-sidebar"
            role={modalDrawerOpen ? 'dialog' : undefined}
            aria-modal={modalDrawerOpen || undefined}
            aria-label="侧边栏"
            tabIndex={-1}
            /* Hidden from assistive tech while closed, so the nav links inside are not
               reachable by Tab from behind the scrim. */
            aria-hidden={!drawerExpanded ? 'true' : undefined}
            inert={!drawerExpanded || undefined}
            /* **288dp, a deliberate divergence** from M3's 360dp navigation drawer: docked from
               `md` up, its width comes out of the content area — on an image gallery those
               72px are a column of thumbnails. The negative right margin must match it.
               On a phone it is the **modal** drawer: full height above the chrome, the
               trailing corners rounded, level-1 elevation (`ModalDrawerElevation`), and never
               wider than the window less 56dp, so a 320px phone keeps a band of scrim to tap.
               Closed, it sits a little past its own width so its shadow is off screen too.

               **The panel slides; it is not clipped.** The whole aside translates and (docked)
               a negative margin closes the layout behind it: the content travels because it is
               *inside* the thing that moves, the panel never resizes, `translate` composites.

               **A spring, and a different one per direction — M3's `NavigationDrawer.kt`:**
               open = `DefaultSpatial` (ζ0.9, 194ms), close = `FastEffects` (ζ1.0, 108ms),
               critically damped because a panel leaving must not overshoot back into view.
               Applied per branch and per breakpoint, because a transition is governed by the
               *after-change* style — the class the element is gaining is the one whose timing
               runs, and the phone's state and the docked state move independently. */
            className={cn(
              'flex flex-col overflow-hidden bg-surface-container-low transition-[margin-right,translate]',
              'fixed inset-y-0 left-0 z-drawer w-[min(18rem,calc(100vw-3.5rem))] rounded-r-lg shadow-e1',
              'md:relative md:inset-auto md:z-auto md:h-full md:w-72 md:shrink-0 md:rounded-none md:shadow-none',
              modalOpen
                ? 'spring-default-spatial translate-x-0'
                : 'spring-fast-effects -translate-x-[calc(100%+0.5rem)]',
              dockedCollapsed
                ? 'md:spring-fast-effects md:-translate-x-full md:-mr-72'
                : 'md:spring-default-spatial md:translate-x-0 md:mr-0',
            )}
          >
            {/* `w-full`, not a second width declaration. `popover-scrollbar`: the drawer is not
                the page column, and reserving a gutter left every row 10px nearer its left edge
                than its right. `overscroll-y-contain`: the end of the list does not chain into
                the page behind the scrim. The top inset is the modal drawer's own (it covers the
                status bar area); docked, the chrome above has already paid it. */}
            <div className="popover-scrollbar flex w-full flex-1 flex-col overflow-y-auto overscroll-y-contain pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pt-0">
              <div className="p-3 pb-0">
                {userInfo ? (
                  <Link
                    scroll={false}
                    href={`/user/${userInfo.id}`}
                    onClick={handleMobileNavigation}
                    data-ripple
                    /* A two-line list item (avatar, name, supporting line), so the geometry
                       comes from `ListTokens` rather than the drawer's item — 16dp corner,
                       16dp leading, 40dp avatar, 12dp between. It is the drawer's *header*,
                       not a nav row: a pill is the shape the rows below use to mean "you are
                       here". The avatar starts on the same 28dp leading column as every nav
                       icon (12dp nav inset + 16dp item inset), which is the part that has to
                       agree. **64dp at every density, with `ListTokens`' own 40dp avatar.** */
                    className="state-layer flex h-16 w-full items-center gap-3 rounded-lg px-4 focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
                  >
                    <Avatar src={userInfo.avatar} name={userInfo.username} size={40} />
                    <div className="min-w-0 flex-1">
                      {/* `title-s` (14px, weight 500), the same size as the links below it,
                          so the drawer reads as one column. */}
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
                    className="state-layer group flex h-16 w-full cursor-pointer items-center gap-3 rounded-lg px-4 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
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
              {/* Always drawn, signed in or out: the division it marks is structural — above
                  it is who you are, below it is where you can go. `shrink-0`, or this 1px flex
                  item absorbs the column's whole overflow and collapses to nothing. On the
                  drawer's 28dp content column, like the rule inside the nav: 12dp nav inset +
                  16dp — one kind of line, one geometry. */}
              <div className="bg-outline-variant mx-7 my-2 h-px shrink-0" />
              <SidebarNav
                user={userInfo}
                backgroundPathname={backgroundPathname}
                unread={totalUnread}
                onNavigate={handleMobileNavigation}
                onLogout={() => void handleLogoutClick()}
                onReselect={isImageDetailOpen ? reselectCovered : undefined}
              />
            </div>
          </aside>
          <section
            data-image-detail-host
            data-home-bar={onHome || undefined}
            inert={modalDrawerOpen || undefined}
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface pr-[env(safe-area-inset-right)] sm:m-3 sm:rounded-md',
              /* The left inset is the drawer's while it is docked open beside the content. */
              (isOverlayDrawer || dockedCollapsed) && 'pl-[env(safe-area-inset-left)]',
            )}
          >
            <div className="relative min-h-0 flex-1">
              {/* Where `PageBack` lands: the back affordance is chrome, not content. Rendered
                  inside the page it was cloned by the route snapshot and translated by the
                  shared axis. A portal keeps the page as owner of handler and label while the
                  node lives out here. **Before `main` in the DOM**, which is the tab order: it
                  is drawn first, at the top left, and after the scroller it was the last stop
                  on the page, after the whole footer. Position is unaffected (`absolute
                  inset-0`); `z-page-chrome` still orders it above the cross-fade layer and
                  below the image-detail overlay and Stage. */}
              <div
                data-page-back-slot
                /* No `aria-hidden` here, despite this being a positioning shim: what gets
                   portalled into it is a real, focusable control. */
                className="pointer-events-none absolute inset-0 z-page-chrome"
              />
              <main
                ref={mainRef}
                id="app-main"
                data-image-detail-background
                inert={galleryInert || undefined}
                data-image-hero-gallery-scroll
                data-scroll-hidden={detailCovers || undefined}
                className="app-scroller main-scrollbar absolute inset-0 w-full overflow-y-scroll bg-surface outline-hidden"
              >
                <div
                  data-image-detail-background-visual
                  className="flex min-h-full w-full flex-col"
                >
                  <div
                    key={`${backgroundPathname}:${sessionEpoch}`}
                    data-page-content
                    className="animate-page-transition flex flex-1 flex-col p-4 sm:p-6"
                  >
                    {/* A flex column, and `[&>*]:w-full` is not optional with it. The column
                        exists so `StatusView`'s `fill` can be `flex-1` — a percentage
                        min-height resolves only against a *definite* parent height, and this
                        element's comes from flex distribution, which Chrome treats as
                        indefinite. The `w-full` is load-bearing: a flex item in a column is
                        stretched on the cross axis **unless it has an auto margin there**,
                        and every page root here is `mx-auto max-w-*`, so without it they all
                        fall back to shrink-to-fit. Safe because every route puts exactly one
                        element in here. */}
                    <div className="flex flex-1 flex-col [&>*]:w-full">{children}</div>
                    {/* Inside the page, not beside it: as a sibling of the content the mark
                        was the one thing a page transition could not move. `page-chrome` is
                        left on for the one move it still cannot join — a tab switch, where
                        the panes that slide are above it inside the same page — and for the
                        hold while the page is still a placeholder (globals.css).
                        **Centred at every width**: it belongs to no page column, and aligned
                        to the scroller's edge it lined up with nothing on the list routes. */}
                    <footer
                      /* Held (not shown) while the page is still a placeholder — decided by
                         `holdFooterWhileLoading`, painted held by the server. */
                      ref={holdFooterWhileLoading}
                      data-page-held=""
                      className="page-chrome mt-auto flex flex-col items-center gap-4 pt-10 text-center text-on-surface-variant sm:pt-12"
                    >
                      {/* `text-outline`, not a dimmed copy of the footer's own ink: `Logo`
                          paints through a mask from `currentColor`, and `outline` is the
                          documented role for a *graphic* that should read quieter than the
                          prose beside it (clears the 3:1 non-text bar). Not interactive:
                          nobody points at a footer mark to see it draw. */}
                      <Logo className="h-8 w-auto text-outline" interactive={false} />
                      <nav aria-label="站内导航" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-label-l">
                        <Link
                          scroll={false}
                          href="/about"
                          className="touch-target rounded-xs transition-ui focus-visible:outline-hidden hover:text-on-surface hover:underline focus-visible:ring-2 focus-ring"
                        >
                          关于本站
                        </Link>
                        <span aria-hidden="true" className="text-outline">
                          ·
                        </span>
                        <Link
                          scroll={false}
                          href="/policy"
                          className="touch-target rounded-xs transition-ui focus-visible:outline-hidden hover:text-on-surface hover:underline focus-visible:ring-2 focus-ring"
                        >
                          声明与政策
                        </Link>
                      </nav>
                      <div className="text-body-s">
                        <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                        <p>本站为 Derpibooru 第三方镜像站点</p>
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
              {/* The sibling immediately above `RouteCrossFade`, so the ordering is stated
                  rather than incidental: within one commit phase React runs siblings in
                  render order. See `lib/scrollMemory.ts`. */}
              <RouteScrollMemory />
              <RouteCrossFade pathname={backgroundPathname} enabled={crossFadeEnabled} />
              {/* Renders nothing; it exists so the swipe's hook can be mounted only once the
                  engine has arrived. Above 768px the drawer is docked and this never loads. */}
              <DrawerSwipe
                drawerRef={sidebarRef}
                scrimRef={scrimRef}
                open={modalDrawerOpen}
                onOpenChange={setModalOpen}
                enabled={isOverlayDrawer && !isImageDetailRoute && !imageHeroRuntime.background}
              />
              <Suspense fallback={null}>
                <HeroStage />
              </Suspense>
              {/* The slot arrives from the server as a lazy reference, and among static siblings
                  React resolves it during reconciliation and finds an element nothing marked as
                  checked — a missing-key warning on every route. As the single child of its own
                  fragment it is never in a list. No DOM node.
                  `ImageDetailSlot` tells the route fallback it is not in the page column: Next
                  gives this slot the root `loading.tsx` too, and a slot waiting on a Back drew
                  that page silhouette here, over the page (`components/ImageDetailSlot.tsx`). */}
              <ImageDetailSlot>
                <DetailOverlayTransit open={isImageDetailOpen}>
                  <Fragment>{overlay}</Fragment>
                </DetailOverlayTransit>
              </ImageDetailSlot>
            </div>
            <Suspense fallback={null}>
              {/* `isImageDetailOpen` alone is not enough: the overlay is torn down before the
                  hero flies home, so keying off it would pop the pill back in behind the
                  still-moving image. The hero runtime reports the flight itself. */}
              <TabNavBar
                onHome={onHome}
                hidden={isImageDetailOpen || Boolean(imageHeroRuntime.background)}
              />
            </Suspense>
          </section>
        </div>
        <AnnouncementModal />
        {confirmDialog}
      </div>
      <CompanionHost />
    </BackgroundLocationProvider>
  );
}
