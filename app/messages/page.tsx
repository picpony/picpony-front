'use client';

import { useState, useEffect } from 'react';
import { MdAnnouncement, MdNotifications, MdChevronRight } from 'react-icons/md';
import { api } from '@/lib/api';

interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

interface Notification {
  id: number;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}

export default function MessagesPage() {
  const [activeTab, setActiveTab] = useState<'announcement' | 'notification'>('announcement');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'announcement') {
      fetchAnnouncements();
    } else {
      fetchNotifications();
    }
  }, [activeTab]);

  const fetchAnnouncements = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnnouncementHistory();
      if (data.success) {
        setAnnouncements(data.announcements);
      } else {
        setError('获取公告失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getNotifications();
      if (data.success) {
        setNotifications(data.notifications);
      } else {
        setError('获取通知失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">消息中心</h1>
      
      <div className="flex border-b border-slate-200 mb-6 relative">
        <button
          onClick={() => setActiveTab('announcement')}
          className={`flex items-center px-6 py-3 font-medium transition-colors relative z-10 ${
            activeTab === 'announcement' ? 'text-primary' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <MdAnnouncement size={20} className="mr-2" />
          <span>公告</span>
        </button>
        <button
          onClick={() => setActiveTab('notification')}
          className={`flex items-center px-6 py-3 font-medium transition-colors relative z-10 ${
            activeTab === 'notification' ? 'text-primary' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <MdNotifications size={20} className="mr-2" />
          <span>通知</span>
        </button>
        <div 
          className="absolute bottom-0 h-0.5 bg-primary transition-all duration-300 ease-in-out"
          style={{
            left: activeTab === 'announcement' ? '0' : '104px',
            width: activeTab === 'announcement' ? '104px' : '104px'
          }}
        />
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'announcement' ? (
          <div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-50 h-32 rounded-xl animate-pulse"></div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-20 text-slate-500">
                <p>{error}</p>
                <button 
                  onClick={fetchAnnouncements}
                  className="mt-4 text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            ) : announcements.length > 0 ? (
              <div className="space-y-4">
                {announcements.map((item) => (
                  <div 
                    key={item.id} 
                    className="bg-white border border-slate-100 rounded-xl p-5 hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center">
                        <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded mr-3">
                          {item.version}
                        </span>
                        <h3 className="text-lg font-bold text-slate-800">{item.title}</h3>
                      </div>
                      <span className="text-sm text-slate-400">{item.date}</span>
                    </div>
                    <div 
                      className="text-slate-600 text-sm leading-relaxed announcement-content"
                      dangerouslySetInnerHTML={{ __html: item.content }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 text-slate-500">
                暂无公告
              </div>
            )}
          </div>
        ) : (
          <div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-50 h-24 rounded-xl animate-pulse"></div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-20 text-slate-500">
                <p>{error}</p>
                <button 
                  onClick={fetchNotifications}
                  className="mt-4 text-primary hover:underline"
                >
                  重试
                </button>
              </div>
            ) : notifications.length > 0 ? (
              <div className="space-y-4">
                {notifications.map((item) => (
                  <div 
                    key={item.id} 
                    className="bg-white border border-slate-100 rounded-xl p-5 hover:bg-slate-50/50 transition-colors relative overflow-hidden"
                  >
                    {item.is_read === 0 && (
                      <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                    )}
                    <div className="flex justify-between items-start mb-2">
                      <h3 className={`text-lg font-bold ${item.is_read === 0 ? 'text-slate-900' : 'text-slate-700'}`}>
                        {item.title}
                      </h3>
                      <span className="text-sm text-slate-400">{item.created_at}</span>
                    </div>
                    <div className="text-slate-600 text-sm leading-relaxed">
                      {item.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20 text-slate-500">
                暂无通知
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .announcement-content br {
          margin-bottom: 0.5rem;
          display: block;
          content: "";
        }
      `}</style>
    </div>
  );
}
