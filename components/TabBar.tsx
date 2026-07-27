'use client';

import { ReactNode } from 'react';
import { useSlidingIndicator } from '@/lib/motion';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Count rendered as a red pill after the label; 0 hides it. */
  badge?: number;
}

interface TabBarProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Re-measure the indicator when the tab list mounts late (e.g. after fetch). */
  deps?: unknown[];
}

/**
 * Underlined tab row whose indicator glides between tabs. Shared by the
 * favorites, messages and admin surfaces so they animate identically.
 */
export default function TabBar<T extends string = string>({
  tabs,
  value,
  onChange,
  className = '',
  deps = [],
}: TabBarProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator(value, deps);

  return (
    <div className={`border-b border-slate-200 dark:border-slate-700 ${className}`}>
      <div ref={containerRef} className="relative flex gap-0">
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-0.5 rounded-full bg-primary"
        />
        {tabs.map(tab => (
          <button
            key={tab.value}
            data-tab={tab.value}
            data-ripple
            role="tab"
            aria-selected={value === tab.value}
            onClick={() => onChange(tab.value)}
            className={`relative flex items-center gap-1 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors duration-200 ${
              value === tab.value
                ? 'text-primary'
                : 'text-[var(--sidebar-text)] hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
            {!!tab.badge && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white animate-[control-pop_0.3s_var(--ease-spring)]">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
