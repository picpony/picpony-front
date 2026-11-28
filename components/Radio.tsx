'use client';

import { useRef, type ReactNode } from 'react';
import { startCenteredRipple } from '@/lib/ripple';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const rippleHostRef = useRef<HTMLSpanElement>(null);
  return (
    <label
      data-ripple-own=""
      onPointerDown={(event) => {
        if (disabled) return;
        startCenteredRipple(event.nativeEvent, rippleHostRef.current, () =>
          Boolean(inputRef.current?.matches(':disabled')),
        );
      }}
      className={cn(
        'group/radio inline-flex min-w-0 max-w-full items-center gap-3 select-none touch-manipulation',
        Boolean(label) && 'touch-target pointer-coarse:min-h-12',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
        className,
      )}
    >
      {/* `touch-target` on the dial when bare; with a label the label itself holds the
          coarse-pointer 48dp floor so wrapped rows never overlap hit boxes. */}
      <span
        className={cn(
          'relative flex h-5 w-5 shrink-0 items-center justify-center',
          !label && 'touch-target',
        )}
      >
        <input
          ref={inputRef}
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
          ref={rippleHostRef}
          aria-hidden="true"
          className={cn(
            /* The 40dp state-layer and press-wave circle (same structure as `Checkbox` and
               `ToggleSwitch`), clipped and isolated here so `touch-target` on the parent dial
               stays intact. The dial itself takes `primary-ink` when selected (regardless of
               label tone), so the centred press wave carries `ripple-primary`. */
            'ripple-primary pointer-events-none absolute isolate size-10 overflow-hidden rounded-full',
            checked ? 'text-primary-ink' : 'text-on-surface',
          )}
        >
          <span
            className={cn(
              'absolute inset-0 rounded-full bg-current opacity-0 transition-opacity spring-fast-effects',
              !disabled &&
                'group-hover/radio:opacity-[var(--md-sys-state-hover-opacity)] no-motion:group-active/radio:opacity-[var(--md-sys-state-pressed-opacity)] group-has-[:focus-visible]/radio:opacity-[var(--md-sys-state-focus-opacity)]',
            )}
          />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            /* The ring's colour on DefaultEffects, as `RadioButton.kt`'s `animateColorAsState`. */
            'relative h-5 w-5 rounded-full border-2 spring-default-effects transition-[border-color,box-shadow] pointer-events-none',
            /* The outline half comes back under forced colors, where the ring is not painted. */
            'peer-focus-visible:ring-2 peer-focus-visible:focus-ring peer-focus-visible:outline-hidden forced-colors:peer-focus-visible:outline-solid forced-colors:peer-focus-visible:outline-2 forced-colors:peer-focus-visible:outline-offset-2 forced-colors:peer-focus-visible:outline-[color:Highlight]',
            checked
              ? 'border-primary-ink forced-colors:border-[color:Highlight]'
              : 'border-on-surface-variant',
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
            /* A painted mark, so forced colors repaints it in the system highlight
               rather than flattening it — and the selection with it. */
            'bg-primary-ink pointer-events-none absolute h-3 w-3 rounded-full forced-mark',
            '[transition:scale_var(--duration-spring-fast-spatial)_var(--ease-spring-fast-spatial),opacity_var(--duration-spring-fast-effects)_var(--ease-spring-effects)]',
            checked ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
          )}
        />
      </span>
      {/* `min-w-0 flex-1`, as `Checkbox`'s: a long label truncates inside its row, and a
          label with a trailing part puts it on the row's trailing edge. */}
      {label && (
        <span
          className={cn(
            'min-w-0 flex-1 text-label-l',
            tone === 'error'
              ? 'text-error'
              : tone === 'warning'
                ? 'text-warning'
                : 'text-on-surface',
          )}
        >
          {label}
        </span>
      )}
    </label>
  );
}
