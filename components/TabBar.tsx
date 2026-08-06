'use client';

import { ReactNode } from 'react';
import { useSlidingIndicator } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Count rendered as a pill after the label; 0 hides it. */
  badge?: number;
}

interface TabBarProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Re-measure the indicator when the tab list mounts late (e.g. after fetch). */
  deps?: unknown[];
  /** Accessible name for the tab list. */
  label?: string;
}

/**
 * Underlined tab row whose indicator glides between tabs.
 *
 * The row scrolls horizontally rather than wrapping: several tab sets here are
 * four Chinese labels wide plus badges, which overflowed a 390px viewport and
 * pushed the indicator's measurement out of sync with what was visible.
 */
export default function TabBar<T extends string = string>({
  tabs,
  value,
  onChange,
  className = '',
  deps = [],
  label = '标签页',
}: TabBarProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator(value, deps);

  return (
    <div className={cn('border-outline-variant border-b', className)}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        className="scrollbar-hide relative flex gap-0 overflow-x-auto"
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className="bg-primary absolute bottom-0 left-0 h-0.5 rounded-full"
        />
        {tabs.map((tab) => {
          const selected = value === tab.value;
          return (
            <button
              key={tab.value}
              data-tab={tab.value}
              data-ripple
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.value)}
              className={cn(
                'relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md px-4 py-3',
                'text-label-l outline-none transition-ui',
                'focus-visible:ring-2 focus-visible:ring-primary/40',
                selected
                  ? 'text-primary font-medium'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              {tab.label}
              {!!tab.badge && (
                <span className="bg-error-fill text-on-fill text-label-s-emphasized leading-none tabular-nums flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 animate-[control-pop_0.3s_var(--ease-spring)]">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
