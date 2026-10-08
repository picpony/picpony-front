'use client';

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { api, type Announcement } from '@/lib/api';
import Modal from './Modal';
import Button from './Button';
import SectionHeading from '@/components/SectionHeading';
import { LS_KEYS } from '@/lib/constants';
import { isScreenQuiet, subscribeScreenQuiet } from '@/lib/overlay';
import { runWhenIdle } from '@/lib/utils';

/**
 * The site announcement, once per version.
 *
 * It is the app's own interruption, so it waits its turn: it opens only while the screen is
 * quiet — no dialog, sheet, drawer or open picture, no hero flight, no route transition —
 * rather than stacking a second modal task (and a second scrim) on the one the user is in.
 * Once open it stays open; its own layer is what makes the screen "not quiet" after that.
 */
export default function AnnouncementModal() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'open' | 'closed'>('waiting');
  const quiet = useSyncExternalStore(subscribeScreenQuiet, isScreenQuiet, () => false);

  /* Latched in render, not in an effect: the dialog's own layer ends the quiet in the
     commit it opens, and an effect would first render one frame closed again. */
  if (announcement && phase === 'waiting' && quiet) setPhase('open');

  /* On idle, not on mount: this request must not race the feed the visitor came for,
   * and it cannot be gated on the stored version — the version to compare against is
   * what this request returns. */
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      void (async () => {
        try {
          const data = await api.getAnnouncement();
          if (!data.success || !data.announcement) return;
          let savedVersion: string | null = null;
          try {
            savedVersion = localStorage.getItem(LS_KEYS.readAnnouncementVersion);
          } catch {
            /* Storage can be disabled. */
          }
          if (savedVersion === data.announcement.version || cancelled) return;
          // Already sanitised by the adapter (`lib/api/picpony.ts`), once for every consumer.
          setAnnouncement(data.announcement);
        } catch {
          /* An announcement is optional: a failed read shows nothing and asks again next visit. */
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  const handleClose = () => {
    if (announcement) {
      try {
        localStorage.setItem(LS_KEYS.readAnnouncementVersion, announcement.version);
      } catch {
        /* Dismiss still works without persistence. */
      }
    }
    setPhase('closed');
  };

  return (
    <Modal
      isOpen={phase === 'open'}
      onClose={handleClose}
      title="系统公告"
      maxWidth="lg"
      footer={
        <Button variant="text" onClick={handleClose}>
          我已知悉
        </Button>
      }
    >
      {announcement && (
        <>
          <SectionHeading as="h3" className="mb-2">
            {announcement.title}
          </SectionHeading>
          <p className="text-label-m text-on-surface-variant mb-4">发布日期：{announcement.date}</p>
          {/* The shared rich-text rhythm — links, lists and paragraphs as everywhere else
              prose is rendered — at the dialog's supporting-text role. Sanitised by the adapter. */}
          {/* The dialog is surface-container-high, which is the quote's own default step, so a
              quote here takes the next one up (`--rt-quote-surface`) or it vanishes into the panel. */}
          <div
            className="rich-text-content text-body-m text-on-surface-variant"
            style={{ '--rt-quote-surface': 'var(--md-sys-color-surface-container-highest)' } as CSSProperties}
            dangerouslySetInnerHTML={{ __html: announcement.content }}
          />
        </>
      )}
    </Modal>
  );
}
