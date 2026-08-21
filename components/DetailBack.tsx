'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { MdArrowBack } from 'react-icons/md';
import IconButton from './IconButton';
import { ICON } from '@/lib/icons';

type DetailBackProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  passive?: boolean;
};

/**
 * Back affordance for the image detail view.
 *
 * A Material 3 **filled tonal icon button**, which is what the spec uses for a
 * leading navigation action that has to sit on top of content rather than in a
 * top app bar: 40dp container, 24dp icon, secondary container fill, and the
 * standard state layer for hover/focus/press.
 *
 * It takes the *square* shape rather than the full corner, and that is a
 * response to where it sits rather than a preference. The button is pinned near
 * the top-left of the content section, whose own corner is 12dp, and a pill
 * sitting just inside a 12dp arc reads as something stuck on top of the frame
 * instead of as part of it.
 *
 * Note what this is *not*: it is not a concentric pair. Nested corners are
 * concentric when `inner = outer - gap`, and at a 16px inset that arithmetic
 * gives 0 — a hard rectangle, which the shape scale has no role for on anything
 * holding a glyph. The gap here is simply too large for the two corners to be
 * read as one curve inside another; they are neighbours, not rings. 12dp is the
 * shape table's own step for a square icon button and it matches the frame's
 * vocabulary, which is all that is being claimed. The concentric rule is for
 * boxes that genuinely nest — see the shape section in AGENTS.md.
 *
 * Earlier passes made this a labelled pill and then a translucent blurred chip.
 * Both were inventions. M3 back is icon-only — the arrow is the single most
 * conventional glyph in the system and a text label next to it adds width
 * without adding meaning — and the tonal container already separates it from
 * the surface, so it needs no keyline or backdrop blur of its own. The label
 * survives as the accessible name and the tooltip.
 *
 * The container, the state layer and the elevation step now come from
 * `IconButton`; what is left here is the glyph, the wording and `passive`.
 * They were spelled out inline until there was a primitive to spell them once.
 *
 * Motion is the state layer plus the shared ripple; no bespoke transform.
 *
 * `passive` is the copy that rides along on a hero flight: still clickable, so a tap
 * during the flight still turns it around, but out of the tab order, out of the
 * accessibility tree and without a ripple of its own, because the real one is mounted at
 * the same time. It went unused for several passes — `HeroStage` rendered its copy
 * plainly — which put two focusable 返回图片列表 buttons in the tab order for the length
 * of every flight.
 */
const DetailBack = forwardRef<HTMLButtonElement, DetailBackProps>(function DetailBack(
  {
    passive = false,
    className = '',
    title = '返回图库 (Esc)',
    tabIndex,
    'aria-label': ariaLabel = '返回图片列表',
    'aria-hidden': ariaHidden,
    ...props
  },
  ref,
) {
  return (
    <IconButton
      ref={ref}
      {...props}
      variant="tonal"
      size="md"
      shape="square"
      icon={<MdArrowBack size={ICON.standard} aria-hidden="true" />}
      title={title}
      tabIndex={passive ? -1 : tabIndex}
      aria-label={ariaLabel}
      aria-hidden={passive ? true : ariaHidden}
      // A copy riding along on a hero flight must not spawn its own wave.
      data-ripple={passive ? undefined : ''}
      className={className}
    />
  );
});

DetailBack.displayName = 'DetailBack';

export default DetailBack;
