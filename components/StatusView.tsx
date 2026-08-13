'use client';

import type { ReactNode } from 'react';
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
  className?: string;
  children?: ReactNode;
}

/**
 * The one layout for "there is nothing here", whatever the reason.
 *
 * Empty and failed were two separate families with two separate silhouettes.
 * `ErrorRetry` centred a 48px glyph over `title-l` at `min-h-[50vh]` and faded
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
  page: 'min-h-[50vh] px-4 py-8',
  pane: 'min-h-[32vh] px-4 py-8',
  inline: 'px-4 py-10',
};

export default function StatusView({
  icon,
  title,
  description,
  action,
  size = 'page',
  className = '',
  children,
}: StatusViewProps) {
  /* An `<h2>` is right for a route that has nothing on it — it is the only
     heading on the page. It is wrong for a "no tags yet" hint inside a 120px
     well, which is a sentence, not a section. The role follows the enclosure. */
  const inline = size === 'inline';

  return (
    <Reveal
      className={cn(
        'text-on-surface-variant flex flex-col items-center justify-center text-center',
        SIZES[size],
        className,
      )}
    >
      {/* Each of these is a direct child of `Reveal`, which staggers its own
          children — nesting them in a wrapper would collapse the cascade into
          one block, which is the thing the stagger exists to avoid. */}
      {icon && <span className="text-outline mb-4 [&>svg]:block">{icon}</span>}
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
    </Reveal>
  );
}
