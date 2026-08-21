'use client';

import SectionHeading from '@/components/SectionHeading';
import RefreshButton from './RefreshButton';

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshLabel?: string;
  isLoading?: boolean;
  actions?: React.ReactNode;
}

/**
 * The admin console's panel header.
 *
 * It **composes** `SectionHeading` rather than re-implementing it. It used to write
 * out its own `<h2 className="text-title-l …">`, its own icon cell and its own
 * subtitle paragraph — so the app had two heading components that disagreed on the
 * type role (`title-l` here against `title-m-emphasized` there) and on the name of
 * the heading text (`title` against `children`), and two files imported both and
 * rendered two heading scales at one nesting depth.
 *
 * The icon's colour comes from here too. This component's icon cell carried none, so
 * all eleven call sites named `text-primary` themselves — which is exactly what
 * `SectionHeading`'s docstring says a call site should never have to do again. Pass a
 * bare glyph; it is tinted on arrival.
 *
 * What is left specific to the console is the refresh affordance, which is why this
 * still exists as a thin wrapper rather than being deleted.
 */
export default function SectionHeader({
  icon,
  title,
  subtitle,
  onRefresh,
  refreshLabel,
  isLoading,
  actions,
}: SectionHeaderProps) {
  return (
    <SectionHeading
      as="h2"
      icon={<span className="text-primary [&>svg]:block">{icon}</span>}
      subtitle={subtitle}
      actions={
        <>
          {actions}
          {onRefresh && (
            <RefreshButton onClick={onRefresh} label={refreshLabel} loading={isLoading} />
          )}
        </>
      }
    >
      {title}
    </SectionHeading>
  );
}
