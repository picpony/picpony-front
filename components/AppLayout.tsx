'use client';

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MdMenu, MdHome, MdSettings, MdSearch, MdPerson } from "react-icons/md";

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

export default function AppLayout({ 
  children, 
  initialCollapsed 
}: { 
  children: React.ReactNode;
  initialCollapsed: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    document.cookie = `sidebarCollapsed=${newState}; path=/; max-age=31536000`;
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
        <div className="text-xl font-bold shrink-0">PicPony</div>
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
          <div className="w-64 p-4">
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
          </div>
          <nav className="flex-1 py-4 w-64 px-3 space-y-1">
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
          </nav>
        </aside>
        
        <main className="flex-1 overflow-y-auto bg-white p-6 relative">
          <div key={pathname} className="animate-page-transition">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
