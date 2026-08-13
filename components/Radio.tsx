'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface RadioProps {
  checked: boolean;
  onChange: () => void;
  /** Groups the buttons so arrow keys move between them and only one can be on. */
  name: string;
  value: string;
  /** Rendered beside the dial. Omit and pass `aria-label` for a bare control. */
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Tints the label — a destructive option, a warning option. */
  labelClassName?: string;
  'aria-label'?: string;
}

/**
 * M3's radio button, as a primitive.
 *
 * There was no such thing, so four places shipped the browser's own: an
 * unstyled `<input type="radio">`, which is UA chrome. It paints in the
 * platform accent (blue on Chrome, whatever the OS says on Safari) with no
 * relation to the scheme, ignores the focus ring the rest of the app shares,
 * and is about 13px across — under M3's 48dp target, under WCAG 2.5.8's 24px
 * floor, and under this app's own 44px rule.
 *
 * Built like `Checkbox`: the real input is `sr-only` so the platform keeps
 * grouping, arrow-key navigation and form semantics, and the visible dial is
 * drawn from tokens. `name` is required rather than optional because that is
 * what makes a group a group — two of the four call sites omitted it, which is
 * why their arrow keys did nothing and why both options in `BadgesTab` could be
 * read as separate two-state controls.
 *
 * The dot scales rather than fades: an M3 radio's selection is a *mark landing*,
 * and cross-fading two circles of the same colour reads as a blur.
 */
export default function Radio({
  checked,
  onChange,
  name,
  value,
  label,
  disabled,
  className = '',
  labelClassName = '',
  'aria-label': ariaLabel,
}: RadioProps) {
  return (
    <label
      className={cn(
        'group flex items-center gap-2 select-none',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
        className,
      )}
    >
      {/* `touch-target` on the dial, not on the label: when there is a label the
          whole label is already the hit area, and when there is not, this is the
          only thing to hit. Safe here — no `data-ripple` to clip the overflow. */}
      <span className="touch-target relative flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={onChange}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            'h-5 w-5 rounded-full border-2 transition-ui pointer-events-none',
            'peer-focus-visible:ring-2 peer-focus-visible:focus-ring',
            checked ? 'border-primary' : 'border-outline group-hover:border-on-surface-variant',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'bg-primary pointer-events-none absolute h-2.5 w-2.5 rounded-full',
            'transition-[scale,opacity] duration-200 ease-[var(--ease-emphasized)]',
            checked ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
        />
      </span>
      {label && <span className={cn('text-label-l text-on-surface', labelClassName)}>{label}</span>}
    </label>
  );
}
