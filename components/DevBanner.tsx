'use client';

import { useEffect, useState } from 'react';
import { MdClose, MdConstruction } from 'react-icons/md';
import { COOKIE_KEYS, LS_KEYS } from '@/lib/constants';
import { iconButtonClasses } from './IconButton';
import { ICON } from '@/lib/icons';

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** The cookie is only the server's copy; a browser refusing it still dismisses for the session. */
function mirrorDismissal(dismissed: boolean) {
  try {
    document.cookie = `${COOKIE_KEYS.devBannerDismissed}=${dismissed};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  } catch {
    /* Cookies blocked (a sandboxed frame): the next cold load decides from its defaults. */
  }
}

/**
 * The dismissible "site is in development" notice, part of the shell's top chrome.
 *
 * **Rendered by the server**, from a cookie that mirrors the dismissal. It used to wait for
 * mount (the dismissal lives in `localStorage`, which the server cannot read), so every cold
 * load painted the app and then pushed the whole shell down 44px when the banner arrived. The
 * server now answers from the cookie and the client only reconciles: `localStorage` stays the
 * authority, and a disagreement — a cookie cleared, or a dismissal from before the cookie
 * existed — is corrected once and healed for every load after it.
 *
 * `data-dev-banner` is what the chrome geometry keys on: the first-paint value of
 * `--app-chrome-bottom` counts this row, and the app bar below it stops paying the top
 * safe-area inset, which this row pays instead.
 *
 * `role="note"`: a static notice, not a live update — a status role announced it on load.
 */
export default function DevBanner({
  initiallyVisible,
  inert,
}: {
  initiallyVisible: boolean;
  /** The phone's modal drawer covers the chrome; its scrim dims this row with the app bar. */
  inert?: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);

  useEffect(() => {
    let dismissed: boolean;
    try {
      dismissed = localStorage.getItem(LS_KEYS.devBannerDismissed) === 'true';
    } catch {
      /* Storage blocked: the cookie's answer is the only one there is. */
      return;
    }
    mirrorDismissal(dismissed);
    if (dismissed !== !initiallyVisible) {
      /* Out of the effect body, for `react-hooks/set-state-in-effect`; still before paint. */
      queueMicrotask(() => setVisible(!dismissed));
    }
  }, [initiallyVisible]);

  const dismiss = () => {
    setVisible(false);
    mirrorDismissal(true);
    try {
      localStorage.setItem(LS_KEYS.devBannerDismissed, 'true');
    } catch {
      /* private mode — the cookie still carries it */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="开发提示"
      data-dev-banner
      inert={inert || undefined}
      className="bg-warning-container text-on-warning-container flex shrink-0 select-none items-center gap-2 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
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
