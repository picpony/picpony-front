'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Modal from './Modal';
import Button from './Button';

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
        <Button variant="text" className="text-primary" onClick={handleClose}>
          我已知悉
        </Button>
      }
    >
      {announcement && (
        <>
          <h3 className="text-title-m-emphasized text-on-surface mb-2">{announcement.title}</h3>
          <p className="text-label-m text-on-surface-variant mb-4 pb-3">发布日期：{announcement.date}</p>
          <div
            className="text-on-surface-variant text-body-m space-y-2"
            dangerouslySetInnerHTML={{ __html: announcement.content }}
          />
        </>
      )}
    </Modal>
  );
}
