'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';

interface Announcement {
  version: string;
  title: string;
  content: string;
  date: string;
}

export default function AnnouncementModal() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const fetchAnnouncement = async () => {
      try {
        const data = await api.getAnnouncement();
        
        if (data.success && data.announcement) {
          const savedVersion = localStorage.getItem('read_announcement_version');
          if (savedVersion !== data.announcement.version) {
            setAnnouncement(data.announcement);
            setIsVisible(true);
            document.body.style.overflow = 'hidden';
          }
        }
      } catch (error) {
        console.error('获取公告失败', error);
      }
    };

    fetchAnnouncement();
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    if (announcement) {
      localStorage.setItem('read_announcement_version', announcement.version);
    }
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
      document.body.style.overflow = 'unset';
    }, 200);
  };

  if (!mounted || !isVisible || !announcement) return null;

  const modalContent = (
    <div className={`fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-black/50 ${!isClosing ? 'animate-modal-overlay' : 'animate-modal-overlay-out'}`}>
      <div className={`bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col ${!isClosing ? 'animate-modal-content' : 'animate-modal-content-out'}`}>
        <div className="bg-white px-5 py-4 flex items-center text-slate-800">
          <h2 className="text-lg font-bold truncate pr-4">系统公告</h2>
        </div>
        
        <div className="p-5 sm:p-6 overflow-y-auto max-h-[60vh] bg-white">
          <h3 className="text-lg font-bold text-slate-800 mb-2">{announcement.title}</h3>
          <p className="text-xs text-slate-400 mb-4 font-medium pb-3">发布日期：{announcement.date}</p>
          <div 
            className="text-slate-600 text-sm leading-relaxed space-y-2"
            dangerouslySetInnerHTML={{ __html: announcement.content }}
          />
        </div>
        
        <div className="px-5 py-4 sm:px-6 bg-white flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-primary font-medium hover:bg-primary/10 rounded-lg transition-colors active:scale-95 cursor-pointer"
          >
            我已知悉
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
