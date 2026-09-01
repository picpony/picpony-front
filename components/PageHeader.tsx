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
 * The one page header: the route's single `<h1>` at `headline-s`, optional
 * subtitle, trailing actions on the title's baseline, fixed bottom margin.
 *
 * The back affordance is deliberately **not** a prop: `PageBack` portals itself
 * into the shell's slot so it survives route transitions sitting still. Render
 * `PageBack` alongside this component, not inside it.
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
