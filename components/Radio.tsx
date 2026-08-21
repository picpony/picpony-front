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
   * The label's ink, as a role rather than as a class. It was `labelClassName`, a
   * free-form string — which is the same hole `Button` closed with
   * `variant="danger"`: ink is a decision the system makes, and a `className` lets
   * a call site pick any colour, including one that is not a token. Both existing
   * call sites were naming a *semantic* (a destructive choice, a cautionary one),
   * which is exactly what a union can express.
   */
  tone?: 'neutral' | 'error' | 'warning';
  'aria-label'?: string;
}

/**
 * M3's radio button, as a primitive.
 *
 * There was no such thing, so four places shipped the browser's own: an
 * unstyled `<input type="radio">`, which is UA chrome. It paints in the
 * platform accent (blue on Chrome, whatever the OS says on Safari) with no
 * relation to the scheme, ignores the focus ring the rest of the app shares,
 * and is about 13px across — under M3's 48dp touch minimum and under WCAG
 * 2.5.8's 24px floor.
 *
 * Built like `Checkbox`: the real input is `sr-only` so the platform keeps
 * grouping, arrow-key navigation and form semantics, and the visible dial is
 * drawn from tokens. `name` is required rather than optional because that is
 * what makes a group a group — two of the four call sites omitted it, which is
 * why their arrow keys did nothing and why both options in `BadgesTab` could be
 * read as separate two-state controls.
 *
 * The dot scales rather than fades: an M3 radio's selection is a *mark landing*,
 * and cross-fading two circles of the same colour reads as a blur. It lands on
 * the expressive fast spatial spring — the one curve in the system with a
 * visible overshoot — because a mark arriving in place is exactly what that
 * spring is for. It used to be `emphasized` at 200ms, which is a curve the spec
 * reserves for a 500ms container transform: squeezed to 200 it spends 40% of its
 * travel in the first 33ms and then crawls, so the dot appeared to arrive and
 * then keep growing.
 *
 * The 40dp state layer is M3's and was missing, exactly as it was on `Checkbox`;
 * see the note there for why it is a real element rather than the `state-layer`
 * utility. The unselected ring is `on-surface-variant` rather than `outline`,
 * also for the reason recorded there.
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
            /* 150ms `standard`, the same clock the `state-layer` utility uses.
               `Checkbox`, `Radio` and `ToggleSwitch` all paint this same 40dp
               circle by hand — the utility keys on the element's own `:hover` and
               the circle has to light from a hover anywhere on the label — so they
               have to agree with it explicitly. `Radio` and `Checkbox` were on a
               108ms spring and `ToggleSwitch` on the 150ms curve: one object, two
               clocks, decided by which file you were looking at. */
            'pointer-events-none absolute size-10 rounded-full bg-current opacity-0 transition-opacity duration-150 ease-[var(--ease-standard)]',
            checked ? 'text-primary' : 'text-on-surface',
            !disabled &&
              'group-hover:opacity-[var(--md-sys-state-hover-opacity)] group-active:opacity-[var(--md-sys-state-pressed-opacity)] peer-focus-visible:opacity-[var(--md-sys-state-focus-opacity)]',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'relative h-5 w-5 rounded-full border-2 transition-ui pointer-events-none',
            'peer-focus-visible:ring-2 peer-focus-visible:focus-ring',
            checked ? 'border-primary' : 'border-on-surface-variant',
          )}
        />
        {/* The dot is 12dp (`RadioButtonDotSize`); it was 10.
            Its two properties run on the two different spring families, which is
            the whole point of there being two — so this needs the arbitrary
            *shorthand*, the one form that can carry a clock per property (the same
            reason `ToggleSwitch`'s handle uses it).
            `scale` may overshoot: that settle is the character of a radio landing.
            `opacity` must not, and this is not a stylistic preference — a `linear()`
            table whose values exceed 1 is *clipped*, so an overshooting fade is not
            a bouncier fade, it is one that reaches full opacity early and then sits
            there. Both ran together on ζ0.6, whose table is above 1 from 45% to 97%
            of the run, so more than half of every radio's fade was a stall. */}
        <span
          aria-hidden="true"
          className={cn(
            'bg-primary pointer-events-none absolute h-3 w-3 rounded-full',
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
