'use client';

import { useState, useCallback } from 'react';
import {
  MdBook,
  MdDashboard,
  MdPeople,
  MdNotifications,
  MdMessage,
  MdEmojiEvents,
  MdShield,
  MdBuild,
  MdStore,
  MdReport,
  MdBlock,
  MdAttachMoney,
} from 'react-icons/md';
import dynamic from 'next/dynamic';
import Spinner from '@/components/Spinner';

const WelcomeTab = dynamic(() => import('@/components/admin/WelcomeTab'), { ssr: false });
const GlossaryTab = dynamic(() => import('@/components/admin/GlossaryTab'), { ssr: false });
const UsersTab = dynamic(() => import('@/components/admin/UsersTab'), { ssr: false });
const NotificationsTab = dynamic(() => import('@/components/admin/NotificationsTab'), {
  ssr: false,
});
const MessagesAuditTab = dynamic(() => import('@/components/admin/MessagesAuditTab'), {
  ssr: false,
});
const BadgesTab = dynamic(() => import('@/components/admin/BadgesTab'), { ssr: false });
const BlockTagsTab = dynamic(() => import('@/components/admin/BlockTagsTab'), { ssr: false });
const DeveloperTab = dynamic(() => import('@/components/admin/DeveloperTab'), { ssr: false });
const TeamTab = dynamic(() => import('@/components/admin/TeamTab'), { ssr: false });
const ShopTab = dynamic(() => import('@/components/admin/ShopTab'), { ssr: false });
const ReportsTab = dynamic(() => import('@/components/admin/ReportsTab'), { ssr: false });
const BlacklistTab = dynamic(() => import('@/components/admin/BlacklistTab'), { ssr: false });
const WealthTab = dynamic(() => import('@/components/admin/WealthTab'), { ssr: false });
const OtherTab = dynamic(() => import('@/components/admin/OtherTab'), { ssr: false });

type TabId =
  | 'welcome'
  | 'glossary'
  | 'users'
  | 'notifications'
  | 'messages'
  | 'reports'
  | 'blacklist'
  | 'shop'
  | 'wealth'
  | 'other'
  | 'badges'
  | 'blocktags'
  | 'developer'
  | 'team';

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  editorOnly?: boolean;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('welcome');

  const initAdmin = () => {
    const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user_info') : null;
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        return { userRole: user.role || 'user', token: user.token || '' };
      } catch {
        // ignore
      }
    }
    return { userRole: 'user', token: '' };
  };

  const initialAdmin = initAdmin();
  const [userRole] = useState<string>(initialAdmin.userRole);
  const [token] = useState<string>(initialAdmin.token);
  const [isLoading] = useState(false);

  const tabs: TabConfig[] = [
    { id: 'welcome', label: '欢迎', icon: <MdDashboard size={20} />, editorOnly: true },
    { id: 'glossary', label: '词库编辑', icon: <MdBook size={20} />, editorOnly: true },
    { id: 'users', label: '用户管理', icon: <MdPeople size={20} />, adminOnly: true },
    {
      id: 'notifications',
      label: '通知管理',
      icon: <MdNotifications size={20} />,
      adminOnly: true,
    },
    { id: 'messages', label: '私信审计', icon: <MdMessage size={20} />, adminOnly: true },
    { id: 'badges', label: '徽章管理', icon: <MdEmojiEvents size={20} />, adminOnly: true },
    { id: 'blocktags', label: '屏蔽标签', icon: <MdShield size={20} />, adminOnly: true },
    { id: 'developer', label: '开发者', icon: <MdBuild size={20} />, adminOnly: true },
    { id: 'team', label: '团队管理', icon: <MdPeople size={20} />, adminOnly: true },
    { id: 'shop', label: '商店管理', icon: <MdStore size={20} />, adminOnly: true },
    { id: 'reports', label: '举报处理', icon: <MdReport size={20} />, adminOnly: true },
    { id: 'blacklist', label: '屏蔽图库', icon: <MdBlock size={20} />, adminOnly: true },
    { id: 'wealth', label: '经验金币', icon: <MdAttachMoney size={20} />, superAdminOnly: true },
    { id: 'other', label: '其他功能', icon: <MdBuild size={20} />, adminOnly: true },
  ];

  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
  }, []);

  const isEditor = userRole === 'editor';
  const isAdmin = ['super_admin', 'admin'].includes(userRole);
  const isSuperAdmin = userRole === 'super_admin';
  const visibleTabs = tabs.filter((tab) => {
    if (isEditor) return tab.editorOnly;
    if (tab.superAdminOnly) return isSuperAdmin;
    if (tab.adminOnly) return isAdmin;
    return true;
  });
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
        {' '}
        <Spinner size="lg" label="" />{' '}
      </div>
    );
  }
  if (!isAdmin && !isEditor) {
    return (
      <div className="max-w-6xl mx-auto text-center py-12">
        {' '}
        <p className="text-on-surface-variant">您没有权限访问此页面</p>{' '}
      </div>
    );
  }
  return (
    <div className="max-w-6xl mx-auto">
      {' '}
      <div className="bg-surface rounded-md overflow-hidden flex flex-col md:flex-row">
        {' '}
        <div className="md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-outline-variant">
          {' '}
          <nav className="flex md:flex-col p-2 gap-1 overflow-x-auto scrollbar-hide">
            {' '}
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                data-ripple
                aria-current={activeTab === tab.id}
                className={`group flex items-center gap-2 rounded-full px-3 py-2.5 text-label-l transition-ui whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary md:translate-x-1'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span
                  className={`shrink-0 transition-transform duration-300 ease-[var(--ease-spring)] ${
                    activeTab === tab.id ? 'scale-110' : 'group-hover:scale-105'
                  }`}
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex-1 p-4 sm:p-6 min-h-[400px] md:min-h-[600px] relative">
          <div key={activeTab} className="animate-page-transition">
            {activeTab === 'welcome' && <WelcomeTab />}
            {activeTab === 'glossary' && <GlossaryTab />}
            {activeTab === 'users' && <UsersTab token={token} myRole={userRole} />}
            {activeTab === 'notifications' && <NotificationsTab token={token} />}
            {activeTab === 'messages' && <MessagesAuditTab token={token} />}
            {activeTab === 'badges' && <BadgesTab token={token} />}
            {activeTab === 'blocktags' && <BlockTagsTab token={token} />}
            {activeTab === 'developer' && <DeveloperTab token={token} />}
            {activeTab === 'team' && <TeamTab token={token} />}
            {activeTab === 'shop' && <ShopTab token={token} />}
            {activeTab === 'reports' && <ReportsTab token={token} />}
            {activeTab === 'blacklist' && <BlacklistTab token={token} />}
            {activeTab === 'wealth' && <WealthTab token={token} />}
            {activeTab === 'other' && <OtherTab token={token} />}
          </div>
        </div>
      </div>
    </div>
  );
}
