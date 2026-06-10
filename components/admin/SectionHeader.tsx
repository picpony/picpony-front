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
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
        )}
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