'use client';

import { createPortal } from 'react-dom';
import DetailBack from '@/components/DetailBack';
import { useMounted } from '@/lib/overlay';

/**
 * The pinned back affordance, at the one position the whole app uses.
 *
 * `DetailBack` is the button; this is *where it goes*. That distinction matters
 * because the placement is the fiddly half, and it was written out longhand
 * inside `PicDetail`'s page branch while the forum post used a third arrangement
 * and search and messages had no way back at all. Four screens, four answers to
 * the same question.
 *
 * **It is chrome, so it is rendered outside the page.** This used to be a
 * zero-height sticky strip inside `[data-page-content]` with negative margins
 * cancelling the shell's padding, and that put it inside the thing every screen
 * transition moves:
 *
 * - the route cross-fade clones `[data-page-content]`, so the outgoing frame
 *   carried a copy of the button which faded out under the new one;
 * - the shared axis translates `[data-page-content]` bodily, so /search ->
 *   /messages — an X-axis move — swept the button a full window to the left
 *   while the incoming page's identical button swept in from the right, landing
 *   on the pixel the first one had just left.
 *
 * Both are invisible when the two buttons happen to look alike and obvious the
 * moment they are watched for. The affordance is the same affordance on both
 * sides of the move, so the honest answer is that it should not move: it is
 * portalled into `[data-page-back-slot]`, a shim the shell renders as a sibling
 * of the scroller. The page still owns the handler, the label and the mount, so
 * nothing about the call sites changed — but the DOM node is no longer inside
 * anything that animates.
 *
 * There is deliberately **no entrance animation**. Between two screens that both
 * have a back button the node is unmounted and remounted at the same coordinate
 * with the same appearance, so nothing is visible; adding a fade would put a
 * flash on every one of those transitions in exchange for smoothing the rarer
 * case where the button genuinely appears or leaves — and that case coincides
 * with the whole page changing, which already reads as one event.
 *
 * Positioning comes from `.image-detail-back` (globals.css), the same class the
 * Stage and the routed overlay use, resolved against the slot's `inset-0` box —
 * which is the content area, i.e. exactly the box the negative margins used to
 * reconstruct. `sticky top-0` is gone because it has nothing left to do: the
 * button is no longer inside the scroller, so it cannot scroll away.
 *
 * Screens whose own content starts at the top still make room with `pt-14`. The
 * image detail does not, because what is up there is the picture.
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

  /* Before hydration there is no slot to portal into, and the server cannot
     render one page's node into another element anyway. The button is absolutely
     positioned and contributes no layout, so appearing on hydration costs no
     shift — and every screen that uses this is a client component whose content
     arrives at the same moment. */
  if (!mounted) return null;

  const slot = document.querySelector('[data-page-back-slot]');
  /* Rendered in place if the shell is not there — a screen mounted outside
     `AppLayout` should still have a way back, even if the pixel is then relative
     to its own container rather than to the content area. */
  if (!slot) return <div className="pointer-events-none relative z-page-chrome h-0">{button}</div>;

  return createPortal(button, slot);
}
