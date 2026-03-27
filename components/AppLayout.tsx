'use client';

import { useState, FormEvent, Suspense, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MdMenu, MdHome, MdSettings, MdSearch, MdPerson, MdExpandMore, MdExpandLess, MdLogout } from "react-icons/md";

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
  const pathname = usePathname();
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

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    document.cookie = `sidebarCollapsed=${newState}; path=/; max-age=31536000`;
  };

  const handleLogout = () => {
    localStorage.removeItem('user_info');
    setUserInfo(null);
    setIsUserMenuOpen(false);
    router.push('/');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-16 bg-primary text-white flex items-center px-4 shrink-0">
        <button 
          onClick={toggleSidebar}
          className="p-2 mr-4 rounded-md hover:bg-white/20 text-white transition-colors"
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <MdMenu size={24} />
        </button>
        <Link href="/" className="text-xl font-bold shrink-0 hover:text-white/80 transition-colors">
          PicPony
        </Link>
        <Suspense fallback={<div className="w-48 ml-4 h-8 bg-white/10 rounded-md animate-pulse"></div>}>
          <SearchBar />
        </Suspense>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        <aside 
          className={`bg-slate-50 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
            isCollapsed ? 'w-0' : 'w-64'
          }`}
        >
          <div className="w-64 p-3 pb-0">
            {userInfo ? (
              <div className="relative">
                <button 
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
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
                  <Link 
                    href="/settings"
                    className={`flex items-center px-3 py-3 font-medium transition-colors rounded-lg ${
                      pathname === '/settings' 
                        ? 'text-primary bg-primary/10' 
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <MdSettings size={20} className="shrink-0 mr-3" />
                    <span>设置</span>
                  </Link>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center px-3 py-3 font-medium transition-colors rounded-lg text-slate-700 hover:bg-slate-100 w-full text-left"
                  >
                    <MdLogout size={20} className="shrink-0 mr-3" />
                    <span>退出登录</span>
                  </button>
                </div>
                <div className="h-px bg-slate-200 mt-2 mx-2"></div>
              </div>
            ) : (
              <Link 
                href="/login"
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
            <Link 
              href="/" 
              className={`flex items-center px-3 py-3 font-medium transition-colors rounded-lg ${
                pathname === '/' 
                  ? 'text-primary bg-primary/10' 
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <MdHome size={20} className="shrink-0 mr-3" />
              <span>主页</span>
            </Link>
          </nav>
        </aside>
        
        <main className="flex-1 overflow-y-auto bg-white relative flex flex-col">
          <div key={pathname} className="animate-page-transition p-6 flex-1">
            {children}
          </div>
          <footer className="py-8 px-6 border-t border-slate-100 text-slate-500 text-sm">
            <div className="max-w-screen-xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <p>© 2026 PicPony. All rights reserved. @黄昏夜雨</p>
                <p>本站为 Derpibooru 第三方镜像站点</p>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
