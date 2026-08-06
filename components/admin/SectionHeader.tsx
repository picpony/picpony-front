'use client';

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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-title-l text-on-surface flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="text-body-m text-on-surface-variant mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {onRefresh && (
          <RefreshButton onClick={onRefresh} label={refreshLabel} loading={isLoading} />
        )}
      </div>
    </div>
  );
}
