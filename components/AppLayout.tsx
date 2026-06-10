'use client';

import { useState, FormEvent, Suspense, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MdMenu, MdHome, MdSettings, MdSearch, MdPerson, MdExpandMore, MdLogout, MdNotifications, MdImageSearch, MdCollectionsBookmark, MdForum, MdDarkMode, MdLightMode, MdDashboard } from "react-icons/md";
import { ButtonBase, Badge } from "@mui/material";
import AnnouncementModal from "./AnnouncementModal";
import ImageSearchModal from "./ImageSearchModal";
import Modal from "./Modal";
import Logo from "./Logo";
import { api } from "@/lib/api";

function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      const formattedQuery = searchQuery.trim().replace(/，/g, ',');
      router.push(`/?search=${encodeURIComponent(formattedQuery)}`);
    } else {
      router.push('/');
    }
  };

  const isExpanded = isFocused || searchQuery.length > 0;

  return (
    <>
      <form 
        onSubmit={handleSearch} 
        className={`flex items-center rounded-md transition-all duration-300 focus-within:bg-white/20
          ${isExpanded ? 'bg-white/20 px-2 py-1.5 ml-2' : 'bg-transparent p-1.5 ml-0'} 
          sm:bg-white/10 sm:px-3 sm:py-1.5 sm:ml-4`}
      >
        <label 
          htmlFor="mobile-search" 
          className="cursor-pointer sm:cursor-text flex items-center justify-center shrink-0"
          onClick={() => {
            if (!isExpanded && window.innerWidth < 640) {
              setTimeout(() => inputRef.current?.focus(), 10);
            }
          }}
        >
          <MdSearch size={20} className={`text-white/70 transition-all ${isExpanded ? 'mr-2' : 'mr-0'} sm:mr-2`} />
        </label>
        <input
          id="mobile-search"
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="搜索..."
          className={`bg-transparent border-none outline-none text-white placeholder:text-white/50 text-sm transition-all duration-300
            ${isExpanded ? 'w-32 xs:w-40 opacity-100' : 'w-0 opacity-0'} 
            sm:w-48 sm:focus:w-64 sm:opacity-100`}
        />
        <button
          type="button"
          onClick={() => setIsImageSearchOpen(true)}
          className={`text-white/70 hover:text-white transition-all flex items-center justify-center overflow-hidden shrink-0
            ${isExpanded ? 'ml-2 w-5 opacity-100' : 'w-0 opacity-0'} 
            sm:w-5 sm:opacity-100 sm:ml-2`}
          title="以图搜图"
        >
          <MdImageSearch size={20} />
        </button>
      </form>
      <ImageSearchModal 
        isOpen={isImageSearchOpen} 
        onClose={() => setIsImageSearchOpen(false)} 
        onSearchSuccess={(results) => {
          if (window.location.pathname !== '/') {
            sessionStorage.setItem('pending_image_search_results', JSON.stringify(results));
            router.push('/');
          } else {
            const event = new CustomEvent('image_search_results', { detail: results });
            window.dispatchEvent(event);
          }
        }}
      />
    </>
  );
}

interface UserInfo {
  id?: number;
  username: string;
  avatar: string;
  role: string;
  token: string;
  level?: number;
}

const sidebarButtonSx = (isActive: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  px: 1.5,
  py: 1.5,
  fontWeight: 500,
  transition: 'all 0.2s',
  borderRadius: '8px',
  width: '100%',
  justifyContent: 'flex-start',
  color: isActive ? 'var(--color-primary)' : 'var(--sidebar-text, rgb(51, 65, 85))',
  backgroundColor: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
  '&:hover': {
    backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'var(--sidebar-hover, rgb(241, 245, 249))',
  }
});

export default function AppLayout({ 
  children, 
  initialCollapsed,
  initialDark
}: { 
  children: React.ReactNode;
  initialCollapsed: boolean;
  initialDark: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [darkMode, setDarkMode] = useState(initialDark);
  const [followSystem, setFollowSystem] = useState(true);
  const [isDarkDropdownOpen, setIsDarkDropdownOpen] = useState(false);
  const dropdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const systemPrefersDark = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  const applyDarkMode = useCallback((dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    document.cookie = `darkMode=${dark};path=/;max-age=${365 * 24 * 60 * 60}`;
  }, []);

  useEffect(() => {
    const storedDark = localStorage.getItem('darkMode');
    const storedFollowSystem = localStorage.getItem('followSystemPrefersColorScheme');
    
    let resolveFollowSystem = true;
    if (storedFollowSystem !== null) {
      resolveFollowSystem = storedFollowSystem === 'true';
    }
    setFollowSystem(resolveFollowSystem);

    if (resolveFollowSystem) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const isDark = mediaQuery.matches;
      setDarkMode(isDark);
      applyDarkMode(isDark);
    } else if (storedDark !== null) {
      const isDark = storedDark === 'true';
      setDarkMode(isDark);
      applyDarkMode(isDark);
    }
  }, [applyDarkMode]);

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

  useEffect(() => {
    const savedMenuState = localStorage.getItem('user_menu_open');
    if (savedMenuState !== null) {
      requestAnimationFrame(() => {
        setIsUserMenuOpen(savedMenuState === 'true');
      });
    }
    
    if (window.innerWidth >= 768) {
      const savedSidebarState = localStorage.getItem('sidebar_collapsed');
      if (savedSidebarState !== null) {
        requestAnimationFrame(() => {
          setIsCollapsed(savedSidebarState === 'true');
        });
      }
    }
  }, []);

  const toggleUserMenu = () => {
    const newState = !isUserMenuOpen;
    setIsUserMenuOpen(newState);
    localStorage.setItem('user_menu_open', String(newState));
  };
  const router = useRouter();

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
  }, [pathname]);

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
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebar_collapsed', String(newState));
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
    setUserInfo(null);
    setIsUserMenuOpen(false);
    setIsLogoutDialogOpen(false);
    router.push('/');
  };

  const handleLogoutCancel = () => {
    setIsLogoutDialogOpen(false);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-16 bg-primary dark:bg-slate-900 text-white flex items-center px-4 sm:px-26 shrink-0 relative z-50">
        <ButtonBase 
          onClick={toggleSidebar}
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          sx={{ 
            borderRadius: '6px',
            p: '8px',
            mr: { xs: '8px', sm: '16px' },
            color: '#ffffff',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            }
          }}
        >
          <MdMenu size={24} />
        </ButtonBase>
        <Link href="/" className="flex items-center shrink-0 hover:opacity-80 transition-opacity hidden sm:flex">
          <img src="/img/picpony-w.svg" alt="PicPony" className="h-auto w-25" />
        </Link>
        <div className="flex-1 flex justify-start sm:ml-4 pl-1 sm:pl-0">
          <Suspense fallback={<div className="w-full max-w-[200px] h-8 bg-white/10 rounded-md animate-pulse"></div>}>
            <SearchBar />
          </Suspense>
        </div>
        <div 
          className="relative"
          ref={dropdownRef}
          onMouseEnter={handleDropdownMouseEnter}
          onMouseLeave={handleDropdownMouseLeave}
        >
          <ButtonBase 
            onClick={toggleDarkMode}
            aria-label={darkMode ? '切换浅色模式' : '切换深色模式'}
            title={darkMode ? '浅色模式' : '深色模式'}
            sx={{ 
              borderRadius: '6px',
              p: '8px',
              ml: '2px',
              color: '#ffffff',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              }
            }}
          >
            {darkMode ? <MdLightMode size={24} /> : <MdDarkMode size={24} />}
          </ButtonBase>
          {isDarkDropdownOpen && (
            <div 
              className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-2 z-[60] animate-fade-in"
              onMouseEnter={handleDropdownMouseEnter}
              onMouseLeave={handleDropdownMouseLeave}
            >
              <label className="flex items-center px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                  <input
                    type="checkbox"
                    checked={followSystem}
                    onChange={(e) => handleFollowSystemChange(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 transition-all duration-200" />
                  <svg
                    className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 pointer-events-none"
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="ml-2.5 text-sm text-slate-700 dark:text-slate-300 select-none">跟随系统</span>
              </label>
            </div>
          )}
        </div>
        <ButtonBase 
          component={Link}
          href="/messages"
          aria-label="消息"
          sx={{ 
            borderRadius: '6px',
            p: '8px',
            ml: '2px',
            color: '#ffffff',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            }
          }}
        >
          <Badge color="error" badgeContent={totalUnread} sx={{ '& .MuiBadge-badge': { right: -3, top: 3 } }}>
            <MdNotifications size={24} />
          </Badge>
        </ButtonBase>
      </header>
      
      <div className="flex flex-1 overflow-hidden relative">
        <div 
          className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ease-in-out ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          onClick={() => setIsCollapsed(true)}
        />
        
        <aside 
          className={`bg-slate-50 dark:bg-slate-900 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden absolute md:relative h-full z-50 md:z-auto ${
            isCollapsed ? '-translate-x-full md:translate-x-0 md:w-0' : 'translate-x-0 w-64'
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
                        <div className="w-full h-full">
                          <img 
                            src={`https://picpony.top/${userInfo.avatar}`} 
                            alt={userInfo.username}
                            className="w-full h-full object-cover"
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
                      <p className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium inline-block mt-0.5">
                        Lv.{userInfo.level ?? '?'}
                      </p>
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
                  className={`mt-1 flex flex-col space-y-1 overflow-hidden transition-all duration-300 ease-in-out ${
                    isUserMenuOpen 
                      ? 'max-h-60 opacity-100 mb-2' 
                      : 'max-h-0 opacity-0'
                  }`}
                >
                  <ButtonBase
                    component={Link}
                    href="/favorites" 
                    onClick={handleMobileNavigation}
                    sx={sidebarButtonSx(pathname === '/favorites')}
                  >
                    <MdCollectionsBookmark size={20} className="shrink-0 mr-3" />
                    <span>我的收藏</span>
                  </ButtonBase>
                  <ButtonBase
                    component={Link}
                    href="/settings"
                    onClick={handleMobileNavigation}
                    sx={sidebarButtonSx(pathname === '/settings')}
                  >
                    <MdSettings size={20} className="shrink-0 mr-3" />
                    <span>设置</span>
                  </ButtonBase>
                  {userInfo && (userInfo.role === 'editor' || userInfo.role === 'admin' || userInfo.role === 'super_admin') && (
                    <ButtonBase
                      component={Link}
                      href="/admin" 
                      onClick={handleMobileNavigation}
                      sx={sidebarButtonSx(pathname.startsWith('/admin'))}
                    >
                      <MdDashboard size={20} className="shrink-0 mr-3" />
                      <span>管理面板</span>
                    </ButtonBase>
                  )}
                  <ButtonBase 
                    onClick={handleLogoutClick}
                    sx={sidebarButtonSx(false)}
                  >
                    <MdLogout size={20} className="shrink-0 mr-3" />
                    <span>登出</span>
                  </ButtonBase>
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
            <ButtonBase
              component={Link}
              href="/" 
              onClick={handleMobileNavigation}
              sx={sidebarButtonSx(pathname === '/')}
            >
              <MdHome size={20} className="shrink-0 mr-3" />
              <span>主页</span>
            </ButtonBase>
            <ButtonBase
              component={Link}
              href="/forum" 
              onClick={handleMobileNavigation}
              sx={sidebarButtonSx(pathname.startsWith('/forum'))}
            >
              <MdForum size={20} className="shrink-0 mr-3" />
              <span>论坛</span>
            </ButtonBase>
          </nav>
        </aside>
        
        <main className="flex-1 overflow-y-scroll bg-white dark:bg-slate-950 relative flex flex-col w-full">
          <div key={pathname} className="animate-page-transition p-4 sm:p-6 flex-1">
            {children}
          </div>
          <footer className="py-6 sm:py-8 px-4 sm:px-6 text-slate-500 dark:text-slate-400 text-sm">
            <div className="max-w-screen-xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex flex-col items-center md:items-start gap-4 w-full md:w-auto">
              <Logo className="h-8 w-auto opacity-60" />
                <div>
                  <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                  <p>本站为 Derpibooru 第三方镜像站点</p>
                </div>
              </div>
            </div>
          </footer>
        </main>
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
  );
}