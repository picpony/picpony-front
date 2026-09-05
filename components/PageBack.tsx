'use client';

import { createPortal } from 'react-dom';
import DetailBack from '@/components/DetailBack';
import { useMounted } from '@/lib/overlay';

/**
 * The pinned back affordance, at the one position the whole app uses.
 *
 * **It is chrome, so it renders outside the page** — portalled into
 * `[data-page-back-slot]`, a shim the shell renders as a sibling of the
 * scroller. Inside the page content it was cloned by the route cross-fade and
 * translated bodily by the shared axis; the same affordance should not move.
 *
 * Deliberately **no entrance animation**: between two screens that both have a
 * back button the node remounts at the same coordinate looking identical, and a
 * fade would put a flash on every such move.
 *
 * Positioning comes from `.image-detail-back` (globals.css), resolved against
 * the slot's content-area box. Screens whose content starts at the top still
 * make room with their own top padding; the image detail does not, because the
 * picture is up there.
 */
export default function PageBack({
  onClick,
  title,
  label,
}: {
  onClick: () => void;
  /** Tooltip. Say where it goes and mention the key: `返回论坛 (Esc)`. */
  title: string;
  /** Accessible name, if it differs from the tooltip. */
  label?: string;
}) {
  const mounted = useMounted();

  const button = (
    <DetailBack
      onClick={onClick}
      aria-label={label ?? title}
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
