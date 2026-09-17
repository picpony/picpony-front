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
  /**
   * The label's ink, as a role rather than as a class — ink is a decision the
   * system makes, and the two call sites name semantics (destructive, cautionary),
   * which is exactly what a union can express.
   */
  tone?: 'neutral' | 'error' | 'warning';
  'aria-label'?: string;
}

/**
 * M3's radio button, as a primitive.
 *
 * Built like `Checkbox`: the real input is `sr-only` so the platform keeps
 * grouping, arrow-key navigation and form semantics, and the visible dial is
 * drawn from tokens. `name` is required — that is what makes a group a group.
 *
 * The dot scales rather than fades: an M3 radio's selection is a *mark landing*,
 * and it lands on the expressive fast spatial spring — the one curve in the
 * system with a visible overshoot, and the right one for a mark arriving in
 * place.
 *
 * The 40dp state layer is a real element rather than the `state-layer` utility,
 * as on `Checkbox` (see the note there). The unselected ring is
 * `on-surface-variant` rather than `outline`, same reason.
 */
export default function Radio({
  checked,
  onChange,
  name,
  value,
  label,
  disabled,
  className = '',
  tone = 'neutral',
  'aria-label': ariaLabel,
}: RadioProps) {
  return (
    <label
      className={cn(
        'group/radio flex items-center gap-2 select-none',
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
            /* 150ms `standard`, the same clock the `state-layer` utility uses.
               The three selection controls all paint this 40dp circle by hand
               (the utility keys on the element's own `:hover` and the circle has
               to light from a hover anywhere on the label), so they have to
               agree with it explicitly — one object, one clock. */
            'pointer-events-none absolute size-10 rounded-full bg-current opacity-0 transition-opacity duration-state ease-[var(--ease-standard)]',
            checked ? 'text-primary-ink' : 'text-on-surface',
            !disabled &&
              'group-hover/radio:opacity-[var(--md-sys-state-hover-opacity)] group-active/radio:opacity-[var(--md-sys-state-pressed-opacity)] peer-focus-visible:opacity-[var(--md-sys-state-focus-opacity)]',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'relative h-5 w-5 rounded-full border-2 spring-fast-effects transition-[border-color] pointer-events-none',
            'peer-focus-visible:ring-2 peer-focus-visible:focus-ring',
            checked ? 'border-primary-ink' : 'border-on-surface-variant',
          )}
        />
        {/* The dot is 12dp (`RadioButtonDotSize`).
            Its two properties run on two different spring families, which is the
            whole point of there being two — so this needs the arbitrary
            *shorthand*, the one form that can carry a clock per property (the same
            reason `ToggleSwitch`'s handle uses it).
            `scale` may overshoot: that settle is the character of a radio landing.
            `opacity` must not — a `linear()` table whose values exceed 1 is
            *clipped*, so an overshooting fade reaches full opacity early and then
            sits there. Both ran together on ζ0.6, whose table is above 1 for over
            half the run, so more than half of every radio's fade was a stall. */}
        <span
          aria-hidden="true"
          className={cn(
            'bg-primary-ink pointer-events-none absolute h-3 w-3 rounded-full',
            '[transition:scale_var(--duration-spring-expressive-fast-spatial)_var(--ease-spring-expressive-spatial-fast),opacity_var(--duration-spring-fast-effects)_var(--ease-spring-effects)]',
            checked ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
        />
      </span>
      {label && (
        <span
          className={cn(
            'text-label-l',
            tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-on-surface',
          )}
        >
          {label}
        </span>
      )}
    </label>
  );
}
