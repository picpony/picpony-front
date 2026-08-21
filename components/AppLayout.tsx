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
import Badge from '@/components/Badge';
import RouteCrossFade from '@/components/RouteCrossFade';
import Button from '@/components/Button';
import Tabs from '@/components/Tabs';
import IconButton, { iconButtonClasses } from '@/components/IconButton';
import {
  circularReveal,
  setTabIntent,
  startTabTransition,
  useDrawerSwipe,
} from '@/lib/motion';
import { readUserInfo, useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { MEDIA } from '@/lib/constants';

function SearchBar() {
  const router = useRouter();

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    router.push('/search');
  };

  return (
    <form onSubmit={handleSearch} className="flex shrink-0">
      {/* `type="submit"` is the whole reason this is an `IconButton` rather
          than a `Link`: the form is what owns the navigation.
          `md` + `touch-size`, matching the other four controls in the bar — and the
          Suspense fallback that reserves this box has to match it exactly. */}
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
 * Long enough to sit past the end of the slide, which is the point — and 520
 * rather than 480, because the slide is `DURATION.emphasized` (500ms) plus up to
 * `span * AXIS_LAG` of stagger on the lowest block, so 480 fired ~20–36ms *inside*
 * the frames this exists to protect. The push
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
const TAB_PUSH_COALESCE_MS = 520;

function TabNavBar({ hidden }: { hidden: boolean }) {
  const searchParams = useBackgroundSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get('tab') === 'forum' ? 'forum' : 'gallery';
  // Optimistic tab so the pill and label colors respond on click, before the
  // route (and its search params) actually commit.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? currentTab;

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
    /* `lean` on, and this is the one bar in the app that gets it. The wave is sampled
       over the blocks *inside* each pane, which needs those blocks to survive the run —
       true here because the forum pane is mounted ahead of the tap on an idle callback,
       so by the time you press it is already holding its rows rather than a skeleton it
       is about to replace. `/messages` is the counter-example and must stay without it:
       its panes fetch when their tab is selected. */
    startTabTransition(activeTab, tab, tab === 'forum' ? 1 : -1, true);

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

  return (
    /* Kept mounted while an image-detail overlay is open rather than unmounted:
       the sliding indicator measures its target on mount, so tearing it down
       and rebuilding it makes the pill jump back to x=0 on the way out. It fades
       instead, on the same 200ms the hero flight uses for card chrome, so the
       two leave together — and *only* the leave is on `accelerate`. One curve for
       both directions was fine for a symmetric bezier and is not for a one-sided
       one: `emphasized-accelerate` spends 82% of its travel in the last two tenths,
       which read backwards is a pill that hangs and then snaps. The return takes the
       arrival row.
       `data-image-detail-chrome` was previously set here and consumed nowhere —
       the pill just sat on the app-bar layer on top of the overlay.
       `z-page-chrome` keeps it under the drawer scrim: the host `<section>` is
       positioned but not a stacking context, so the pill's z competes directly
       with the shell's. On the app-bar layer it floated over the open drawer.
       See the stacking-order block in globals.css. */
    <div
      data-image-detail-chrome
      data-chrome-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-page-chrome flex items-center justify-center py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,translate] ${
        hidden
          ? 'translate-y-2 opacity-0 duration-200 ease-[var(--ease-accelerate)]'
          : 'translate-y-0 opacity-100 duration-400 ease-[var(--ease-decelerate)]'
      }`}
    >
      {/* `Tabs variant="pill"`, not a hand-rolled segmented control. This was one
          of four tab implementations and the only one with no ARIA roles at all —
          the app's primary navigation announced itself to a screen reader as two
          unlabelled buttons, and no arrow key did anything. The primitive owns the
          roles, the keyboard contract, the sliding indicator and the elevation;
          what stays here is the part that is genuinely this screen's — the
          optimistic tab, the coalesced push and the hide-while-flying wrapper. */}
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
     so the route cross-fade stands down entirely while one is in progress.
     That is what the first two conditions say, and they say all of it.

     The third used to be `!isImageDetailRoute`, which is much broader: it stood
     the cross-fade down for the whole time you were *on* an image detail, not
     just while one was flying. So leaving a picture for /search was the one
     navigation in the app with no transition at all — a hard cut, from the
     screen a user is most likely to leave sideways.

     `!isImageDetailOpen` is the narrow version, and the distinction is load
     bearing. `isImageDetailOpen` means the intercepted **overlay** is mounted,
     and in that case `backgroundPathname` is `/` and the snapshot source
     (`[data-page-content]`) is the *gallery underneath the overlay* — so a fade
     there would dissolve a page the user cannot even see. A direct visit to
     `/pic/123` has no overlay: the detail page *is* `[data-page-content]`, the
     existing machinery clones the right thing, and the fade is simply correct.

     The overlay case therefore stays a cut on purpose. Fixing it needs the clone
     to carry the overlay's own `scrollTop` — the overlay scrolls an inner
     element, so unlike a page inside the app scroller its offset is not encoded
     in `getBoundingClientRect`, and a clone starts at zero. */
  const crossFadeEnabled =
    imageHeroRuntime.phase === 'gallery-idle' &&
    !imageHeroRuntime.background &&
    !isImageDetailOpen;
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
    // The icon, not the button's box: every entry point into a theme change grows
    // the wipe out of the glyph itself. They share a centre while the button is a
    // bare square, but the button is free to gain padding or a label — and it now
    // carries `touch-size`, so on a touch device its box is larger than its paint.
    // The fallback below used to be the top edge of the viewport.
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
      const parsedUser = readUserInfo();
      if (parsedUser) {
        try {
          setUserInfo(parsedUser as unknown as UserInfo);

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
        {/* **64dp, `AppBarSmallTokens.ContainerHeight`, at every density.** It was
            briefly 56 under a pointer on the density argument, and that was the wrong
            object to apply it to: the bar is not repeated chrome you scroll past
            thirteen of, it is the one fixed band at the top of the screen, and the
            thing that made it feel oversized was the five 56dp controls in it rather
            than the band. Those are 40dp now (see below); the band stays the spec's.

            The horizontal inset is `px-4 sm:px-26` — 16px on a phone, 104px from `sm`
            up. The wide desktop inset is deliberate breathing room around the brand
            rather than a derivation: pulling it to the drawer's 28dp icon column was
            tried and read as the wordmark being shoved into the corner. If it ever
            needs a reason beyond "it looks right there", the one available is that the
            bar spans both the drawer and the content area and belongs to neither, so
            aligning it to either one's grid is a false precision.

            **`--touch-floor: 48px` locally, so the bar opts out of the pointer axis.**
            Everywhere else the floor drops to 24 under a mouse, because a hit area
            wider than the paint makes a control light up while the cursor is outside
            it. These five are the exception and it is not a hit-testing argument: they
            are the app's most-used controls, they sit alone on a 64dp coloured band,
            and at 40dp with 104px of air either side they read as five small glyphs
            rather than as the bar's chrome. 48 is M3's own touch target taken as a
            box — which is what they were before this pass — so nothing here is a new
            number, and `touch-size` reads the override without any call site changing.
            One declaration on the band rather than five on the controls. */}
        <header className="h-16 [--touch-floor:48px] bg-primary text-on-primary flex items-center px-4 sm:px-26 shrink-0 relative z-app-bar">
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
            {/* The header used to carry its own copy of the wordmark and its own
                copy of the hover — same idea as `Logo.tsx`, drifted to a
                different width and a keyline the other never had. One component
                now; `keyline` is the part that was genuinely header-specific. */}
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
              {/* The glyph shows the mode you are *in*, not the one you would
                switch to — which is what the tooltip beside it already says.
                It used to show the opposite (a sun while in dark mode), so the
                icon and its own tooltip disagreed. */}
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
          {/* The fallback reserves the control's own box, so the row does not shift
              when `SearchBar` hydrates. It has to move with the control — including
              through `touch-size`, or the bar would jump by 8px on mount on a touch
              device. It read `h-14 w-14` against a 56dp button; before that it read 44
              against 48, and the app bar jumped by 4px on mount. */}
          <Suspense fallback={<div className="h-10 w-10 touch-size" aria-hidden="true" />}>
            <SearchBar />
          </Suspense>
          {/* A `<Link>`, so it cannot be an `IconButton` — but it wears the
              same recipe from `iconButtonClasses` rather than a fifth copy of
              it. Same reason `buttonClasses` exists beside `Button`.
              The badge is a **sibling** of the anchor rather than a child of it, and
              that is not a preference: `data-ripple` sets `overflow: hidden` to clip
              the ripple, and a corner badge on a `rounded-full` box cannot survive a
              circular clip at any offset — the distance from the box's centre to the
              badge's centre plus the badge's own radius always exceeds the clip
              radius. It was inside, losing a slice of its outer arc whenever the
              count was non-zero. The anchor's `aria-label` already carries the
              count, so the badge is decorative and can sit outside. */}
          <span className="relative ml-1 flex shrink-0">
            <Link
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
            /* Hidden from assistive tech while closed, so the nav links inside
               are not reachable by Tab from behind the scrim. */
            aria-hidden={isCollapsed ? 'true' : undefined}
            inert={isCollapsed ? true : undefined}
            /* 288dp, and that is a **deliberate divergence** — M3's navigation
               drawer is 360dp. This one is *docked* from `md` up, so its width is
               taken out of the content area rather than laid over it, and on an
               image gallery those 72px are a column of thumbnails. 360 is right
               for a drawer you dismiss; for one that stays open beside the content
               it costs more than it gives. The number lives here only, and
               `-mr-72` below has to match it.

               **The panel slides; it is not clipped.** This animated `width`
               from 288 to 0 with the contents pinned at `w-72` inside
               `overflow-hidden`, and that is the defect two different easing
               curves were blamed for. Measured over the collapse: the nav's own
               left edge went `0 -> 0` — the labels, avatar and rows never moved
               at all — while the main content's left edge travelled the full
               `300 -> 12`. So two things moved on screen at once, one of them at
               the curve's rate and one of them at zero, and a guillotine swept in
               from the right across the frozen half. No timing function can fix
               that, which is why replacing the beziers with a spring did not.

               Now the whole aside translates and a negative margin closes the
               layout behind it. The content travels with the panel because it is
               *inside* the thing that moves, the panel's own box never resizes so
               its subtree never re-lays-out, and `translate` is composited. The
               parent is `overflow-hidden`, so the panel is clipped at the window
               edge rather than needing a width of its own to hide it.

               **A spring, and a different one per direction — because that is
               what M3 does.** `NavigationDrawer.kt` reads:

                 val openMotion  = MotionSchemeKeyTokens.DefaultSpatial.value()
                 val closeMotion = MotionSchemeKeyTokens.FastEffects.value()

               So opening is ζ0.9 k700 (194ms) and closing is ζ1.0 k3800 (108ms) —
               critically damped, which is the point: a panel leaving must not
               overshoot back into view. This is also the one place the file's own
               "effects springs are for fades" rule has to bend, and AOSP bends it
               the same way: `effects` means ζ=1, and ζ=1 is exactly what a
               *position* wants when overshoot would be wrong.

               Getting here took three wrong answers, all of them instructive:

               - `slow-spatial` (ζ0.9 k300, 296ms). Right family, wrong stiffness:
                 measured, the first quarter of the travel took 54ms, so behind the
                 press latency the panel looked stuck before it moved.
                 `default-spatial` reaches the same quarter at 35ms.
               - `standard` and `emphasized-decelerate`. Percentage of the 288px
                 covered in each tenth of the duration:

                   emphasized-decelerate  62 16  8  5  3  2  1  1  0  0
                   standard               16 34 19 11  8  5  3  2  1  0
                   ζ0.9 spring            10 19 20 17 13  9  6  4  2  1

                 Every M3 *curve* is one-sided, which is right for the two verbs it
                 models — the front-loaded half of an arrival happens while the
                 object is mostly off-screen. A docked panel is neither verb, so on
                 `standard` its fastest tenth carried 97x its last: "very fast then
                 very slow", which was the complaint verbatim. A spring is not
                 one-sided; it leaves and arrives at zero velocity by construction.
               - `--ease-symmetric`, a bezier invented for this. It measured well (7.6:1
                 peak-to-final) and it is still the right answer for a *loop*, which
                 has no arrival — but inventing a curve to stand in for spring
                 physics is what this codebase already did once with
                 `cubic-bezier(0.18, 1.36, 0.5, 1)`, and the springs exist so that it
                 does not have to happen again.

               Vuetify was the reference for the *arrangement* and still is: one
               gesture, one clock, the scrim sharing it
               (`$navigation-drawer-transition-duration: 0.2s`, timing function
               shared with the panel). What it cannot supply is the physics — its own
               curve is Material 2's `cubic-bezier(0.4, 0, 0.2, 1)`, which does ease
               in but still tails off at 43:1. The arrangement is borrowed; the
               numbers come from the token set.

               The springs are applied per branch rather than once on the element,
               because a transition is governed by the *after-change* style: the
               class the element is gaining is the one whose timing runs. */
            className={`bg-surface-container-low flex w-72 flex-col shrink-0 transition-[margin-right,translate] overflow-hidden absolute md:relative h-full z-app-bar md:z-auto rounded-r-lg md:rounded-none ${
              isCollapsed
                ? 'spring-fast-effects -translate-x-full md:-mr-72'
                : 'spring-default-spatial translate-x-0'
            }`}
          >
            {/* `w-full`, not a second `w-72`. The width used to be written here as
                well, because the aside was resizing under it and its contents had
                to be held still; the aside no longer resizes, so a second copy of
                the number is just two places to change it. */}
            <div className="main-scrollbar flex w-full flex-1 flex-col overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="p-3 pb-0">
                {userInfo ? (
                  <Link
                    href={`/user/${userInfo.id}`}
                    onClick={handleMobileNavigation}
                    data-ripple
                    /* A two-line list item, which is what this block is: an avatar, a
                       name, and a supporting line. So the geometry comes from
                       `ListTokens` rather than from the drawer's item — a 16dp corner
                       (`ItemSelectedContainerShape = CornerLarge`), 16dp leading
                       (`ItemLeadingSpace`), a 40dp avatar (`ItemLeadingAvatarSize`)
                       and 12dp between (`ItemBetweenSpace`).

                       It was a 56dp pill, borrowed from `SidebarNav`'s row on the
                       reasoning that the account block is a row in the nav. It is not:
                       a drawer item is a single line of `label-large` behind a
                       selection pill, and forcing two lines and an avatar into that
                       box is what made this block read *smaller* than the links under
                       it despite being the same height. A pill also says "selectable
                       destination" — the shape the rows below use to mean "you are
                       here" — where this is the drawer's header. The avatar still
                       starts on the same 28dp leading column as every nav icon
                       (12dp of nav inset + 16dp of item inset), which is the part that
                       has to agree.

                       **64dp, with `ListTokens`' own 40dp avatar.** 72 is
                       `ItemTwoLineContainerHeight` and it is the geometry of a *list
                       row* — a thing you scan a column of. This is the drawer's header:
                       one of them, above thirteen 48dp links. 64 is one step down with
                       the spec's avatar intact, which leaves 12px above and below the
                       text stack — exactly M3's own item padding. 56/32 was tried and
                       the avatar was simply too small: 32 is the *dense* step, for a
                       chat turn, and it made the one portrait in the shell the smallest
                       one in the app.
                       `/messages`' contact row keeps 72 with the same 40dp portrait:
                       that one *is* a list row, and the rail's collapsed width is
                       derived from its height. */
                    className="state-layer flex h-16 w-full items-center gap-3 rounded-lg px-4 outline-none focus-visible:ring-2 focus-ring"
                  >
                    <Avatar src={userInfo.avatar} name={userInfo.username} size={40} />
                    <div className="min-w-0 flex-1">
                      {/* `title-s` — 14px at weight 500, the same size as the
                          `label-l` on every link below it, so the drawer reads as one
                          column rather than as a 16px heading stacked on 14px rows.
                          This has been `title-s-emphasized` (14/700, too heavy),
                          `body-l` (16/400 with a 28px line box, the prose role on a
                          name) and `title-m` (16/500, which is what read as odd: the
                          only 16px in the drawer, one step above everything under it).
                          `ListTokens.ItemLabelTextFont` is `body-large`; this is a
                          stated divergence, and the reason is that the row it labels is
                          not in a list. */}
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
              {/* Always drawn, signed in or out. It was briefly conditional on
                  the grounds that a rule under a 未登录 prompt bounds nothing —
                  but the division it marks is structural, not conditional: above
                  it is who you are, below it is where you can go. Present in one
                  state and absent in the other, it also became a line that
                  appears the moment you log in, which is a change in the shell's
                  shape reported as a change in your account. */}
              {/* `shrink-0`, and that is the whole of the bug where this line
                  "disappeared after logging in". It is a flex item in a column, so it
                  carries `flex-shrink: 1` by default — and signed in the drawer gains
                  the 我的 group and the logout row, which pushes the column past the
                  viewport. The nav below is `flex-1` (basis 0) and so contributes
                  nothing to the shrink pool, which left this 1px item and the header
                  above it absorbing the entire overflow: 1px shrinks to 0 and the rule
                  vanishes while its margins stay, so the gap remains and the
                  line does not. Signed out the column fits and it was visible, which
                  is why it looked like a state change.
                  `mx-4` rather than `mx-5`, matching `SidebarNav`'s own rule and
                  `ListTokens.DividerLeadingSpace` (16dp) — there were three insets for
                  one kind of line.
                  `my-2` rather than `my-3`, matching the rule inside `SidebarNav`
                  (`:272`). Both separate two regions of the same column and they ran
                  at 25px and 17px of occupied height, i.e. one kind of line at two
                  rhythms — which is only visible if you happen to see both at once,
                  and they are 200px apart. */}
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
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface sm:m-3 sm:rounded-md"
          >
            
            <div className="relative min-h-0 flex-1">
              
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
                  
                  <div
                    key={backgroundPathname}
                    data-page-content
                    className="animate-page-transition flex flex-1 flex-col p-4 sm:p-6"
                  >
                    
                    {/* A flex column, and `[&>*]:w-full` is not optional with it.
                        The column is there so `StatusView`'s `fill` can be `flex-1`: a
                        percentage `min-height` resolves only against a *definite* parent
                        height, and this element's comes from flex distribution, which
                        Chrome treats as indefinite — so `min-h-full` on a child computed
                        to `auto` and the 404 stayed in the upper third.

                        The `w-full` is the part that cost a round trip. A block child of
                        a block fills the width and `max-w-* mx-auto` caps and centres
                        it. A flex item in a *column* is stretched on the cross axis by
                        `align-items: stretch` — **unless it has an auto margin there**,
                        because an auto cross-axis margin absorbs the free space and
                        disables the stretch. Every page root in this app is
                        `mx-auto max-w-*`, so all of them fell back to shrink-to-fit:
                        /messages measured 755px on one tab and 240px on the next, and
                        the forum list narrowed the same way. Setting the width
                        explicitly makes the cross size definite again, `max-width` caps
                        it and `mx-auto` centres the capped box — i.e. block behaviour,
                        restored.

                        Measured safe: every one of the app's fourteen routes puts
                        exactly one element in here, so there is no second flex item to
                        stack and no pair of adjacent margins to stop collapsing. */}
                    <div className="flex flex-1 flex-col [&>*]:w-full">{children}</div>
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
                        
                        <div className="flex w-full flex-col items-center gap-4 md:w-auto md:items-start">
                          
                          {/* `text-outline`, not a dimmed copy of the footer's
                              own ink. `Logo` paints through a mask from
                              `currentColor`, so it takes whatever text role it
                              is given — and `outline` is the documented role for
                              a *graphic* that should read quieter than the prose
                              beside it (4.3:1 clears the 3:1 non-text bar). An
                              opacity here was a number nothing else shared. */}
                          <Logo className="h-8 w-auto text-outline" />
                          <nav aria-label="站内导航" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            
                            <Link href="/about" className="transition-ui hover:text-on-surface hover:underline">
                              关于本站
                            </Link>
                            <span aria-hidden="true" className="text-outline">·</span>
                            <Link href="/policy" className="transition-ui hover:text-on-surface hover:underline">
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
              <RouteCrossFade pathname={backgroundPathname} enabled={crossFadeEnabled} />
              {/* Where `PageBack` lands.
                  The back affordance is chrome, not content. Rendered inside
                  `[data-page-content]` it was cloned by the route snapshot and
                  translated by the shared axis along with everything else — so
                  going /search -> /messages, which is an X-axis slide, carried
                  the button a whole window out and a whole window back to the
                  same pixel it started on. Four screens have one at the same
                  coordinate; it should simply stay there.
                  A portal keeps the page as the owner of the handler and the
                  label while the node lives out here, so no page had to change.
                  `z-page-chrome` is load-bearing in both directions: above the
                  cross-fade layer, because the clone no longer contains a button
                  and the live one has to be visible over it; below the
                  image-detail overlay and the Stage, because those bring their
                  own and a background page's must not float on top of them.
                  See the stacking-order block in globals.css. */}
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
          <p className="text-body-m text-on-surface-variant">确定要登出当前账号吗？</p>
        </Modal>
      </div>
    </BackgroundLocationProvider>
  );
}
