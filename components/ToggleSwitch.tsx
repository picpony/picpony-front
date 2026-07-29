'use client';

import { ReactNode } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string | ReactNode;
  description?: string;
  colorClass?: string;
}

/**
 * Material 3 switch: 48×28 track, thumb grows from 16 to 22 px as it slides,
 * swells further while pressed, and reveals a check icon when on.
 */
export default function ToggleSwitch({
  checked, onChange, disabled, label, description, colorClass,
}: ToggleSwitchProps) {
  return (
    <label className={`group flex items-center gap-3 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 rounded-full transition-colors duration-300 ease-[var(--ease-standard)] peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 ${
            checked
              ? 'bg-primary'
              : 'bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-400/70 dark:group-hover:bg-slate-500/80'
          }`}
        >
          <span
            className={`absolute left-[3px] top-[3px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[var(--ease-spring)] ${
              checked
                ? `translate-x-5 ${disabled ? '' : 'group-active:scale-110'}`
                : `scale-[0.72] ${disabled ? '' : 'group-active:scale-90'}`
            }`}
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className={`h-3 w-3 text-primary transition-[opacity,transform] duration-200 ease-[var(--ease-decelerate)] ${
                checked ? 'opacity-100 scale-100 delay-100' : 'opacity-0 scale-50'
              }`}
            >
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </span>
      {label && (
        <div>
          <span className={`text-sm font-medium ${colorClass || 'text-slate-700 dark:text-slate-300'}`}>{label}</span>
          {description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  );
}
