'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import Reveal from './Reveal';
import { cn } from '@/lib/utils';

export type StatusViewSize = 'page' | 'pane' | 'inline';

interface StatusViewProps {
  /** Glyph above the title. Size it 48 for `page`/`pane`, 32 for `inline`. */
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
   * `page`'s own floor is half the viewport, which is right for an empty list sitting
   * under a page header — the block lands near the optical centre of what is left. It
   * is wrong for a screen whose only content is this block, because then "half the
   * viewport" puts the sentence in the upper third with nothing under it. Four screens
   * are that case and nothing else is: the 404, the route error boundary,
   * `/derpi/user/[id]`'s failure (whose `PageBack` portals out to a slot beside the
   * scroller, so it takes no space here), and the image detail's failure in both of its
   * presentations. A list's empty state must **not** set this, or the page grows past the
   * viewport and the scroller gains a bar with nothing to scroll to.
   *
   * It also *replaces* the size's floor rather than adding to it — see `FILL_BOX`.
   */
  fill?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The one layout for "there is nothing here", whatever the reason.
 *
 * Empty and failed were two separate families with two separate silhouettes.
 * `ErrorRetry` centred a 48px glyph over `title-l` at half the viewport and faded
 * in through `Reveal`; the fourteen empty states did not agree with it or with
 * each other — `text-title-m` on /history and /user, `text-body-m` in the
 * messages contact list, bare `text-on-surface-variant` in a forum thread, and
 * six different minimum heights (32/40/48/50/60vh plus `py-20`). Two of them had
 * no glyph at all, so the page simply looked like it had failed to render.
 *
 * They are the same component. The user does not care whether the list is empty
 * because they have collected nothing or because the request failed — both are a
 * screen with a sentence in the middle of it, and the only thing that should
 * differ is the sentence and the glyph. So this owns the geometry and the
 * entrance, and `EmptyState` / `ErrorRetry` are the two presets over it.
 *
 * Sizes, because the same block has to work in three enclosures:
 *
 *   page    a whole route with nothing on it. Half the viewport, so the
 *           sentence lands near the optical centre rather than under the header.
 *   pane    inside a tab pane or a card that already has chrome above it.
 *           A `page`-sized block here pushes the tab bar off a phone screen.
 *   inline  inside a small box — a contact list, a tag well. No minimum at all;
 *           anything else makes a 120px well scroll.
 *
 * The entrance is `Reveal`, i.e. the same staggered rise every other
 * arriving-on-mount block in the app uses. It is deliberately *not* a
 * ScrollTrigger: an empty state is on screen at commit by definition, so
 * `useScrollReveal` would never fire.
 */
const SIZES: Record<StatusViewSize, string> = {
  page: 'min-h-[50dvh] px-4 py-8',
  pane: 'min-h-[32dvh] px-4 py-8',
  inline: 'px-4 py-10',
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

  /* The entrance stands down inside a tab pane, and this is the fix for a rule the
     app documents and then broke everywhere.
     `Reveal` is a mount-time cascade. A pane transition (`playSharedAxis`, 500ms
     `emphasized`) is already animating these very nodes' `autoAlpha` and `y`, so an
     empty state inside a swapping pane ran both at once — two clocks on one subtree,
     which is exactly the case AGENTS.md names as forbidden ("inside any tab pane
     whose content swaps — /user/[id], /messages, /favorites, the home route"). Those
     four screens reach `Reveal` through *this* component, unconditionally, which is
     why the rule was violated on every one of them while no call site looked wrong.
     Detected rather than passed as a prop: a status view does not know, and should
     not have to know, what it was rendered into. `[data-tab-pane]` is the marker
     `TabPanes` puts on every pane, so "is this inside a pane" is answerable
     from the DOM. `useLayoutEffect` so the answer is known before the first paint —
     `Reveal` sets its own start state on mount, and learning this a frame later
     would mean the cascade had already begun. */
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
      {/* 24px, not 48. It read 48px, which under a 48px glyph put **96px** above the
          title and made the block so top-heavy that its optical centre sat well below its
          geometric one — a geometrically centred block then reads as sitting high, which is
          most of why these screens looked mis-centred even where the arithmetic was right.
          M3 specifies nothing here; 24 is the grid step that keeps the glyph reading as part
          of the same object as the sentence. */}
      {icon && <span className="text-outline mb-6 [&>svg]:block">{icon}</span>}
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
     disagree about where they are. `Reveal` staggers its *direct children*, which is
     why the body is a fragment rather than a wrapper: nesting it in a div would
     collapse the cascade into one block.
     `fill` is `flex-1` on both nodes, not a percentage height, and that is the whole
     trick: the shell is `Reveal`'s own div, and `min-height: 100%` there resolved
     against a parent whose height comes from flex distribution — indefinite, so it
     computed to `auto` and centred nothing. `flex-1` needs no definite parent. It does
     need the page-content wrapper to be a flex column, which is why that is one. */
  return (
    <div ref={hostRef} className={cn(fill && 'flex flex-1 flex-col', inPane && shell)}>
      {inPane ? body : <Reveal className={cn(shell, fill && 'flex-1')}>{body}</Reveal>}
    </div>
  );
}
