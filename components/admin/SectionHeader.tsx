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
 * The admin console's panel header: composes `SectionHeading` (which owns the
 * type role, the tinted icon cell and the subtitle) plus the console-specific
 * refresh affordance. Pass a bare glyph — it is tinted on arrival.
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
      icon={<span className="text-primary-ink [&>svg]:block">{icon}</span>}
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
