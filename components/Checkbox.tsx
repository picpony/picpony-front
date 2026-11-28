'use client';

import { useRef, useState, type ReactNode } from 'react';
import { startCenteredRipple } from '@/lib/ripple';
import { cn } from '@/lib/utils';

import { CHECK_SNAP_DELAY_MS } from '@/lib/motionTokens';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const rippleHostRef = useRef<HTMLSpanElement>(null);
  if (checked !== seen) {
    setSeen(checked);
    setJustChecked(checked);
  }
  return (
    /* `touch-target` because the label *is* the whole hit area: the input is
       `sr-only` and everything painted is `pointer-events-none`, leaving an 18px
       target on the app's most-used form control. The utility expands the hit
       area without changing the box (keeping the row heights it sits in
       unchanged); the press wave clips inside its own 40dp sibling circle instead. */
    <label
      data-ripple-own=""
      onPointerDown={(event) => {
        if (disabled) return;
        startCenteredRipple(event.nativeEvent, rippleHostRef.current, () =>
          Boolean(inputRef.current?.matches(':disabled')),
        );
      }}
      className={cn(
        'group/checkbox inline-flex min-w-0 max-w-full items-center gap-3 select-none touch-manipulation',
        Boolean(label) && 'touch-target pointer-coarse:min-h-12',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
        className,
      )}
    >
      <span className={cn('relative flex size-4.5 shrink-0 items-center justify-center', !label && 'touch-target')}>
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />

        {/* The 40dp state-layer and press-wave circle (same structure as `ToggleSwitch`): a single
          clipped, isolated host holding the tint layer inside it, so hover/focus/press share one
          circle without clipping `touch-target` on the parent wrapper. The box itself fills with
          `primary-ink` when checked, so the centred press wave carries `ripple-primary`. */}
        <span
          ref={rippleHostRef}
          aria-hidden="true"
          className={`ripple-primary pointer-events-none absolute isolate size-10 overflow-hidden rounded-full ${
            checked ? 'text-primary-ink' : 'text-on-surface'
          }`}
        >
          <span
            className={`absolute inset-0 rounded-full bg-current opacity-0 transition-opacity spring-fast-effects ${
              disabled
                ? ''
                : 'group-hover/checkbox:opacity-[var(--md-sys-state-hover-opacity)] no-motion:group-active/checkbox:opacity-[var(--md-sys-state-pressed-opacity)] group-has-[:focus-visible]/checkbox:opacity-[var(--md-sys-state-focus-opacity)]'
            }`}
          />
        </span>

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
          className={`peer-focus-visible:focus-ring peer-focus-visible:outline-hidden forced-colors:peer-focus-visible:outline-solid forced-colors:peer-focus-visible:outline-2 forced-colors:peer-focus-visible:outline-offset-2 forced-colors:peer-focus-visible:outline-[color:Highlight] ${
            /* `Checkbox.kt`'s `colorAnimationSpecForState`: the box fills on DefaultEffects ("box
             in") and empties on FastEffects ("box out"). */
            checked ? 'spring-default-effects' : 'spring-fast-effects'
          } transition-[background-color,border-color,box-shadow] pointer-events-none relative size-4.5 rounded-xs border-2 peer-focus-visible:ring-2 ${
            checked
              ? cn(
                  'bg-primary-ink border-primary-ink forced-mark forced-colors:border-[color:Highlight]',
                  justChecked && 'animate-control-pop',
                )
              : /* Transparent, which is `Checkbox.kt`'s own `uncheckedBoxColor` —
                 `CheckboxTokens` defines no unselected container at all, because
                 an unchecked box is an outline and nothing else. An opaque box
                 colour here shows as a seam on every container step darker than
                 the page. */
                'border-on-surface-variant bg-transparent'
          }`}
        />
        <CheckGlyph
          className="text-on-primary-ink pointer-events-none absolute size-3 forced-color-adjust-none forced-colors:text-[color:HighlightText]"
          pathProps={{
            /* Dash L, gap L, then a short dash before the period wraps (L = 10.5, the path is
             10.26): offset L is fully hidden, 0 fully drawn, and a *negative* offset — the
             spatial spring's overshoot — reads the wrapped dash, so the tick stays fully drawn
             instead of opening a gap at its start. That is Compose's own clamp: it draws
             `getSegment(0, length × fraction)`, and a fraction past 1 is simply the whole path. */
            strokeDasharray: '10.5 10.5 1 0',
            strokeDashoffset: checked ? 0 : 10.5,
            /* `Checkbox.kt`'s `checkDrawFraction`: checking draws the mark on **DefaultSpatial**
             from the same frame as the box; unchecking **snaps** after `SnapAnimationDelay`
             (100ms) while the box empties on FastEffects. */
            className: checked
              ? 'spring-default-spatial transition-[stroke-dashoffset]'
              : 'transition-[stroke-dashoffset]',
            style: checked
              ? undefined
              : {
                  transitionDuration: '0s',
                  transitionDelay: `calc(${CHECK_SNAP_DELAY_MS}ms * var(--motion-scale))`,
                },
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
