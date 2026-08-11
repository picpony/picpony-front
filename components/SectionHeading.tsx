'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeadingProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** The section's name. */
  children: ReactNode;
  /**
   * Leading glyph. Size it 20–24 and pass nothing else — the colour and the
   * cell come from here, so an icon never has to name `text-primary` again.
   */
  icon?: ReactNode;
  /**
   * Supporting text on the same line — a count, a total. Rendered at `body-m`
   * in the secondary ink, which is what the call sites that had one were each
   * spelling out.
   */
  aside?: ReactNode;
  /** One line of explanation *under* the heading. */
  subtitle?: ReactNode;
  /** Trailing controls, pushed to the far edge. */
  actions?: ReactNode;
  /**
   * The document level. `h2` for a section of a page, `h3` for a section
   * nested inside one that already has an `h2`. The *look* does not change —
   * that is the point of a role — but the outline does, and a screen reader
   * navigates by the outline.
   */
  as?: 'h2' | 'h3';
  className?: string;
}

/**
 * The heading for a section *inside* a page.
 *
 * Three levels of heading existed and only two had a home. `PageHeader` owns
 * the route title (`headline-s`, one `<h1>`), `admin/SectionHeader` owns the
 * admin console's (`title-l`, with a refresh control) — and the one in between,
 * the heading above a card or a list, was written out at seventeen call sites.
 *
 * Which would be survivable if they agreed, and they did not: twelve were
 * `title-m-emphasized` (700) and five were plain `title-m` (500), so 运营团队
 * on /about and 全部回复 on a forum thread — the same object, one screen apart —
 * were two different weights. 700 wins here because it is what the majority
 * already were, including the one call site that had noticed the repetition and
 * hoisted a local `sectionTitle` constant in /settings.
 *
 * The bottom margin disagreed too — 2, 3, 4, 6 and none — which is the same
 * spread `PageHeader` was written to end one level up.
 *
 * **The margin is therefore conditional, and that is a correctness fix rather
 * than a trick** — the same one `Skeleton` makes for its radius, for the same
 * reason. `cn` is a plain join and does not resolve Tailwind conflicts, so a
 * caller passing `mb-2` alongside a baked-in `mb-4` emits both and lets
 * stylesheet order decide which applies. Some enclosures genuinely differ (a
 * heading sharing a flex row with a 发帖 button wants none), so the default
 * stands down when the call site names its own.
 */
const HAS_MARGIN_BOTTOM = /(?:^|\s)-?mb-/;

export default function SectionHeading({
  children,
  icon,
  aside,
  subtitle,
  actions,
  as: Tag = 'h2',
  className = '',
  ...rest
}: SectionHeadingProps) {
  const spacing = cn(!HAS_MARGIN_BOTTOM.test(className) && 'mb-4', className);
  /* With actions or a subtitle there is a wrapper below and it owns the
     spacing; otherwise the heading itself is the outermost element. */
  const wrapped = Boolean(actions || subtitle);

  const heading = (
    <Tag
      className={cn(
        'text-title-m-emphasized text-on-surface flex min-w-0 items-center gap-2',
        !wrapped && spacing,
      )}
      {...(wrapped ? undefined : rest)}
    >
      {icon && (
        /* A fixed, centred cell rather than a bare glyph. An inline <svg> sits
           on the text baseline and inherits the line box, so each icon lands a
           fraction low and by a different amount per glyph — the same fix the
           sidebar's nav rows make. */
        <span
          className="text-primary grid shrink-0 place-items-center [&>svg]:block"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0">{children}</span>
      {aside && <span className="text-body-m text-on-surface-variant shrink-0">{aside}</span>}
    </Tag>
  );

  /* Nothing but the heading: it is already the outermost element. Wrapping it
     anyway would insert a block with no content of its own into the column's
     `space-y-*` rhythm. */
  if (!wrapped) return heading;

  return (
    <div className={spacing} {...rest}>
      <div className={cn('flex items-center justify-between', actions && 'gap-4')}>
        <div className="min-w-0">
          {heading}
          {subtitle && (
            <p className="text-body-m text-on-surface-variant mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
