import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CollapseProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  open: boolean;
  children: ReactNode;
}

/**
 * A block that opens and closes by its own height on the layout spring, so what follows it glides
 * instead of jumping — the offline banner's arrangement (M1-026: the upload screen's progress row
 * pushed the submit button 68px in a frame). One implementation, because the /search filter form
 * and /upload's two status rows had already copied it.
 *
 * **The mechanism is `grid-template-rows`, not an animated height.** The inner track carries the
 * whole subtree with its overflow clipped, so the content is clipped rather than left behind by a
 * resizing box, and `0fr` measures nothing. The contents fade in on DefaultEffects and out on
 * FastEffects on top of the layout clock (docs/motion.md#surfaces-and-layout).
 *
 * **`grid-cols-1` is `minmax(0, 1fr)`, not `auto`**: without it the track takes the min-content
 * width of what it holds, so a wide child (a table with a minimum width) widened the panel past its
 * row instead of scrolling inside it.
 *
 * Closed, it is inert: out of the tab order and out of the accessibility tree together, rather
 * than focusable inside `aria-hidden`. The clip keeps a 4px margin, so a focused control at the
 * row's edge keeps its whole ring; the caller holds the content while it closes.
 */
export default function Collapse({
  open,
  children,
  className = '',
  inert = false,
  'aria-hidden': ariaHidden,
  ...rest
}: CollapseProps) {
  return (
    <div
      {...rest}
      inert={!open || inert}
      aria-hidden={open ? ariaHidden : true}
      data-open={open}
      className={cn('m3-collapse grid grid-cols-1', className)}
    >
      <div className="min-h-0 min-w-0 overflow-clip [overflow-clip-margin:4px]">{children}</div>
    </div>
  );
}
