'use client';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Checkbox whose check mark draws itself in (stroke-dashoffset). */
export default function Checkbox({ checked, onChange, className = '' }: CheckboxProps) {
  return (
    <label className={`relative flex items-center justify-center w-5 h-5 shrink-0 cursor-pointer ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div
        className={`w-5 h-5 rounded-md border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 transition-all duration-200 ease-[var(--ease-standard)] pointer-events-none ${
          checked
            ? 'bg-primary border-primary animate-[control-pop_0.25s_var(--ease-spring)]'
            : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600'
        }`}
      />
      <svg
        className="absolute w-3.5 h-3.5 text-white pointer-events-none"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2.5 6L5 8.5L9.5 3.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10.5"
          strokeDashoffset={checked ? 0 : 10.5}
          className="transition-[stroke-dashoffset] duration-250 ease-[var(--ease-decelerate)]"
          style={{ transitionDelay: checked ? '80ms' : '0ms' }}
        />
      </svg>
    </label>
  );
}
