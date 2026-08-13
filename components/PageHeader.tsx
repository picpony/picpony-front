import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** The screen's name. Rendered as the route's single `<h1>`. */
  title: ReactNode;
  /** One line of explanation under it. Optional — most screens need none. */
  subtitle?: ReactNode;
  /** Trailing controls on the title's baseline (a 发帖 button, a filter). */
  actions?: ReactNode;
  className?: string;
}

/**
 * The one page header.
 *
 * Fourteen routes each invented their own before this existed, in six
 * treatments: `text-headline-s` on eight of them, `text-title-l` on `/tasks` and
 * `/upload`, an `<h2 class="text-title-m-emphasized">` on `/block-groups` (two
 * type steps down and the wrong document level), an `<h2>` *inside a pane* on the
 * home route's forum tab — so `/` had no `<h1>` at all — nothing whatsoever on
 * `/search`, and a banner-plus-name on both profiles. Two of the fourteen had a
 * subtitle. Several carried a `flex items-center gap-2` left over from an icon
 * that had been removed, and one an orphan leading space in its class string.
 *
 * `headline-s` is the size, because that is what eight of the fourteen already
 * were and it is the M3 role for a screen title at this window size. The bottom
 * margin lives here too: it was `mb-6` on six screens, `mb-8` on one, `mb-4` on
 * another and absent on three, which is why the gap between a title and the
 * content under it was different on almost every screen.
 *
 * The back affordance is deliberately *not* a prop. `PageBack` portals itself
 * into the shell's slot so it survives the route transition sitting still; taking
 * it as a child here would put it back inside `[data-page-content]`, which is the
 * thing that made it fly a full window out and back. Render `PageBack` alongside
 * this component, not inside it.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      <div className={cn('flex items-center justify-between', actions ? 'gap-4' : undefined)}>
        <h1 className="text-headline-s min-w-0 text-on-surface">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {subtitle && <p className="text-body-m mt-1 text-on-surface-variant">{subtitle}</p>}
    </div>
  );
}
