'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { MdArrowBack } from 'react-icons/md';
import IconButton from './IconButton';
import { ICON } from '@/lib/icons';

type DetailBackProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  passive?: boolean;
};

/**
 * Back affordance for the image detail view, and the app's one pinned back control.
 *
 * **It keeps its distance until it is reached for**: the `quiet` variant (`IconButton`) holds a
 * neutral disc at rest — the page's own material, which reads as part of the page rather than as
 * a control sitting on top of the picture — and only under the pointer does it become what the
 * spec has for a leading navigation action over content: a Material 3 **filled tonal icon
 * button**. It takes the *square* shape there deliberately, because the button is pinned just
 * inside the content section's 12dp corner, where a pill reads as something stuck on top of the
 * frame. This is not a concentric pair (at a 16px inset the arithmetic gives 0, and the gap is
 * too large for the corners to read as one curve inside another) — they are neighbours, and 12dp
 * is the shape table's step for a square icon button.
 *
 * A touch screen has no hover, so a finger only ever sees the quiet disc. That is the intent
 * rather than a gap in it: the morph is a reward for a pointer that has committed, and what a
 * finger gets is the form that stays out of the picture's way.
 *
 * Icon-only is the M3 back affordance; the label survives as the accessible name
 * and the tooltip. The container, state layer and elevation step come from
 * `IconButton`; what is left here is the glyph, the wording and `passive`.
 * Motion is the state layer, the container's own transition and the shared
 * ripple; no bespoke transform.
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
      /* Deliberately no `shape`: the 12dp corner is a *state* here and the `quiet` variant owns
         it. Naming one at this call site would also suppress the resting disc — the call site's
         corner outranks the shape axis (`HAS_RADIUS`), which is not what a morph wants. */
      variant="quiet"
      size="md"
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
