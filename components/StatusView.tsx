'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import Reveal from './Reveal';
import { cn } from '@/lib/utils';

export type StatusViewSize = 'page' | 'pane' | 'inline';

interface StatusViewProps {
  /** Glyph above the title. Size it 48 for `page`/`pane`; `inline` draws none by default. */
  icon?: ReactNode;
  title: string;
  /** Supporting line. Kept to one short sentence — this is not a place to explain. */
  description?: ReactNode;
  /** One action at most. A screen with nothing on it should offer one way out. */
  action?: ReactNode;
  size?: StatusViewSize;
  /**
   * This status view **is** the whole route, so fill the scroller and centre in it.
   *
   * `page`'s own floor is half the viewport, right for an empty list under a page
   * header and wrong for a screen whose only content is this block — four screens
   * are that case: the 404, the route error boundary, `/derpi/user/[id]`'s
   * failure, and the image detail's failure in both presentations. A list's empty
   * state must **not** set this, or the scroller gains a bar with nothing to
   * scroll to.
   *
   * It also *replaces* the size's floor rather than adding to it — see `FILL_BOX`.
   */
  fill?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The one layout for "there is nothing here", whatever the reason. Owns the
 * geometry and the entrance; `EmptyState` / `ErrorRetry` are the two presets
 * over it — the user does not care whether a list is empty because it has
 * nothing or because the request failed.
 *
 * Sizes, because the same block has to work in three enclosures: `page` (half
 * the viewport, near the optical centre), `pane` (a tab pane or card with
 * chrome above it), `inline` (a small box — no minimum at all).
 *
 * The entrance is `Reveal`, the same staggered rise as every other
 * arriving-on-mount block. Deliberately not scroll-driven: an empty state is on
 * screen at commit by definition.
 */
const SIZES: Record<StatusViewSize, string> = {
  page: 'min-h-[50dvh] px-4 py-8',
  pane: 'min-h-[32dvh] px-4 py-8',
  /* No minimum and barely any padding: an inline status view is one sentence,
     and a heavier box is itself what makes a 120px well scroll. */
  inline: 'px-4 py-2',
};

/**
 * `fill` brings its own height — `flex-1` — so a `min-height` floor beside it is not a
 * belt-and-braces, it is a competitor, and on a short viewport it wins.
 *
 * That is what kept the failure states reading as "stuck to the top" after `fill` was
 * added. `[data-page-content]` has two in-flow children, the content wrapper *and* the
 * footer (≈190–240px), so `flex-1` divides the space **above the footer**; once that space
 * drops under 50dvh the floor overflows the column and the block lands at the top of the
 * scroller instead of anywhere near the middle. Same padding, no floor.
 */
const FILL_BOX = 'px-4 py-8';

export default function StatusView({
  icon,
  title,
  description,
  action,
  size = 'page',
  fill = false,
  className = '',
  children,
}: StatusViewProps) {
  /* An `<h2>` is right for a route that has nothing on it — it is the only
     heading on the page. It is wrong for a "no tags yet" hint inside a 120px
     well, which is a sentence, not a section. The role follows the enclosure. */
  const inline = size === 'inline';

  /* The entrance stands down inside a tab pane: a pane transition is already
     animating these very nodes' `autoAlpha` and `y`, and two clocks on one
     subtree is the case the motion rules name as forbidden. Detected rather
     than passed as a prop — a status view does not know, and should not have to
     know, what it was rendered into. `[data-tab-pane]` is the marker `TabPanes`
     puts on every pane. `useLayoutEffect` so the answer is known before the
     first paint (`Reveal` sets its own start state on mount). */
  const hostRef = useRef<HTMLDivElement>(null);
  const [inPane, setInPane] = useState(false);
  useLayoutEffect(() => {
    setInPane(Boolean(hostRef.current?.closest('[data-tab-pane]')));
  }, []);

  const body = (
    <>
      {/* Each of these is a direct child of `Reveal`, which staggers its own
          children — nesting them in a wrapper would collapse the cascade into
          one block, which is the thing the stagger exists to avoid. */}
      {/* 24px, not 48: under a 48px glyph, 48px above the title makes the block
          so top-heavy that its optical centre sits well below its geometric one —
          a geometrically centred block then reads as sitting high. 24 is the grid
          step that keeps the glyph reading as part of the same object. */}
      {icon && <span className="text-outline mb-6 flex w-full min-w-0 justify-center [&>svg]:block">{icon}</span>}
      {inline ? (
        <p className="text-body-m text-on-surface-variant">{title}</p>
      ) : (
        <h2 className="text-title-l text-on-surface">{title}</h2>
      )}
      {description && <p className={cn('text-body-m max-w-md', !inline && 'mt-2')}>{description}</p>}
      {/* Margin on the action rather than on the description above it: the
          description is optional, and hanging the gap off it left an action with
          no description sitting flush against the title. */}
      {action && <div className="mt-6">{action}</div>}
      {children}
    </>
  );

  const shell = cn(
    'text-on-surface-variant flex flex-col items-center justify-center text-center',
    fill ? FILL_BOX : SIZES[size],
    className,
  );

  /* The probe's node is the outer wrapper in both branches, so the two cannot
     disagree about where they are. `Reveal` staggers its *direct children*,
     which is why the body is a fragment rather than a wrapper: nesting it in a
     div would collapse the cascade into one block.
     `fill` is `flex-1` on both nodes, not a percentage height — that is the
     whole trick: `min-height: 100%` on the shell resolved against a parent
     whose height comes from flex distribution (indefinite in Chrome) and
     computed to `auto`. `flex-1` needs no definite parent; it does need the
     page-content wrapper to be a flex column.

     **`w-full` on the wrapper** is not decoration. In a block enclosure it
     changes nothing; in a *flex* one it is the difference between a centred
     block and a shrink-to-fit item pinned at the start of the row. /block-groups'
     two tag wells are flex rows, so the empty message sat hard against their
     left edge — and the obvious call-site fix cannot work, because `className`
     lands on the inner shell whose 100% resolves against the already-collapsed
     wrapper. The `inPane` branch is the exception: there the shell *is* this
     element, so call sites passing `flex-1` land on the right box. Do not read
     this as licence to hoist `className` up unconditionally. */
  return (
    <div ref={hostRef} className={cn('w-full', fill && 'flex flex-1 flex-col', inPane && shell)}>
      {inPane ? body : <Reveal className={cn(shell, fill && 'flex-1')}>{body}</Reveal>}
    </div>
  );
}
