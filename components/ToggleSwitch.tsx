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

export default function ToggleSwitch({
  checked, onChange, disabled, label, description, colorClass,
}: ToggleSwitchProps) {
  return (
    <label className={`flex items-center gap-3 cursor-pointer ${disabled ? 'opacity-50' : ''}`}>
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 rounded-full peer-checked:bg-primary peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
      </div>
      {label && (
        <div>
          <span className={`text-sm font-medium ${colorClass || 'text-slate-700 dark:text-slate-300'}`}>{label}</span>
          {description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  );
}
