'use client';

import {
  useState,
  FormEvent,
  Suspense,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import {
  MdMenu,
  MdSearch,
  MdPerson,
  MdNotifications,
  MdDarkMode,
  MdLightMode,
  MdPhotoLibrary,
  MdForum,
  MdBrightnessAuto,
} from 'react-icons/md';

import dynamic from 'next/dynamic';
const AnnouncementModal = dynamic(() => import('./AnnouncementModal'), { ssr: false });
const Modal = dynamic(() => import('./Modal'), { ssr: false });
import Logo from './Logo';
import Avatar from './Avatar';
import DevBanner from './DevBanner';
import SidebarNav from './SidebarNav';
import { useAuthModal } from './AuthModal';
import { BackgroundLocationProvider, useBackgroundSearchParams } from './BackgroundLocation';
import { api } from '@/lib/api';
import { readJson } from '@/lib/api/client';
import { clearSnapshots } from '@/lib/pageCache';
import {
  getImageHeroRuntime,
  getImageHeroBackgroundLocation,
  initializeImageHeroHistory,
  subscribeImageHeroRuntime,
} from '@/lib/hero';
import HeroStage from '@/components/HeroStage';
import RouteCrossFade from '@/components/RouteCrossFade';
import Button from '@/components/Button';
import {
  circularReveal,
  setTabIntent,
  startTabTransition,
  useDrawerSwipe,
  useSlidingIndicator,
} from '@/lib/motion';
import { useMediaQuery } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';

function SearchBar() {
  const router = useRouter();

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    router.push('/search');
  };

  return (
    <form onSubmit={handleSearch}>
      <button
        type="submit"
        title="搜索"
        aria-label="搜索"
        data-ripple
        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-on-primary state-layer transition-ui outline-none focus-visible:ring-2 focus-visible:ring-on-primary/50"
      >
        <MdSearch size={24} />
      </button>
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
 * Long enough to sit past the end of the slide, which is the point. The push
 * costs a React commit and an RSC navigation, and at 160ms that landed square
 * in the middle of the transition: measured on the home switch, two frames of
 * 41ms and 38ms against a 16.6ms median, right where the panes are moving
 * fastest. Nothing is waiting for it — the transition owns the pane flags and
 * `pendingTab` owns the pill — so the only thing deferring costs is how soon
 * the URL agrees, and no one is looking at the URL mid-slide.
 *
 * It also swallows a burst of taps into one push, which is what it was
 * originally for.
 */
const TAB_PUSH_COALESCE_MS = 480;

function TabNavBar({ hidden }: { hidden: boolean }) {
  const searchParams = useBackgroundSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get('tab') === 'forum' ? 'forum' : 'gallery';
  // Optimistic tab so the pill and label colors respond on click, before the
  // route (and its search params) actually commit.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? currentTab;
  const { containerRef, indicatorRef } = useSlidingIndicator(activeTab);

  /* Whether a tab navigation we started is still on its way. `router.push` is
     run inside this transition purely so React will tell us — it is the only
     signal that distinguishes "the URL agrees with the user" from "the URL is
     briefly agreeing on its way somewhere else". */
  const [isNavigating, startNavigation] = useTransition();

  /* Pushing on every tap queues one navigation per tap, and each of those
     commits later lands as its own `tab` change — so after a burst of taps the
     panes replayed the whole burst back at you. The animation is optimistic
     and instant, so only the *final* destination needs to reach the router;
     this collapses a burst into one push. */
  const pushTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    },
    [],
  );

  /* Adjust-during-render: once the route commits, the optimistic tab is stale.
     Once it has *finished* committing, though. The URL trails the taps by a
     coalescing window plus a navigation, so during a burst it passes through
     values the user has already moved on from — and one of those can equal the
     optimistic tab by coincidence. Releasing there handed control back to a URL
     that was still in motion, and the next commit dragged the tab backwards:
     measured on taps 180ms apart, 论坛 → 图库 → 论坛 landed on 图库, because the
     third tap then read as a no-op against the tab it had just been dragged
     onto and was swallowed. `isNavigating` is the missing piece — with nothing
     in flight the URL cannot move again on its own.

     A queued push needs no guard of its own: it always targets `pendingTab`,
     so if the URL already agrees with `pendingTab` that push is a no-op. */
  if (pendingTab && pendingTab === currentTab && !isNavigating) setPendingTab(null);

  /* The panes live in the page and see only the URL, which trails these taps by
     a coalescing window plus a navigation. Hand them the tab the user is really
     on so they do not animate to a waypoint on the way. Cleared on unmount,
     which is what keeps an intent from outliving the home route. */
  useEffect(() => {
    setTabIntent(pendingTab);
    return () => setTabIntent(null);
  }, [pendingTab]);

  const switchTab = (tab: string) => {
    if (tab === activeTab) return;
    setPendingTab(tab);
    /* Both panes are already mounted, so the transition does not need the
       route — it only needs the attribute that gives the incoming pane a box,
       and it sets that itself. Gallery sits left of forum, so moving right
       sends the outgoing pane left. */
    startTabTransition(activeTab, tab, tab === 'forum' ? 1 : -1);

    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'gallery') params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    const href = qs ? `/?${qs}` : '/';

    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      /* `scroll: false`: Next scrolls the new segment into view on commit,
         which would fight the per-tab offset `startTabTransition` restored. */
      startNavigation(() => router.push(href, { scroll: false }));
    }, TAB_PUSH_COALESCE_MS);
  };

  const tabClass = (tab: string) =>
    `relative z-10 flex items-center gap-2 px-5 py-2.5 rounded-full text-label-l transition-ui ${
      activeTab === tab
        ? 'text-primary font-medium'
        : 'text-on-surface-variant hover:text-on-surface'
    }`;

  return (
    /* Kept mounted while an image-detail overlay is open rather than unmounted:
       the sliding indicator measures its target on mount, so tearing it down
       and rebuilding it makes the pill jump back to x=0 on the way out. It fades
       instead, on the same 220ms the hero flight uses for card chrome, so the
       two leave together.
       `data-image-detail-chrome` was previously set here and consumed nowhere —
       the pill just sat at z-50 on top of the overlay.
       z-30 keeps it under the drawer scrim (z-40): the host `<section>` is
       positioned but not a stacking context, so the pill's z competes directly
       with the shell's. At z-50 it floated over the open drawer. */
    <div
      data-image-detail-chrome
      data-chrome-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-center py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,translate] duration-200 ease-[var(--ease-accelerate)] ${
        hidden ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <div
        ref={containerRef}
        className="pointer-events-auto relative flex items-center gap-1 rounded-full bg-surface-container-high p-1 shadow-e3"
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className="absolute left-0 top-1 bottom-1 z-0 rounded-full bg-surface-raised shadow-e1"
        />
        <button
          data-tab="gallery"
          data-ripple
          onClick={() => switchTab('gallery')}
          className={tabClass('gallery')}
        >
          <MdPhotoLibrary size={18} />
          <span>图库</span>
        </button>
        <button
          data-tab="forum"
          data-ripple
          onClick={() => switchTab('forum')}
          className={tabClass('forum')}
        >
          <MdForum size={18} />
          <span>论坛</span>
        </button>
      </div>
    </div>
  );
}

export default function AppLayout({
  children,
  overlay,
  initialCollapsed,
  initialDark,
}: {
  children: React.ReactNode;
  overlay: React.ReactNode;
  initialCollapsed: boolean;
  initialDark: boolean;
}) {
  // Keep the first client render identical to SSR. Browser-only sources
  // (viewport, localStorage) are applied after mount to avoid hydration mismatch.
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [darkMode, setDarkMode] = useState(initialDark);

  const [followSystem, setFollowSystem] = useState(true);
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
  /* Any `/pic/:id` screen, intercepted overlay or direct navigation.
     `isImageDetailOpen` only covers the overlay, so opening an image link
     directly left the drawer's edge-swipe armed underneath the detail view —
     and since that screen is one you pan and swipe on, the sidebar kept
     flashing out from the left mid-gesture. */
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
  const imageHeroBackground =
    imageHeroRuntime.background ?? (bridgeRouteCommit ? retainedHeroBackground : null);
  const backgroundPathname = imageHeroBackground?.pathname ?? (isImageDetailOpen ? '/' : pathname);
  /* The hero owns the same pixels during a flight — it transforms the
     background, freezes this very pathname, and paints a flyer over the lot —
     so the route cross-fade stands down entirely while one is in progress. */
  const crossFadeEnabled =
    imageHeroRuntime.phase === 'gallery-idle' &&
    !imageHeroRuntime.background &&
    !isImageDetailRoute;
  const frozenBackgroundSearch = imageHeroBackground?.search ?? (isImageDetailOpen ? '' : null);

  useEffect(() => {
    initializeImageHeroHistory({
      push: (href) => router.push(href, { scroll: false }),
      replace: (href) => router.replace(href, { scroll: false }),
    });
  }, [router]);

  const applyDarkMode = useCallback((dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    document.cookie = `darkMode=${dark};path=/;max-age=${365 * 24 * 60 * 60}`;
  }, []);

  const commitTheme = useCallback(
    (dark: boolean, followsSystem?: boolean) => {
      flushSync(() => {
        if (followsSystem !== undefined) setFollowSystem(followsSystem);
        setDarkMode(dark);
      });
      applyDarkMode(dark);
    },
    [applyDarkMode],
  );

  const getRevealOrigin = useCallback(() => {
    // The icon, not its 40×40 hit target: every entry point into a theme change
    // grows the wipe out of the glyph itself. They share a centre while the
    // button is a bare square, but the button is free to gain padding or a
    // label, and the fallback below used to be the top edge of the viewport.
    const element = themeIconRef.current ?? themeButtonRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return undefined;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  // Apply browser-only preferences after mount so the first paint matches SSR.
  // queueMicrotask keeps setState out of the effect's synchronous body
  // (react-hooks/set-state-in-effect) while still running before the next paint.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      const storedFollowSystem = localStorage.getItem('followSystemPrefersColorScheme');
      const shouldFollowSystem = storedFollowSystem === null || storedFollowSystem === 'true';
      setFollowSystem(shouldFollowSystem);

      if (shouldFollowSystem) {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setDarkMode(isDark);
        applyDarkMode(isDark);
      } else {
        const storedDark = localStorage.getItem('darkMode');
        const isDark = storedDark === 'true';
        setDarkMode(isDark);
        applyDarkMode(isDark);
      }

      // Width is handled during render above; this only restores the docked
      // drawer's remembered state, and must not fight it on a phone.
      if (window.matchMedia(MEDIA.md).matches) {
        const savedSidebar = localStorage.getItem('sidebar_collapsed');
        if (savedSidebar !== null) setIsCollapsed(savedSidebar === 'true');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applyDarkMode]);

  useEffect(() => {
    if (!followSystem) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches === darkMode) return;
      circularReveal(() => {
        commitTheme(e.matches);
      }, getRevealOrigin());
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [followSystem, darkMode, commitTheme, getRevealOrigin]);

  const cycleThemeMode = () => {
    const currentMode = followSystem ? 'system' : darkMode ? 'dark' : 'light';
    const nextMode = currentMode === 'light' ? 'dark' : currentMode === 'dark' ? 'system' : 'light';

    if (nextMode === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      localStorage.setItem('followSystemPrefersColorScheme', 'true');
      if (systemDark === darkMode) {
        commitTheme(systemDark, true);
      } else {
        circularReveal(() => {
          commitTheme(systemDark, true);
        }, getRevealOrigin());
      }
      return;
    }

    const nextDark = nextMode === 'dark';
    localStorage.setItem('followSystemPrefersColorScheme', 'false');
    localStorage.setItem('darkMode', String(nextDark));
    if (nextDark === darkMode) {
      commitTheme(nextDark, false);
    } else {
      circularReveal(() => {
        commitTheme(nextDark, false);
      }, getRevealOrigin());
    }
  };

  useEffect(() => {
    const fetchUnreadCounts = async () => {
      if (userInfo && userInfo.token) {
        try {
          const data = await api.getUnreadCounts(userInfo.token);
          if (data.success) {
            setTotalUnread(data.total_unread);
          }
        } catch (error) {
          console.error('Failed to fetch unread counts:', error);
        }
      } else {
        setTotalUnread(0);
      }
    };

    fetchUnreadCounts();

    window.addEventListener('unread_counts_updated', fetchUnreadCounts);
    return () => window.removeEventListener('unread_counts_updated', fetchUnreadCounts);
  }, [userInfo]);

  useEffect(() => {
    const updateUserInfo = async () => {
      const storedUser = localStorage.getItem('user_info');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUserInfo(parsedUser);

          if (parsedUser.token) {
            try {
              const res = await api.getUser(parsedUser.token);

              if (res.status === 401) {
                localStorage.removeItem('user_info');
                setUserInfo(null);
                return;
              }

              /* `readJson`, not `res.json()`. This endpoint answers 200 with an
                 empty body when the PHP session is gone or the proxy hiccups,
                 and `res.json()` then throws `Unexpected end of JSON input` out
                 of an effect that runs on every navigation. The branch below
                 already treats a missing `success` as "leave the stored user
                 alone", which is the right answer for an unreadable body too. */
              const data = await readJson(res);
              if (data.success && data.user) {
                const updatedUser = {
                  ...parsedUser,
                  ...data.user,
                  token: parsedUser.token,
                  api_key: parsedUser.api_key,
                  derpi_user_id: parsedUser.derpi_user_id,
                  derpi_username: parsedUser.derpi_username,
                };
                localStorage.setItem('user_info', JSON.stringify(updatedUser));
                setUserInfo(updatedUser);
              }
            } catch (err) {
              console.error('Failed to fetch latest user info', err);
            }
          }
        } catch (e) {
          console.error('Failed to parse user info', e);
        }
      } else {
        setUserInfo(null);
      }
    };

    updateUserInfo();

    window.addEventListener('user_info_updated', updateUserInfo);
    return () => window.removeEventListener('user_info_updated', updateUserInfo);
  }, [backgroundPathname]);

  // Below `md` the drawer overlays the content; at and above it is docked, and
  // the swipe gesture and auto-collapse-on-navigate both switch off.
  const isOverlayDrawer = !useMediaQuery(MEDIA.md, true);

  /* Entering overlay territory collapses the drawer, so it never sits open
     across a phone-width viewport.

     Adjusted during render rather than from an effect, and this is the whole
     point: SSR cannot know the viewport, so the first paint assumes the docked
     desktop drawer. On a phone the media query flips to "overlay" at hydration
     — and if the persisted preference said "expanded", the drawer painted open
     over the content for a frame or two before any effect could close it. That
     is the sidebar appearing out of nowhere on the home and settings screens.
     Reacting during render closes it before the browser ever paints it. */
  const [wasOverlayDrawer, setWasOverlayDrawer] = useState(isOverlayDrawer);
  if (isOverlayDrawer !== wasOverlayDrawer) {
    setWasOverlayDrawer(isOverlayDrawer);
    if (isOverlayDrawer) setIsCollapsed(true);
  }

  const toggleSidebar = () => {
    setIsCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem('sidebar_collapsed', String(newState));
      // Cookie keeps SSR in sync with the last desktop preference.
      document.cookie = `sidebarCollapsed=${newState};path=/;max-age=${365 * 24 * 60 * 60}`;
      return newState;
    });
  };

  const handleMobileNavigation = () => {
    if (isOverlayDrawer) setIsCollapsed(true);
  };

  const setDrawerOpen = useCallback((next: boolean) => setIsCollapsed(!next), []);

  useDrawerSwipe({
    drawerRef: sidebarRef,
    scrimRef: scrimRef,
    open: !isCollapsed,
    onOpenChange: setDrawerOpen,
    enabled: isOverlayDrawer && !isImageDetailRoute && !imageHeroRuntime.background,
  });

  const handleLogoutClick = () => {
    setIsLogoutDialogOpen(true);
  };

  const handleLogoutConfirm = () => {
    localStorage.removeItem('user_info');
    // Signing out does not reload the document, so the render snapshots have to
    // be dropped by hand or the next account inherits this one's inbox.
    clearSnapshots();
    setUserInfo(null);
    setIsLogoutDialogOpen(false);
    router.push('/');
  };

  const handleLogoutCancel = () => {
    setIsLogoutDialogOpen(false);
  };

  return (
    <BackgroundLocationProvider frozenSearch={frozenBackgroundSearch}>
      <div className="h-full flex flex-col overflow-hidden">
        <DevBanner />
        <header className="h-16 bg-primary text-on-primary flex items-center px-4 sm:px-26 shrink-0 relative z-50">
          <button
            onClick={toggleSidebar}
            aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!isCollapsed}
            aria-controls="app-sidebar"
            data-ripple
            className="inline-flex h-11 w-11 items-center justify-center rounded-full mr-1 sm:mr-3 state-layer text-on-primary transition-ui outline-none focus-visible:ring-2 focus-visible:ring-on-primary/50"
          >
            <MdMenu size={24} />
          </button>
          <Link
            href="/"
            aria-label="PicPony 主页"
            className="relative mr-2 hidden shrink-0 items-center sm:flex"
          >
            {/* The header used to carry its own copy of the wordmark and its own
                copy of the hover — same idea as `Logo.tsx`, drifted to a
                different width and a keyline the other never had. One component
                now; `keyline` is the part that was genuinely header-specific. */}
            <Logo className="h-auto w-25" keyline />
          </Link>
          <button
            ref={themeButtonRef}
            onClick={cycleThemeMode}
            aria-label="切换主题模式"
            title={followSystem ? '跟随系统' : darkMode ? '深色模式' : '浅色模式'}
            data-ripple
            className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full state-layer text-on-primary transition-ui outline-none focus-visible:ring-2 focus-visible:ring-on-primary/50"
          >
            <span
              ref={themeIconRef}
              key={followSystem ? 'system' : String(darkMode)}
              className="block animate-[icon-swap_0.35s_var(--ease-spring)]"
            >
              {/* The glyph shows the mode you are *in*, not the one you would
                switch to — which is what the tooltip beside it already says.
                It used to show the opposite (a sun while in dark mode), so the
                icon and its own tooltip disagreed. */}
              {followSystem ? (
                <MdBrightnessAuto size={24} />
              ) : darkMode ? (
                <MdDarkMode size={24} />
              ) : (
                <MdLightMode size={24} />
              )}
            </span>
          </button>
          <div className="flex-1" />
          <Suspense fallback={<div className="h-11 w-11 rounded-full bg-on-primary/10" />}>
            <SearchBar />
          </Suspense>
          <Link
            href="/messages"
            aria-label={totalUnread > 0 ? `消息（${totalUnread} 条未读）` : '消息'}
            data-ripple
            className="relative ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full state-layer text-on-primary transition-ui outline-none focus-visible:ring-2 focus-visible:ring-on-primary/50"
          >
            <MdNotifications size={24} />
            {totalUnread > 0 && (
              <span className="absolute top-1 right-1 bg-error-fill text-on-fill text-label-s-emphasized leading-none tabular-nums min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 animate-[control-pop_0.3s_var(--ease-spring)]">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </Link>
        </header>

        <div className="flex flex-1 overflow-hidden relative bg-surface-container-low">
          {/* Out on `standard` for the same reason the drawer is, and 100ms
              ahead of it: on `accelerate` the scrim held near-full opacity for
              most of its 200ms and then cleared all at once, so the dismissal
              read as the screen blinking rather than as the panel leaving.
              Letting the light come back first means the drawer's last 13px
              travel against a restored page, which is what makes it a
              movement. */}
          <div
            ref={scrimRef}
            className={`fixed inset-0 bg-scrim/50 z-40 md:hidden transition-opacity ${
              isCollapsed
                ? 'opacity-0 pointer-events-none duration-200 ease-[var(--ease-standard)]'
                : 'opacity-100 duration-400 ease-[var(--ease-decelerate)]'
            }`}
            onClick={() => setIsCollapsed(true)}
            aria-hidden="true"
          />
          <aside
            ref={sidebarRef}
            id="app-sidebar"
            /* Hidden from assistive tech while closed, so the nav links inside
               are not reachable by Tab from behind the scrim. */
            aria-hidden={isCollapsed ? 'true' : undefined}
            inert={isCollapsed ? true : undefined}
            /* `width` is not in `transition-ui` — deliberately, since animating it is
               usually a mistake. Here it is the whole point: the docked desktop
               drawer collapses by width, the overlay one by transform. Both are
               named explicitly.

               Asymmetric, per the spec's nav-drawer entry: 400ms decelerate on
               the way in. A symmetric 300ms `standard` in both directions — what
               this was — makes the drawer dawdle on dismissal, and dismissal is
               the half the user is waiting on.

               The way out is `standard`, not the `accelerate` the motion table
               gives a leaving element. That row is written for something small
               that leaves and is forgotten; this is a 288px container the eye
               tracks all the way off screen, and `accelerate` ends at its
               maximum velocity by construction. Measured over 288px at 200ms it
               moved 15% of its travel in the first 100ms and then cleared the
               remaining 171px in the last 50 — a 79px jump between frames and a
               4.75px/ms exit. Lengthening it does not help, because the shape is
               what is wrong: even at 400ms it still leaves at 2.66px/ms. It read
               as a cut rather than a movement. `standard` puts the speed where
               the panel is still visible and lands at 0.02px/ms, so it settles
               out of frame instead of snapping, and 300ms keeps it shorter than
               the 400ms entry. The swipe-close already landed softly on its own
               velocity-scaled `decelerate`; this makes the tap agree with it. */
            className={`bg-surface-container-low flex flex-col shrink-0 transition-[width,translate] overflow-hidden absolute md:relative h-full z-50 md:z-auto ${
              isCollapsed
                ? '-translate-x-full md:translate-x-0 md:w-0 duration-300 ease-[var(--ease-standard)]'
                : 'translate-x-0 w-72 duration-400 ease-[var(--ease-decelerate)]'
            }`}
          >
            <div className="main-scrollbar flex w-72 flex-1 flex-col overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="p-3 pb-0">
                {userInfo ? (
                  <Link
                    href={`/user/${userInfo.id}`}
                    onClick={handleMobileNavigation}
                    data-ripple
                    className="state-layer flex w-full items-center gap-3 rounded-md p-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Avatar src={userInfo.avatar} name={userInfo.username} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="text-title-s-emphasized text-on-surface truncate">
                        {userInfo.username}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-label-s bg-primary-container text-on-primary-container rounded px-1.5 py-0.5">
                          Lv.{userInfo.level ?? '?'}{' '}
                        </span>{' '}
                        {userInfo.derpi_username && (
                          <span
                            className="text-label-s text-success max-w-[100px] truncate"
                            title={userInfo.derpi_username}
                          >
                            {' '}
                            ✓ {userInfo.derpi_username}{' '}
                          </span>
                        )}{' '}
                      </div>{' '}
                    </div>{' '}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      openAuth('login');
                      handleMobileNavigation();
                    }}
                    data-ripple
                    className="state-layer group flex w-full cursor-pointer items-center gap-3 rounded-md p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {' '}
                    <span className="bg-surface-container-highest text-on-surface-variant flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                      {' '}
                      <MdPerson size={24} />{' '}
                    </span>{' '}
                    <span className="min-w-0">
                      {' '}
                      <span className="text-title-s text-on-surface block truncate ">
                        未登录
                      </span>{' '}
                      <span className="text-body-s text-on-surface-variant block truncate">
                        点击登录
                      </span>{' '}
                    </span>{' '}
                  </button>
                )}{' '}
              </div>{' '}
              <div className="bg-outline-variant mx-5 my-3 h-px" />{' '}
              <SidebarNav
                user={userInfo}
                backgroundPathname={backgroundPathname}
                unread={totalUnread}
                onNavigate={handleMobileNavigation}
                onLogout={handleLogoutClick}
              />{' '}
            </div>{' '}
          </aside>{' '}
          <section
            data-image-detail-host
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface sm:m-3 sm:rounded-md"
          >
            {' '}
            <div className="relative min-h-0 flex-1">
              {' '}
              <main
                data-image-detail-background
                data-image-hero-gallery-scroll
                data-scroll-hidden={isImageDetailOpen || undefined}
                className="app-scroller main-scrollbar absolute inset-0 w-full overflow-y-scroll bg-surface"
              >
                {' '}
                <div
                  data-image-detail-background-visual
                  className="flex min-h-full w-full flex-col"
                >
                  {' '}
                  <div
                    key={backgroundPathname}
                    data-page-content
                    className="animate-page-transition flex flex-1 flex-col p-4 sm:p-6"
                  >
                    {' '}
                    <div className="flex-1">{children}</div>{' '}
                    {/* Inside the page, not beside it.
                        As a sibling of `[data-page-content]` the mark was the
                        one thing a page transition could not move: on a short
                        page — /search is where you cannot miss it — it sat
                        perfectly still while the page it belongs to slid out
                        from under it, and the next page's mark was simply
                        already there. It used to be given a fade of its own to
                        cover that, which is why it appeared for an instant,
                        vanished, and floated back. Inside the page it is
                        cloned, slid and landed with everything else and needs
                        no choreography at all. `page-chrome` is left on for the
                        one move it still cannot join — a tab switch, where the
                        panes that slide are above it inside the same page. */}
                    <footer className="page-chrome mt-auto pt-10 text-label-l text-on-surface-variant sm:pt-12">
                      {' '}
                      <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-4 md:flex-row">
                        {' '}
                        <div className="flex w-full flex-col items-center gap-4 md:w-auto md:items-start">
                          {' '}
                          <Logo className="h-8 w-auto opacity-60" />{' '}
                          <div>
                            {' '}
                            <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>{' '}
                            <p>本站为 Derpibooru 第三方镜像站点</p>{' '}
                          </div>{' '}
                        </div>{' '}
                      </div>{' '}
                    </footer>{' '}
                  </div>{' '}
                </div>{' '}
                <div
                  data-image-hero-gallery-anchor
                  aria-hidden="true"
                  className="image-hero-gallery-anchor"
                />{' '}
              </main>{' '}
              <RouteCrossFade pathname={backgroundPathname} enabled={crossFadeEnabled} />
              <Suspense fallback={null}>
                {' '}
                <HeroStage />{' '}
              </Suspense>{' '}
              {overlay}{' '}
            </div>{' '}
            {backgroundPathname === '/' && (
              <Suspense fallback={null}>
                {/* `isImageDetailOpen` alone is not enough: the overlay is torn
                    down before the hero flies home, so keying off it would pop
                    the pill back in behind the still-moving image. The hero
                    runtime reports the flight itself, so the pill returns only
                    once the gallery is really back. */}
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
          <p className="text-on-surface-variant">确定要登出当前账号吗？</p>
        </Modal>
      </div>
    </BackgroundLocationProvider>
  );
}
