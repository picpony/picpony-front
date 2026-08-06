'use client';

import { useEffect, useState } from 'react';
import { MdClose, MdConstruction } from 'react-icons/md';
import { LS_KEYS } from '@/lib/constants';

/**
 * The "site is in development" notice.
 *
 * Was a permanent amber strip pinned above the app bar. It cost ~28px of
 * vertical space on every screen, on a phone that is a meaningful slice of the
 * viewport, and it said the same thing on the thousandth visit as on the first.
 * Styled as an M3 banner now, and dismissible.
 *
 * Rendered only after mount: reading localStorage during render would either
 * mismatch hydration or force the whole shell to be client-only, and a banner
 * that appears a frame late is preferable to either.
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
      className="bg-warning-container text-on-warning-container animate-fade-in relative z-50 flex shrink-0 items-center gap-2 px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]"
    >
      <MdConstruction size={16} className="shrink-0 opacity-80" aria-hidden="true" />
      <p className="text-body-s min-w-0 flex-1 text-center font-medium">
        网站处于开发阶段，不代表最终品质
      </p>
      <button
        onClick={dismiss}
        aria-label="不再显示此提示"
        className="touch-target -mr-1.5 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-transform duration-200 ease-[var(--ease-standard)] hover:rotate-90 focus-visible:ring-2 focus-visible:ring-current/40 motion-reduce:hover:rotate-0"
      >
        <MdClose size={16} />
      </button>
    </div>
  );
}
