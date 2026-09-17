'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeadingProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  /** The section's name. */
  children: ReactNode;
  /**
   * Leading glyph. Size it 20–24 and pass nothing else — colour and cell come
   * from here.
   */
  icon?: ReactNode;
  /** Supporting text on the same line — a count, a total. */
  aside?: ReactNode;
  subtitle?: ReactNode;
  /** Trailing controls, pushed to the far edge. */
  actions?: ReactNode;
  /**
   * Document level (`h2` section, `h3` nested section). The look does not
   * change — that is what a role is for — but the outline does, and screen
   * readers navigate by the outline.
   */
  as?: 'h2' | 'h3';
  className?: string;
}

/**
 * The heading for a section *inside* a page (the route title is `PageHeader`'s;
 * the admin console's panel header wraps this one).
 *
 * **The bottom margin is conditional, and that is a correctness fix** — the same
 * one `Skeleton` makes for its radius. `cn` is a plain join and does not resolve
 * Tailwind conflicts, so a caller passing its own bottom margin alongside the
 * baked-in one emits both and lets stylesheet order decide. Some enclosures
 * genuinely differ, so the default stands down when the call site names its own.
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
        'text-title-m-emphasized text-on-surface flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
        !wrapped && spacing,
      )}
      {...(wrapped ? undefined : rest)}
    >
      <span className="flex min-w-0 max-w-full items-center gap-2">
        {icon && (
          /* The glyph stays with its heading when the count wraps below. */
          <span
            className="text-primary-ink grid shrink-0 place-items-center [&>svg]:block"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 wrap-anywhere">{children}</span>
      </span>
      {aside && <span className="text-body-m max-w-full wrap-anywhere text-on-surface-variant">{aside}</span>}
    </Tag>
  );

  /* Nothing but the heading: it is already the outermost element; a wrapper
     would insert an empty block into the column's spacing rhythm. */
  if (!wrapped) return heading;

  return (
    <div className={spacing} {...rest}>
      <div className={cn('flex flex-wrap items-center justify-between', actions && 'gap-x-4 gap-y-3')}>
        <div className="min-w-0 max-w-full">
          {heading}
          {subtitle && (
            <p className="text-body-m wrap-anywhere text-on-surface-variant mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
