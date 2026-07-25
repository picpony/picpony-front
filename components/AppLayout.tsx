'use client';

import { useState, FormEvent, Suspense, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { MdMenu, MdHome, MdSettings, MdSearch, MdPerson, MdExpandMore, MdLogout, MdNotifications, MdCollectionsBookmark, MdDarkMode, MdLightMode, MdDashboard, MdHistory, MdPhotoLibrary, MdForum, MdCloudUpload, MdShield, MdEmojiEvents } from "react-icons/md";

import dynamic from 'next/dynamic';
const AnnouncementModal = dynamic(() => import("./AnnouncementModal"), { ssr: false });
const Modal = dynamic(() => import("./Modal"), { ssr: false });
import Logo from "./Logo";
import FadeInImage from "./FadeInImage";
import Checkbox from "./Checkbox";
import {
  BackgroundLocationProvider,
  useBackgroundSearchParams,
} from "./BackgroundLocation";
import { api } from "@/lib/api";
import {
  getImageHeroRuntime,
  getImageHeroBackgroundLocation,
  initializeImageHeroHistory,
  subscribeImageHeroRuntime,
} from "@/lib/hero";
import HeroStage from '@/components/HeroStage';

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
        className="rounded-md p-2 text-white hover:bg-white/10 transition-colors cursor-pointer"
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

const sidebarButtonClass = (isActive: boolean) =>
  `flex items-center px-3 py-2 font-medium transition-all duration-200 rounded-lg w-full justify-start ${isActive
    ? 'text-primary bg-primary/10 hover:bg-primary/15'
    : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)]'
  }`;

function TabNavBar() {
  const searchParams = useBackgroundSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get('tab') || 'gallery';
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  const switchTab = (tab: string) => {
    if (tab === (currentTab === 'forum' ? 'forum' : 'gallery')) return;
    setPendingTab(tab);
    setTimeout(() => {
      setPendingTab(null);
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'gallery') params.delete('tab');
      else params.set('tab', tab);
      const qs = params.toString();
      router.push(qs ? `/?${qs}` : '/');
    }, 200);
  };

  return (
    <div
      data-image-detail-chrome
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex items-center justify-center py-3"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-slate-100 p-1 shadow-lg shadow-black/10 dark:bg-slate-800 dark:shadow-black/30">
        <button
          onClick={() => switchTab('gallery')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${currentTab !== 'forum'
              ? 'bg-white dark:bg-slate-700 text-primary'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
        >
          <MdPhotoLibrary size={18} />
          <span>图库</span>
        </button>
        <button
          onClick={() => switchTab('forum')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${currentTab === 'forum'
              ? 'bg-white dark:bg-slate-700 text-primary'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
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
  initialDark
}: {
  children: React.ReactNode;
  overlay: React.ReactNode;
  initialCollapsed: boolean;
  initialDark: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return initialCollapsed;
    if (window.innerWidth < 768) return true;
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved !== null ? saved === 'true' : initialCollapsed;
  });
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('user_menu_open');
    if (saved !== null) return saved === 'true';
    return !!localStorage.getItem('user_info');
  });
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return initialDark;
    const storedFollowSystem = localStorage.getItem('followSystemPrefersColorScheme');
    if (storedFollowSystem === null || storedFollowSystem === 'true') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    const storedDark = localStorage.getItem('darkMode');
    return storedDark === 'true';
  });

  const [followSystem, setFollowSystem] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('followSystemPrefersColorScheme');
    return stored === null ? true : stored === 'true';
  });
  const [isDarkDropdownOpen, setIsDarkDropdownOpen] = useState(false);
  const dropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const liveSearchParams = useSearchParams();
  const liveSearch = liveSearchParams.toString();
  const imageDetailSegment = useSelectedLayoutSegment('imageDetail');
  const imageDetailId = pathname.match(/^\/pic\/([^/]+)$/)?.[1];
  const isImageDetailOpen = Boolean(
    imageDetailId && imageDetailSegment === imageDetailId
  );
  const imageHeroRuntime = useSyncExternalStore(
    subscribeImageHeroRuntime,
    getImageHeroRuntime,
    getImageHeroRuntime,
  );
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
    activeHeroBackground &&
    browserAtBackground &&
    !reactRouteAtBackground,
  );
  const imageHeroBackground = imageHeroRuntime.background ?? (
    bridgeRouteCommit ? retainedHeroBackground : null
  );
  const backgroundPathname = imageHeroBackground?.pathname ?? (
    isImageDetailOpen ? '/' : pathname
  );
  const frozenBackgroundSearch = imageHeroBackground?.search ?? (
    isImageDetailOpen ? '' : null
  );

  useEffect(() => {
    initializeImageHeroHistory({
      push: (href) => router.push(href, { scroll: false }),
      replace: (href) => router.replace(href, { scroll: false }),
    });
  }, [router]);

  const systemPrefersDark = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

  const applyDarkMode = useCallback((dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    document.cookie = `darkMode=${dark};path=/;max-age=${365 * 24 * 60 * 60}`;
  }, []);

  useEffect(() => {
    if (!followSystem) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setDarkMode(e.matches);
      applyDarkMode(e.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [followSystem, applyDarkMode]);

  const toggleDarkMode = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    applyDarkMode(newDark);
    localStorage.setItem('darkMode', String(newDark));
    if (followSystem) {
      setFollowSystem(false);
      localStorage.setItem('followSystemPrefersColorScheme', 'false');
    }
  };

  const handleFollowSystemChange = (checked: boolean) => {
    setFollowSystem(checked);
    localStorage.setItem('followSystemPrefersColorScheme', String(checked));
    if (checked) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = mediaQuery.matches;
      setDarkMode(isDark);
      applyDarkMode(isDark);
    }
  };

  const handleDropdownMouseEnter = () => {
    if (dropdownTimeoutRef.current) {
      clearTimeout(dropdownTimeoutRef.current);
      dropdownTimeoutRef.current = null;
    }
    setIsDarkDropdownOpen(true);
  };

  const handleDropdownMouseLeave = () => {
    dropdownTimeoutRef.current = setTimeout(() => {
      setIsDarkDropdownOpen(false);
    }, 150);
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

  const prevUserRef = useRef(userInfo);
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = userInfo;
    if (!prev && userInfo) {
      setIsUserMenuOpen(true);
    }
  }, [userInfo]);

  const toggleUserMenu = () => {
    setIsUserMenuOpen(prev => {
      const newState = !prev;
      localStorage.setItem('user_menu_open', String(newState));
      return newState;
    });
  };
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

              const data = await res.json();
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
              console.error("Failed to fetch latest user info", err);
            }
          }
        } catch (e) {
          console.error("Failed to parse user info", e);
        }
      } else {
        setUserInfo(null);
      }
    };

    updateUserInfo();

    window.addEventListener('user_info_updated', updateUserInfo);
    return () => window.removeEventListener('user_info_updated', updateUserInfo);
  }, [backgroundPathname]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => {
    setIsCollapsed(prev => {
      const newState = !prev;
      localStorage.setItem('sidebar_collapsed', String(newState));
      return newState;
    });
  };

  const handleMobileNavigation = () => {
    if (window.innerWidth < 768) {
      setIsCollapsed(true);
    }
  };

  const handleLogoutClick = () => {
    setIsLogoutDialogOpen(true);
  };

  const handleLogoutConfirm = () => {
    localStorage.removeItem('user_info');
    localStorage.removeItem('user_menu_open');
    setUserInfo(null);
    setIsUserMenuOpen(false);
    setIsLogoutDialogOpen(false);
    router.push('/');
  };

  const handleLogoutCancel = () => {
    setIsLogoutDialogOpen(false);
  };

  return (
    <BackgroundLocationProvider frozenSearch={frozenBackgroundSearch}>
    <div className="h-full flex flex-col overflow-hidden">
      <div className="bg-amber-400 text-amber-900 text-center text-xs sm:text-sm py-1 px-4 font-medium shrink-0">
        网站处于开发阶段，不代表最终品质
      </div>
      <header className="h-16 bg-primary dark:bg-slate-900 text-white flex items-center px-4 sm:px-26 shrink-0 relative z-50">
        <button
          onClick={toggleSidebar}
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          className="rounded-md p-2 mr-2 sm:mr-4 text-white hover:bg-white/10 transition-colors"
        >
          <MdMenu size={24} />
        </button>
        <Link href="/" className="flex items-center shrink-0 hover:opacity-80 transition-opacity hidden sm:flex mr-2">
          <img src="/img/picpony-w.svg" alt="PicPony" className="h-auto w-25" />
        </Link>
        <div
          className="relative"
          ref={dropdownRef}
          onMouseEnter={handleDropdownMouseEnter}
          onMouseLeave={handleDropdownMouseLeave}
        >
          <button
            onClick={toggleDarkMode}
            aria-label={darkMode ? '切换浅色模式' : '切换深色模式'}
            title={darkMode ? '浅色模式' : '深色模式'}
            className="rounded-md p-2 ml-2 mr-0.5 text-white hover:bg-white/10 transition-colors"
          >
            {darkMode ? <MdLightMode size={24} /> : <MdDarkMode size={24} />}
          </button>
          {isDarkDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-2 z-[60] animate-fade-in"
              onMouseEnter={handleDropdownMouseEnter}
              onMouseLeave={handleDropdownMouseLeave}
            >
              <div className="flex items-center px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <Checkbox checked={followSystem} onChange={handleFollowSystemChange} />
                <span className="ml-2.5 text-sm text-slate-700 dark:text-slate-300 select-none">跟随系统</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <Suspense fallback={<div className="w-8 h-8 bg-white/10 rounded-md animate-pulse"></div>}>
          <SearchBar />
        </Suspense>
        <Link
          href="/messages"
          aria-label="消息"
          className="relative rounded-md p-2 ml-3 text-white hover:bg-white/10 transition-colors inline-flex"
        >
          <MdNotifications size={24} />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden relative bg-slate-50 dark:bg-slate-900">
        <div
          className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ease-in-out ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          onClick={() => setIsCollapsed(true)}
        />

        <aside
          className={`bg-slate-50 dark:bg-slate-900 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden absolute md:relative h-full z-50 md:z-auto ${isCollapsed ? '-translate-x-full md:translate-x-0 md:w-0' : 'translate-x-0 w-64'
            }`}
        >
          <div className="w-64 p-3 pb-0">
            {userInfo ? (
              <div className="relative">
                <div className="w-full flex items-center p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative z-20">
                  <Link
                    href={`/user/${userInfo.id}`}
                    onClick={handleMobileNavigation}
                    className="flex items-center flex-1 overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 shrink-0">
                      {userInfo.avatar ? (
                        <div className="relative w-full h-full">
                          <div className="absolute inset-0 flex items-center justify-center text-slate-500 dark:text-slate-400">
                            <MdPerson size={24} />
                          </div>
                          <FadeInImage
                            src={userInfo.avatar.startsWith('http') ? userInfo.avatar : `https://picpony.top/${userInfo.avatar}`}
                            alt={userInfo.username}
                            fill
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500 dark:text-slate-400">
                          <MdPerson size={24} />
                        </div>
                      )}
                    </div>
                    <div className="ml-3 overflow-hidden flex-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{userInfo.username}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium inline-block">
                          Lv.{userInfo.level ?? '?'}
                        </p>
                        {userInfo.derpi_username && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 truncate max-w-[100px]" title={userInfo.derpi_username}>
                            ✓ {userInfo.derpi_username}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                  <button onClick={toggleUserMenu} className="text-slate-400 dark:text-slate-500 shrink-0 ml-2 p-1 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <MdExpandMore
                      size={20}
                      className={`transition-transform duration-300 ${isUserMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                <div
                  className={`mt-1 flex flex-col space-y-1 transition-all duration-300 ease-in-out overflow-hidden ${isUserMenuOpen
                      ? 'max-h-[1000px] opacity-100 mb-2'
                      : 'max-h-0 opacity-0'
                    }`}
                >
                  <Link
                    href="/favorites"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/favorites')}
                  >
                    <MdCollectionsBookmark size={20} className="shrink-0 mr-3" />
                    <span>我的收藏</span>
                  </Link>
                  <Link
                    href="/messages"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/messages')}
                  >
                    <MdNotifications size={20} className="shrink-0 mr-3" />
                    <span>消息</span>
                    {totalUnread > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </Link>
                  <Link
                    href="/history"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/history')}
                  >
                    <MdHistory size={20} className="shrink-0 mr-3" />
                    <span>浏览历史</span>
                  </Link>
                  <Link
                    href="/upload"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/upload')}
                  >
                    <MdCloudUpload size={20} className="shrink-0 mr-3" />
                    <span>发布图片</span>
                  </Link>
                  <Link
                    href="/block-groups"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/block-groups')}
                  >
                    <MdShield size={20} className="shrink-0 mr-3" />
                    <span>屏蔽组</span>
                  </Link>
                  <Link
                    href="/tasks"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/tasks')}
                  >
                    <MdEmojiEvents size={20} className="shrink-0 mr-3" />
                    <span>任务</span>
                  </Link>
                  <Link
                    href="/settings"
                    onClick={handleMobileNavigation}
                    className={sidebarButtonClass(backgroundPathname === '/settings')}
                  >
                    <MdSettings size={20} className="shrink-0 mr-3" />
                    <span>设置</span>
                  </Link>
                  {userInfo && (userInfo.role === 'editor' || userInfo.role === 'admin' || userInfo.role === 'super_admin') && (
                    <Link
                      href="/admin"
                      onClick={handleMobileNavigation}
                      className={sidebarButtonClass(backgroundPathname.startsWith('/admin'))}
                    >
                      <MdDashboard size={20} className="shrink-0 mr-3" />
                      <span>管理面板</span>
                    </Link>
                  )}
                  <button
                    onClick={handleLogoutClick}
                    className={sidebarButtonClass(false)}
                  >
                    <MdLogout size={20} className="shrink-0 mr-3" />
                    <span>登出</span>
                  </button>
                </div>
                <div className="h-px bg-slate-200 dark:bg-slate-700 mt-2 mx-2"></div>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={handleMobileNavigation}
                className="flex items-center p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
              >
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                  <MdPerson size={24} />
                </div>
                <div className="ml-3 overflow-hidden">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors truncate">未登录</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">点击登录</p>
                </div>
              </Link>
            )}
            {!userInfo && <div className="h-px bg-slate-200 dark:bg-slate-700 mt-2 mx-2"></div>}
          </div>
          <nav className="flex-1 py-3 w-64 px-3 space-y-1">
            <Link
              href="/"
              onClick={handleMobileNavigation}
              className={sidebarButtonClass(backgroundPathname === '/')}
            >
              <MdHome size={20} className="shrink-0 mr-3" />
              <span>主页</span>
            </Link>
          </nav>
        </aside>

        <section
          data-image-detail-host
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950 sm:m-3 sm:rounded-xl"
        >
          <div className="relative min-h-0 flex-1">
            <main
              data-image-detail-background
              data-image-hero-gallery-scroll
              className="main-scrollbar absolute inset-0 w-full overflow-y-scroll bg-white dark:bg-slate-950"
            >
              <div
                data-image-detail-background-visual
                className="flex min-h-full w-full flex-col"
              >
                <div
                  key={backgroundPathname}
                  className="animate-page-transition flex-1 p-4 sm:p-6"
                >
                  {children}
                </div>
                <footer className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 sm:px-6 sm:py-8">
                  <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-4 md:flex-row">
                    <div className="flex w-full flex-col items-center gap-4 md:w-auto md:items-start">
                      <Logo className="h-8 w-auto opacity-60" />
                      <div>
                        <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                        <p>本站为 Derpibooru 第三方镜像站点</p>
                      </div>
                    </div>
                  </div>
                </footer>
              </div>
              <div
                data-image-hero-gallery-anchor
                aria-hidden="true"
                className="image-hero-gallery-anchor"
              />
            </main>
            <Suspense fallback={null}>
              <HeroStage />
            </Suspense>
            {overlay}
          </div>
          {backgroundPathname === '/' && (
            <Suspense fallback={null}>
              <TabNavBar />
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
            <button
              type="button"
              onClick={handleLogoutCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleLogoutConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认登出
            </button>
          </>
        }
      >
        <p className="text-slate-600 dark:text-slate-300">
          确定要登出当前账号吗？
        </p>
      </Modal>
    </div>
    </BackgroundLocationProvider>
  );
}
