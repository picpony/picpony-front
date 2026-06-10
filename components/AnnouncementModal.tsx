'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Modal from './Modal';

interface Announcement {
  version: string;
  title: string;
  content: string;
  date: string;
}

export default function AnnouncementModal() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const data = await api.getAnnouncement();

        if (data.success && data.announcement) {
          const savedVersion = localStorage.getItem('read_announcement_version');
          if (savedVersion !== data.announcement.version) {
            setAnnouncement(data.announcement);
            setIsVisible(true);
          }
        }
      } catch (error) {
        console.error('获取公告失败', error);
      }
    };

    fetchAnnouncement();
  }, []);

  const handleClose = () => {
    if (announcement) {
      localStorage.setItem('read_announcement_version', announcement.version);
    }
    setIsVisible(false);
  };

  return (
    <Modal
      isOpen={isVisible}
      onClose={handleClose}
      title="系统公告"
      maxWidth="max-w-lg"
      footer={
        <button
          onClick={handleClose}
          className="px-4 py-2 text-primary font-medium hover:bg-primary/10 rounded-lg transition-colors active:scale-95 cursor-pointer"
        >
          我已知悉
        </button>
      }
    >
      {announcement && (
        <>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">{announcement.title}</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-4 font-medium pb-3">发布日期：{announcement.date}</p>
          <div
            className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed space-y-2"
            dangerouslySetInnerHTML={{ __html: announcement.content }}
          />
        </>
      )}
    </Modal>
  );
}
