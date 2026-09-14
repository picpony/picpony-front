'use client';

import { useEffect, useState } from 'react';
import { api, type Announcement } from '@/lib/api';
import Modal from './Modal';
import Button from './Button';
import SectionHeading from '@/components/SectionHeading';
import { LS_KEYS } from '@/lib/constants';
import { runWhenIdle } from '@/lib/utils';

export default function AnnouncementModal() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  /* On idle, not on mount: this request must not race the feed the visitor came for,
   * and it cannot be gated on the stored version — the version to compare against is
   * what this request returns. */
  useEffect(() => {
      let cancelled = false;
      const cancelIdle = runWhenIdle(() => {
        void (async () => {
          try {
            const data = await api.getAnnouncement();
            if (data.success && data.announcement) {
              let savedVersion: string | null = null;
              try { savedVersion = localStorage.getItem(LS_KEYS.readAnnouncementVersion); } catch { /* Storage can be disabled. */ }
              if (savedVersion !== data.announcement.version) {
                const { sanitizeHtml } = await import('@/lib/sanitizeHtml');
                if (cancelled) return;
                setAnnouncement({ ...data.announcement, content: sanitizeHtml(data.announcement.content) });
                setIsVisible(true);
              }
            }
          } catch (error) {
            console.error('获取公告失败', error);
          }
        })();
      });
      return () => { cancelled = true; cancelIdle(); };
  }, []);

  const handleClose = () => {
    if (announcement) {
      try { localStorage.setItem(LS_KEYS.readAnnouncementVersion, announcement.version); } catch { /* Dismiss still works without persistence. */ }
    }
    setIsVisible(false);
  };

  return (
    <Modal
      isOpen={isVisible}
      onClose={handleClose}
      title="系统公告"
      maxWidth="lg"
      footer={
        <Button variant="text" className="text-primary-ink" onClick={handleClose}>
          我已知悉
        </Button>
      }
    >
      {announcement && (
        <>
          <SectionHeading as="h3" className="mb-2">
            {announcement.title}
          </SectionHeading>
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
