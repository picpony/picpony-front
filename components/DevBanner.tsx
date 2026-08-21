'use client';

import { useEffect, useState } from 'react';
import { MdClose, MdConstruction } from 'react-icons/md';
import { LS_KEYS } from '@/lib/constants';
import { iconButtonClasses } from './IconButton';
import { ICON } from '@/lib/icons';

/**
 * The "site is in development" notice.
 *
 * Was a permanent amber strip pinned above the app bar. It cost vertical space on
 * every screen — 44px now, its 32px dismiss button plus `py-1.5` either side — and
 * on a phone that is a meaningful slice of the viewport, and it said the same thing
 * on the thousandth visit as on the first. Styled as an M3 banner now, and
 * dismissible.
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
      className="bg-warning-container text-on-warning-container animate-fade-in relative z-app-bar flex shrink-0 items-center gap-2 px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]"
    >
      <MdConstruction size={ICON.dense} className="shrink-0" aria-hidden="true" />
      <p className="text-body-s-emphasized min-w-0 flex-1 text-center">
        网站处于开发阶段，不代表最终品质
      </p>
      {/* `iconButtonClasses`, not the `IconButton` component, and the ripple is
          deliberately absent.
          This control has to keep the touch floor inside a 44px-tall banner, and
          `touch-target` is the utility for exactly that — it grows the hit area
          without changing layout, to `--touch-floor`: 48px under a finger, 24 under
          a pointer, so on a desktop the region stops overhanging the banner's own
          padding. It cannot be combined with `data-ripple`, whose `overflow: hidden`
          clips the pseudo-element out of hit-testing, and the component always sets
          that attribute. Elsewhere the app answers this by growing the box
          (`Pagination` takes `touch-size`); here the box cannot grow without pushing
          the banner down the page on the one viewport where vertical space is
          scarcest. So it takes the shared look and opts out of the press wave — the
          state layer still carries the press. */}
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
