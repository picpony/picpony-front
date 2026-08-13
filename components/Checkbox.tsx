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
    /* `touch-target` because the label *is* the whole hit area: the input is
       `sr-only` and both the box and the tick are `pointer-events-none`, so the
       control was a 20px target — under M3's 48dp checkbox target, under WCAG
       2.5.8's 24px floor, and under this app's own 44px rule, on its most-used
       form control. The utility expands the hit area without changing the 20px
       box, which is what keeps the row heights it sits in unchanged. Safe here
       because there is no `data-ripple` to clip it. */
    <label
      className={`touch-target relative flex items-center justify-center w-5 h-5 shrink-0 ${disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer'} ${className}`}
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
      {/* `rounded-xs` (4dp): the shape table gives a 12dp step to cards and
          section surfaces, and at 12dp on a 20px box this read as a radio button
          rather than a checkbox. M3 specs the extra-small corner here.

          `peer-focus-visible:focus-ring`, not `peer-focus-ring`: a Tailwind
          variant needs the colon. Without it the string is not a utility at all,
          emits nothing, and the 2px ring fell back to `currentColor` — taking the
          colour of whatever text happened to surround the control, which is the
          exact failure the `focus-ring` utility was added to end. */}
      <div
        className={`w-5 h-5 rounded-xs border-2 peer-focus-visible:ring-2 peer-focus-visible:focus-ring transition-ui pointer-events-none ${
          checked
            ? 'bg-primary border-primary animate-[control-pop_0.2s_var(--ease-spring)]'
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
