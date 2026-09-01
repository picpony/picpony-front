'use client';

import { useEffect, useState } from 'react';
import { MdClose, MdConstruction } from 'react-icons/md';
import { LS_KEYS } from '@/lib/constants';
import { iconButtonClasses } from './IconButton';
import { ICON } from '@/lib/icons';

/**
 * The dismissible "site is in development" notice. Dismissal persists; render
 * waits for mount, since reading localStorage during render would break
 * hydration.
 */
export default function DevBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        if (localStorage.getItem(LS_KEYS.devBannerDismissed) !== 'true') setVisible(true);
      } catch {
        setVisible(true);
      }
    });
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(LS_KEYS.devBannerDismissed, 'true');
    } catch {
      /* private mode — it will simply come back next visit */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      className="bg-warning-container text-on-warning-container animate-fade-in relative z-app-bar flex shrink-0 items-center gap-2 px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]"
    >
      <MdConstruction size={ICON.dense} className="shrink-0" aria-hidden="true" />
      <p className="text-body-s-emphasized min-w-0 flex-1 text-center">
        网站处于开发阶段，不代表最终品质
      </p>
      {/* Shared icon-button classes, not the component — and the ripple is
          deliberately absent: this control needs the touch floor inside a 44px
          banner, and the hit-area utility cannot combine with `data-ripple`
          (its clipping removes the pseudo-element from hit-testing), which the
          component always sets. Growing the box instead would push the banner
          down the page. The state layer still carries the press. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="不再显示此提示"
        className={iconButtonClasses({
          size: 'sm',
          dismiss: true,
          className: 'touch-target -mr-1.5 h-8 w-8',
        })}
      >
        <MdClose size={ICON.dense} />
      </button>
    </div>
  );
}
