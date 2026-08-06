'use client';

import DetailBack from '@/components/DetailBack';

/**
 * The pinned back affordance, at the one position the whole app uses.
 *
 * `DetailBack` is the button; this is *where it goes*. That distinction matters
 * because the placement is the fiddly half — a zero-height sticky strip with
 * negative margins that cancel the app shell's own padding — and it was written
 * out longhand inside `PicDetail`'s page branch while the forum post used a
 * third arrangement and search and messages had no way back at all. Four
 * screens, four answers to the same question.
 *
 * How it works:
 *
 * - `h-0` means the strip contributes no layout box, so the content underneath
 *   keeps the exact geometry the hero flight measures on press. A row that
 *   reserved space would move every card by its height.
 * - `sticky top-0` keeps the button in place as the page scrolls, without the
 *   containing-block games a `fixed` element would need inside a transformed
 *   ancestor. `sticky` is also a *positioned* value, so the strip is what
 *   `.image-detail-back`'s `absolute` anchors to.
 * - `-mx-4 -mt-4 sm:-mx-6 sm:-mt-6` cancels `[data-page-content]`'s padding on
 *   *both* axes. Only the horizontal cancel was there before, so the pinned
 *   button sat 16dp (24dp on desktop) lower than the image-detail overlay's,
 *   which is positioned against a different ancestor and does not see that
 *   padding at all. Same button, same intent, two heights.
 *
 * **Render this as the page's outermost element** — before the page's own
 * `max-w-* mx-auto px-*` wrapper, not inside it. The cancel above is calibrated
 * against the shell's padding and nothing else, so a centred wrapper in between
 * adds its own inset back and the button drifts: measured at 48dp from the left
 * on /search, 23dp on /messages and 39dp on a forum post, against 16dp for the
 * image detail. Four screens, four positions, which is the thing this component
 * exists to prevent. (The shell wraps `{children}` in one padding-free `flex-1`
 * div so the footer can sit under it; a box that adds no inset of its own is
 * transparent to this.)
 *
 * The button then floats over whatever is at the top of the page, so a screen
 * whose own content starts there makes room with `pt-14` on its wrapper. The
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
  return (
    <div className="pointer-events-none sticky top-0 z-40 -mx-4 -mt-4 h-0 sm:-mx-6 sm:-mt-6">
      <DetailBack
        onClick={onClick}
        title={title}
        aria-label={label ?? title}
        className="image-detail-back"
      />
    </div>
  );
}
