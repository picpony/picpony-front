'use client';

import { createPortal } from 'react-dom';
import DetailBack from '@/components/DetailBack';
import { useMounted } from '@/lib/overlay';

/**
 * The pinned back affordance, at the one position the whole app uses.
 *
 * **It is chrome, so it renders outside the page** — portalled into
 * `[data-page-back-slot]`, a shim the shell renders as a sibling of the
 * scroller, *before* it in the DOM, so it is also the first stop of the page in
 * the tab order (it is drawn first, at the top left). Inside the page content it
 * was cloned by the route cross-fade and translated bodily by the shared axis; the
 * same affordance should not move.
 *
 * Deliberately **no entrance animation**: between two screens that both have a
 * back button the node remounts at the same coordinate looking identical, and a
 * fade would put a flash on every such move. Between a screen with one and a
 * screen without, it leaves or arrives with its page — the route cross-fade
 * fades a copy of it out, or the slot in (`lib/routeCrossFadePlay.ts`).
 *
 * Positioning comes from `.image-detail-back` (globals.css). The page makes room
 * for it with one of the `page-back-room` classes on its root, which reserve the
 * button's footprint only while the page's column has no room beside it.
 *
 * Pair `onClick` with `useBackOrParent` (`lib/backNavigation.ts`) and hand the same
 * callback to `useEscapeBack`: on a cold entry the previous history entry is not
 * the app's, and plain `router.back()` left it.
 */
export default function PageBack({
  onClick,
  label = '返回',
  title,
}: {
  onClick: () => void;
  /** The accessible name — say where it goes when that is not obvious: `返回论坛`. */
  label?: string;
  /** The tooltip, which also mentions the key. Defaults to the label with `(Esc)`. */
  title?: string;
}) {
  const mounted = useMounted();

  const button = (
    <DetailBack
      onClick={onClick}
      aria-label={label}
      /* The key the page binds to the same action (`useEscapeBack`) — announced, and kept out
         of the name: a name reading "返回 (Esc)" spoke the parenthesis aloud. */
      aria-keyshortcuts="Escape"
      title={title ?? `${label} (Esc)`}
      className="image-detail-back"
    />
  );

  /* Before hydration there is no slot to portal into. The button is absolutely
     positioned and contributes no layout, so appearing on hydration costs no
     shift — and every screen using this is a client component anyway. */
  if (!mounted) return null;

  const slot = document.querySelector('[data-page-back-slot]');
  /* Rendered in place if the shell is not there — a screen mounted outside
     `AppLayout` should still have a way back. */
  if (!slot) return <div className="pointer-events-none relative z-page-chrome h-0">{button}</div>;

  return createPortal(button, slot);
}
