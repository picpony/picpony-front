'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { MdArrowBack } from 'react-icons/md';
import IconButton from './IconButton';

type DetailBackProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  passive?: boolean;
};

/**
 * Back affordance for the image detail view.
 *
 * A Material 3 **filled tonal icon button**, which is what the spec uses for a
 * leading navigation action that has to sit on top of content rather than in a
 * top app bar: 40dp container, 24dp icon, full corner radius, secondary
 * container fill, and the standard state layer for hover/focus/press.
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
 * `passive` is the copy that rides along on a hero flight: visible, but not in
 * the tab order and not in the accessibility tree, because the real one is
 * still mounted somewhere else.
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
      icon={<MdArrowBack size={24} aria-hidden="true" />}
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
