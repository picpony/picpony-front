'use client';

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MdMenu, MdHome, MdSettings } from "react-icons/md";

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
        <div className="text-xl font-bold">PicPony</div>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        <aside 
          className={`bg-slate-50 flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
            isCollapsed ? 'w-0' : 'w-64'
          }`}
        >
          <nav className="flex-1 py-4 w-64">
            <Link 
              href="/" 
              className={`flex items-center px-6 py-3 font-medium transition-colors ${
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
              className={`flex items-center px-6 py-3 font-medium transition-colors ${
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
        
        <main className="flex-1 overflow-y-auto bg-white p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
