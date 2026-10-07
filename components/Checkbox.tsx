'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

import CheckGlyph from './CheckGlyph';

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
  /**
   * Rendered beside the box, inside the same `<label>` — which is what makes it
   * the control's accessible name rather than text that happens to sit next to
   * it. Keep the visible words and the accessible name the same thing.
   */
  label?: ReactNode;
}

/**
 * M3 checkbox: an 18dp box inside a 40dp state layer, inside a 48dp touch target.
 *
 * The check mark draws itself in (`stroke-dashoffset`) rather than appearing,
 * which is what M3 does and what makes the selection read as an act.
 *
 * **The 40dp state layer is not decoration.** M3 gives every selection control
 * one, and hover/focus on this most-used control had been a border colour change
 * on an 18px box. It is a real element rather than the `state-layer` utility, as
 * on `ToggleSwitch`: that utility keys on the element's own `:hover` and paints
 * the element's own box, while what has to light up here is a circle more than
 * twice the box's width, driven by a hover anywhere on the label.
 *
 * The 18dp box and the `on-surface-variant` unselected outline are the spec's.
 *
 * **The pop is for checking, not for appearing.** The box's landing pop plays when it
 * becomes checked while on screen — not when a dialog opens with it already checked,
 * where it was a second entrance on top of the dialog's own.
 */
export default function Checkbox({
  checked,
  onChange,
  className = '',
  disabled,
  label,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: CheckboxProps) {
  /* The previous value, held in state so the change is seen during render (the
     documented pattern for reacting to a prop change), not an effect a frame late. */
  const [seen, setSeen] = useState(checked);
  const [justChecked, setJustChecked] = useState(false);
  if (checked !== seen) {
    setSeen(checked);
    setJustChecked(checked);
  }
  return (
    /* `touch-target` because the label *is* the whole hit area: the input is
       `sr-only` and everything painted is `pointer-events-none`, leaving an 18px
       target on the app's most-used form control. The utility expands the hit
       area without changing the box (keeping the row heights it sits in
       unchanged) — safe here because there is no `data-ripple` to clip it. */
    <label
      className={cn(
        'group/checkbox inline-flex items-center gap-2 select-none',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
        className,
      )}
    >
      <span className="touch-target relative flex size-4.5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />

      {/* The state layer, painted from the box's own ink — so it takes the brand
          tint once selected and the neutral one before, which is what the M3
          overlay does. At the shared state opacities, so a checkbox, a button and
          a list row all respond by the same amount. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute size-10 rounded-full bg-current opacity-0 transition-opacity duration-state ease-[var(--ease-standard)] ${
          checked ? 'text-primary-ink' : 'text-on-surface'
        } ${
          disabled
            ? ''
            : 'group-hover/checkbox:opacity-[var(--md-sys-state-hover-opacity)] group-active/checkbox:opacity-[var(--md-sys-state-pressed-opacity)] peer-focus-visible:opacity-[var(--md-sys-state-focus-opacity)]'
        }`}
      />

      {/* `rounded-xs` (4dp), M3's corner for this control — the card step reads
          as a radio button on an 18px box.

          `peer-focus-visible:focus-ring`, not `peer-focus-ring`: a Tailwind
          variant needs the colon. Without it the string matches no utility,
          emits nothing, and the 2px ring falls back to `currentColor`.
          The outline half comes back under forced colors, where the ring is not
          painted; the checked fill is a mark that mode would flatten, so it takes
          the system highlight (and the tick the highlight's own ink). */}
      <span
        aria-hidden="true"
        className={`peer-focus-visible:focus-ring peer-focus-visible:outline-hidden spring-fast-effects transition-[background-color,border-color] pointer-events-none relative size-4.5 rounded-xs border-2 peer-focus-visible:ring-2 ${
          checked
            ? cn('bg-primary-ink border-primary-ink forced-mark forced-colors:border-[color:Highlight]', justChecked && 'animate-control-pop')
            : /* Transparent, which is `Checkbox.kt`'s own `uncheckedBoxColor` —
                 `CheckboxTokens` defines no unselected container at all, because
                 an unchecked box is an outline and nothing else. An opaque box
                 colour here shows as a seam on every container step darker than
                 the page. */
              'border-on-surface-variant bg-transparent'
        }`}
      />
      <CheckGlyph
        className="text-on-primary pointer-events-none absolute size-3 forced-color-adjust-none forced-colors:text-[color:HighlightText]"
        pathProps={{
          strokeDasharray: '10.5',
          strokeDashoffset: checked ? 0 : 10.5,
          /* An *effects* spring, not a spatial one: this is a mark being drawn,
             so it must not overshoot — a dash offset that overshoots draws past
             the end of the path and then retracts. The press step lets the box
             establish itself before the stroke starts; both finish within the
             container's expressive settle. Reading the token also keeps this
             delay in step with the user's motion speed and off preference. */
          className: 'spring-fast-effects transition-[stroke-dashoffset]',
          style: { transitionDelay: checked ? 'var(--transition-duration-press)' : '0ms' },
        }}
      />
      </span>
      {/* `label-l`, matching `Radio` and `ToggleSwitch` — one type role for the
          same object across all three selection controls. A control's label is a
          label. `min-w-0`, or a flex item never shrinks below its content and a long
          label overflows its row instead of truncating — 收藏到…'s long folder names
          ran out of the dialog; `flex-1`, so in a row that spans its container the
          label owns the rest of it and its own trailing part (a count) lands on the
          row's trailing edge. In a control sized to its content it changes nothing. */}
      {label && <span className="min-w-0 flex-1 text-label-l text-on-surface">{label}</span>}
    </label>
  );
}
