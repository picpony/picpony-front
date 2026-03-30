'use client';

import { useState, FormEvent, Suspense, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MdMenu, MdHome, MdSettings, MdSearch, MdPerson, MdExpandMore, MdExpandLess, MdLogout, MdNotifications, MdClose } from "react-icons/md";
import { ButtonBase } from "@mui/material";
import AnnouncementModal from "./AnnouncementModal";

function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      const formattedQuery = searchQuery.trim().replace(/，/g, ',');
      router.push(`/?search=${encodeURIComponent(formattedQuery)}`);
    } else {
      router.push('/');
    }
  };

  return (
    <form onSubmit={handleSearch} className="flex items-center bg-white/10 rounded-md px-3 py-1.5 ml-4 focus-within:bg-white/20 transition-colors">
      <MdSearch size={20} className="text-white/70 mr-2" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索..."
        className="bg-transparent border-none outline-none text-white placeholder:text-white/50 text-sm w-48 focus:w-64 transition-all duration-300"
      />
    </form>
  );
}

interface UserInfo {
  username: string;
  avatar: string;
  role: string;
  token: string;
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
  color: isActive ? 'var(--color-primary)' : 'rgb(51, 65, 85)',
  backgroundColor: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
  '&:hover': {
    backgroundColor: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgb(241, 245, 249)',
  }
});

export default function AppLayout({ 
  children, 
  initialCollapsed 
}: { 
  children: React.ReactNode;
  initialCollapsed: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [isLogoutClosing, setIsLogoutClosing] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const savedMenuState = localStorage.getItem('user_menu_open');
    if (savedMenuState !== null) {
      setIsUserMenuOpen(savedMenuState === 'true');
    }
    
    if (window.innerWidth >= 768) {
      const savedSidebarState = localStorage.getItem('sidebar_collapsed');
      if (savedSidebarState !== null) {
        setIsCollapsed(savedSidebarState === 'true');
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
    const updateUserInfo = () => {
      const storedUser = localStorage.getItem('user_info');
      if (storedUser) {
        try {
          setUserInfo(JSON.parse(storedUser));
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
    setIsLogoutClosing(true);
    setTimeout(() => {
      localStorage.removeItem('user_info');
      setUserInfo(null);
      setIsUserMenuOpen(false);
      setIsLogoutDialogOpen(false);
      setIsLogoutClosing(false);
      router.push('/');
    }, 200);
  };

  const handleLogoutCancel = () => {
    setIsLogoutClosing(true);
    setTimeout(() => {
      setIsLogoutDialogOpen(false);
      setIsLogoutClosing(false);
    }, 200);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-16 bg-primary text-white flex items-center px-4 shrink-0 relative z-50">
        <button 
          onClick={toggleSidebar}
          className="p-2 mr-2 sm:mr-4 rounded-md hover:bg-white/20 text-white transition-colors"
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <MdMenu size={24} />
        </button>
        <Link href="/" className="flex items-center shrink-0 hover:opacity-80 transition-opacity hidden sm:flex">
          <img src="/img/picpony-w.svg" alt="PicPony" className="h-auto w-25" />
        </Link>
        <div className="flex-1 flex justify-end sm:justify-start sm:ml-4">
          <Suspense fallback={<div className="w-full max-w-[200px] h-8 bg-white/10 rounded-md animate-pulse"></div>}>
            <SearchBar />
          </Suspense>
        </div>
        <Link 
          href="/messages" 
          className="p-2 ml-2 rounded-md hover:bg-white/20 text-white transition-colors relative"
          aria-label="消息"
        >
          <MdNotifications size={24} />
        </Link>
      </header>
      
      <div className="flex flex-1 overflow-hidden relative">
        <div 
          className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300 ease-in-out ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          onClick={() => setIsCollapsed(true)}
        />
        
        <aside 
          className={`bg-slate-50 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden absolute md:relative h-full z-50 md:z-auto ${
            isCollapsed ? '-translate-x-full md:translate-x-0 md:w-0' : 'translate-x-0 w-64'
          }`}
        >
          <div className="w-64 p-3 pb-0">
            {userInfo ? (
              <div className="relative">
                <button 
                  onClick={toggleUserMenu}
                  className="w-full flex items-center p-2 rounded-lg hover:bg-slate-100 transition-colors text-left relative z-20"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 shrink-0">
                    {userInfo.avatar ? (
                      <img 
                        src={`https://picpony.top/${userInfo.avatar}`} 
                        alt={userInfo.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-500">
                        <MdPerson size={24} />
                      </div>
                    )}
                  </div>
                  <div className="ml-3 overflow-hidden flex-1">
                    <p className="text-sm font-bold text-slate-800 truncate">{userInfo.username}</p>
                    <p className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium inline-block uppercase tracking-wider mt-0.5">
                      {userInfo.role}
                    </p>
                  </div>
                  <div className="text-slate-400 shrink-0 ml-2">
                    <MdExpandMore 
                      size={20} 
                      className={`transition-transform duration-300 ${isUserMenuOpen ? 'rotate-180' : ''}`} 
                    />
                  </div>
                </button>
                
                <div 
                  className={`mt-1 flex flex-col space-y-1 overflow-hidden transition-all duration-300 ease-in-out ${
                    isUserMenuOpen 
                      ? 'max-h-40 opacity-100 mb-2' 
                      : 'max-h-0 opacity-0'
                  }`}
                >
                  <ButtonBase
                    component={Link}
                    href="/settings"
                    onClick={handleMobileNavigation}
                    sx={sidebarButtonSx(pathname === '/settings')}
                  >
                    <MdSettings size={20} className="shrink-0 mr-3" />
                    <span>设置</span>
                  </ButtonBase>
                  <ButtonBase 
                    onClick={handleLogoutClick}
                    sx={sidebarButtonSx(false)}
                  >
                    <MdLogout size={20} className="shrink-0 mr-3" />
                    <span>退出登录</span>
                  </ButtonBase>
                </div>
                <div className="h-px bg-slate-200 mt-2 mx-2"></div>
              </div>
            ) : (
              <Link 
                href="/login"
                onClick={handleMobileNavigation}
                className="flex items-center p-2 rounded-lg hover:bg-slate-100 transition-colors group"
              >
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                  <MdPerson size={24} />
                </div>
                <div className="ml-3 overflow-hidden">
                  <p className="text-sm font-medium text-slate-700 group-hover:text-primary transition-colors truncate">未登录</p>
                  <p className="text-xs text-slate-500 truncate">点击登录</p>
                </div>
              </Link>
            )}
            {!userInfo && <div className="h-px bg-slate-200 mt-2 mx-2"></div>}
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
          </nav>
        </aside>
        
        <main className="flex-1 overflow-y-auto bg-white relative flex flex-col w-full">
          <div key={pathname} className="animate-page-transition p-4 sm:p-6 flex-1">
            {children}
          </div>
          <footer className="py-6 sm:py-8 px-4 sm:px-6 border-t border-slate-100 text-slate-500 text-sm">
            <div className="max-w-screen-xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                <p>本站为 Derpibooru 第三方镜像站点</p>
              </div>
            </div>
          </footer>
        </main>
      </div>
      <AnnouncementModal />
      
      {isLogoutDialogOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isLogoutClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={handleLogoutCancel}
        >
          <div 
            className={`bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isLogoutClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800">确认退出登录？</h3>
              <button 
                onClick={handleLogoutCancel}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <div className="px-6 pb-6">
              <p className="text-slate-600 mb-6">
                退出登录后，您将无法进行某些操作。您确定要退出吗？
              </p>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleLogoutCancel}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleLogoutConfirm}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  确认退出
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
