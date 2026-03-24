'use client';

import { useState } from "react";
import Link from "next/link";

export default function AppLayout({ 
  children, 
  initialCollapsed 
}: { 
  children: React.ReactNode;
  initialCollapsed: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  const toggleSidebar = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    document.cookie = `sidebarCollapsed=${newState}; path=/; max-age=31536000`;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="h-16 bg-slate-50 text-slate-900 flex items-center px-4 shrink-0">
        <button 
          onClick={toggleSidebar}
          className="p-2 mr-4 rounded-md hover:bg-slate-200 text-slate-600 transition-colors"
          aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
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
              className="flex items-center px-6 py-3 text-slate-700 bg-slate-100 font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mr-3">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              <span>主页</span>
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
