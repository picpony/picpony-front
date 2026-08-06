'use client';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  /**
   * The control's accessible name. Required in practice: the wrapping `<label>`
   * holds only the painted box and the tick, so without this the checkbox is
   * announced as unlabelled. Declared explicitly because TypeScript does not
   * check hyphenated JSX attributes — passing `aria-label` to a component that
   * does not forward it compiles cleanly and silently does nothing.
   */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  disabled?: boolean;
}

/** Checkbox whose check mark draws itself in (stroke-dashoffset). */
export default function Checkbox({
  checked,
  onChange,
  className = '',
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: CheckboxProps) {
  return (
    <label
      className={`relative flex items-center justify-center w-5 h-5 shrink-0 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div
        className={`w-5 h-5 rounded-md border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 transition-ui pointer-events-none ${
          checked
            ? 'bg-primary border-primary animate-[control-pop_0.25s_var(--ease-spring)]'
            : 'bg-surface-raised border-outline'
        }`}
      />
      <svg
        className="text-on-primary pointer-events-none absolute h-3.5 w-3.5"
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
          className="transition-[stroke-dashoffset] duration-300 ease-[var(--ease-decelerate)]"
          style={{ transitionDelay: checked ? '80ms' : '0ms' }}
        />
      </svg>
    </label>
  );
}
