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
 * A Material 3 **filled tonal icon button** — what the spec uses for a leading
 * navigation action that sits on top of content rather than in a top app bar.
 * It takes the *square* shape deliberately: the button is pinned just inside the
 * content section's 12dp corner, where a pill reads as something stuck on top of
 * the frame. This is not a concentric pair (at a 16px inset the arithmetic gives
 * 0, and the gap is too large for the corners to read as one curve inside
 * another) — they are neighbours, and 12dp is the shape table's step for a
 * square icon button.
 *
 * Icon-only is the M3 back affordance; the label survives as the accessible name
 * and the tooltip. The container, state layer and elevation step come from
 * `IconButton`; what is left here is the glyph, the wording and `passive`.
 * Motion is the state layer plus the shared ripple; no bespoke transform.
 *
 * `passive` is the copy that rides along on a hero flight: still clickable, so a
 * tap during the flight still turns it around, but out of the tab order, out of
 * the accessibility tree and without a ripple of its own, because the real one
 * is mounted at the same time. Without this, two focusable 返回图片列表 buttons
 * sit in the tab order for the length of every flight.
 *
 * **It never takes focus either, not even from a press.** A mouse press focused
 * it — a node inside an `aria-hidden` subtree — and when the copy unmounted at
 * the handoff, focus fell to `<body>` (R10-016). The press's default is what
 * moves focus, so the copy cancels it and keeps the click.
 */
const DetailBack = forwardRef<HTMLButtonElement, DetailBackProps>(function DetailBack(
  {
    passive = false,
    className = '',
    title = '返回图库 (Esc)',
    tabIndex,
    onMouseDown,
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
      onMouseDown={(event) => {
        if (passive) event.preventDefault();
        onMouseDown?.(event);
      }}
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
