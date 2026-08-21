'use client';

import type { ReactNode } from 'react';

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
   * Rendered beside the box, inside the same `<label>` — which is what makes it the
   * control's accessible name rather than text that happens to sit next to it.
   *
   * It exists because two call sites had written the pattern by hand and got it
   * wrong in the same way: a `<span>` beside the checkbox, an `aria-label` on the
   * checkbox saying something *different* from that span, and `cursor-pointer` on
   * the wrapper. So the visible words were not the accessible name, screen readers
   * announced one thing while the eye read another, and clicking the text — which
   * the cursor promised would work — did nothing.
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
 * one, and this had none — so hover and focus were reported by a border colour
 * change alone, on an 18px box. That was the smallest hover affordance in the app
 * on one of its most-used controls, and it is why a checkbox felt inert next to a
 * button that lights up under the pointer.
 *
 * It is a real element rather than the `state-layer` utility, for the same reason
 * `ToggleSwitch`'s is: that utility keys on the element's own `:hover` and paints
 * an overlay the size of that element, and what has to light up here is a circle
 * more than twice the width of the box, driven by a hover anywhere on the label.
 *
 * The box is 18dp, the spec's; it was 20, which is a round number near the right
 * size. The unselected outline is `on-surface-variant`, also the spec's; it was
 * `outline` — a *boundary* role, built for a rule or a text-field border and
 * specified to the 3:1 a non-text element needs, being asked here to carry state.
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
  return (
    /* `touch-target` because the label *is* the whole hit area: the input is
       `sr-only` and everything painted is `pointer-events-none`, so the control
       was an 18px target — under M3's 48dp, under WCAG 2.5.8's 24px floor, on its
       most-used form control. The utility expands the hit area without changing
       the box, which is what keeps the row heights it sits in unchanged. Safe
       here because there is no `data-ripple` to clip it. */
    <label
      className={`group ${label ? 'inline-flex items-center gap-2' : ''} cursor-pointer ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
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
        className={`spring-fast-effects pointer-events-none absolute size-10 rounded-full bg-current opacity-0 transition-opacity ${
          checked ? 'text-primary' : 'text-on-surface'
        } ${
          disabled
            ? ''
            : 'group-hover:opacity-[var(--md-sys-state-hover-opacity)] group-active:opacity-[var(--md-sys-state-pressed-opacity)] peer-focus-visible:opacity-[var(--md-sys-state-focus-opacity)]'
        }`}
      />

      {/* `rounded-xs` (4dp): the shape table gives a 12dp step to cards and
          section surfaces, and at 12dp on an 18px box this read as a radio button
          rather than a checkbox. M3 specs the extra-small corner here.

          `peer-focus-visible:focus-ring`, not `peer-focus-ring`: a Tailwind
          variant needs the colon. Without it the string is not a utility at all,
          emits nothing, and the 2px ring fell back to `currentColor` — taking the
          colour of whatever text happened to surround the control, which is the
          exact failure the `focus-ring` utility was added to end. */}
      <span
        aria-hidden="true"
        className={`peer-focus-visible:focus-ring transition-ui pointer-events-none relative size-4.5 rounded-xs border-2 peer-focus-visible:ring-2 ${
          checked
            ? 'bg-primary border-primary animate-control-pop'
            : /* Transparent, which is `Checkbox.kt`'s `uncheckedBoxColor =
                 Color.Transparent` — `CheckboxTokens` defines no unselected
                 container at all, because an unchecked box is an outline and
                 nothing else. It used to be `bg-surface-raised`, a house token
                 defined as a raw `#ffffff`, so an unchecked box was an opaque white
                 plate over whatever surface it landed on: visible as a seam on
                 every container step darker than the page, and wrong by
                 construction on a photograph. */
              'border-on-surface-variant bg-transparent'
        }`}
      />
      <svg
        className="text-on-primary pointer-events-none absolute size-3"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2.5 6L5 8.5L9.5 3.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10.5"
          strokeDashoffset={checked ? 0 : 10.5}
          /* An *effects* spring, not a spatial one: this is a mark being drawn,
             so it must not overshoot — a dash offset that overshoots draws past
             the end of the path and then retracts. The 80ms delay holds the
             stroke until the container's pop has finished, so the two read as one
             gesture rather than as a race. */
          className="spring-fast-effects transition-[stroke-dashoffset]"
          style={{ transitionDelay: checked ? '80ms' : '0ms' }}
        />
      </svg>
      </span>
      {/* `label-l`, matching `Radio` and `ToggleSwitch`. The three selection controls
          had two answers for one object — this one was `body-m` (400) against their
          `label-l` (500) — so a form holding a checkbox and a switch set the same kind
          of text two ways. A control's label is a label. */}
      {label && <span className="text-label-l text-on-surface">{label}</span>}
    </label>
  );
}
