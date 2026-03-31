'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Tabs, Tab, Box } from '@mui/material';

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
    document.title = "消息 - PicPony";
  }, []);

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
      <h1 className="text-2xl font-bold text-slate-800 mb-6">消息</h1>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, newValue) => setActiveTab(newValue)}
          sx={{
            '& .MuiTab-root': {
              fontSize: '1rem',
              fontWeight: 500,
              textTransform: 'none',
              minWidth: 100,
            },
            '& .Mui-selected': {
              color: 'var(--color-primary) !important',
            },
            '& .MuiTabs-indicator': {
              backgroundColor: 'var(--color-primary)',
            }
          }}
        >
          <Tab label="公告" value="announcement" />
          <Tab label="通知" value="notification" />
        </Tabs>
      </Box>

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
                    className="bg-white rounded-xl p-5"
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
                    className="bg-white rounded-xl p-5 relative overflow-hidden"
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
