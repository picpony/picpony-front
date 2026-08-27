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

  /* On idle, not on mount.
   *
   * This request used to leave with the first burst of every cold load, in front of the feed the
   * visitor actually came for — measured as one of four shell requests racing the gallery's own,
   * on every screen in the app including the ones that read nothing. What it decides is whether to
   * open a dialog over content that has not arrived yet, which is the definition of work that can
   * wait: an announcement is no less announced 400ms later, and a modal that appears *after* the
   * page has painted is the better of the two orderings anyway.
   *
   * Not gated on the stored version, because the version to compare against is what this request
   * returns. */
  useEffect(
    () =>
      runWhenIdle(() => {
        void (async () => {
          try {
            const data = await api.getAnnouncement();
            if (data.success && data.announcement) {
              const savedVersion = localStorage.getItem(LS_KEYS.readAnnouncementVersion);
              if (savedVersion !== data.announcement.version) {
                setAnnouncement(data.announcement);
                setIsVisible(true);
              }
            }
          } catch (error) {
            console.error('获取公告失败', error);
          }
        })();
      }),
    [],
  );

  const handleClose = () => {
    if (announcement) {
      localStorage.setItem(LS_KEYS.readAnnouncementVersion, announcement.version);
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
          {/* `SectionHeading`, not an `<h3 class="text-title-m-emphasized">` written
              out — that role, that ink and that object are exactly what the primitive
              is. */}
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
