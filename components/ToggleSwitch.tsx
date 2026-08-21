'use client';

import { ReactNode, useRef, useState } from 'react';
import { spawnRipple } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string | ReactNode;
  description?: string;
  /**
   * `inline` — switch first, then its label, sized to its content. Right inside
   * a form, where the control is read left to right like a checkbox.
   *
   * `row` — label column first, switch trailing at the far edge, full width.
   * This is the M3 list convention and what a settings row is, and it exists
   * because /settings had both at once: its value rows put the label at the
   * left and the control at the right, while its switch rows put the switch at
   * the left and left the right-hand half of the row empty. Two opposite
   * reading orders down one card. `/admin` had already worked around it by
   * writing the label as a sibling `<div>` and passing no `label` at all —
   * which is this layout, hand-rolled, with the description styled differently.
   */
  layout?: 'inline' | 'row';
  /** Needed when `label` is omitted — the wrapping label is then empty. */
  'aria-label'?: string;
}

/* Two motion systems, split the way M3 splits them, and the shorthand form is
   what makes that expressible on one element: the handle's *geometry* is component
   motion and takes a spring, while its *colour* is a recolour and takes a short
   curve. A `transition-[…] duration-…` pair can only carry one clock.

   The numbers used to come from material-web's `md-switch` verbatim — 250ms
   `standard` for the resize, 100ms linear on press, 67ms and 33ms for the fades.
   Those are frame counts from a Lit implementation, not `md.sys.motion` steps: 67
   and 33 are 4 and 2 frames at 60Hz, and neither is on M3's duration scale at all.
   `Switch.kt` says `MotionSchemeKeyTokens.FastSpatial`, so the geometry is ζ0.9
   k1400 (137ms) and the recolours move to the scale's own `short2` (100ms).

   Written as arbitrary properties, these are also the one form the reduced-motion
   enumeration missed for months — see the note at the bottom of globals.css. Both
   bracket shapes are matched now, so the handle stops resizing under the
   preference while its colours keep changing. */

/** Handle geometry: `FastSpatial`, per `Switch.kt`. Colour is not geometry, so it
 *  keeps its own short clock. */
const HANDLE_TRANSITION =
  '[transition:width_var(--duration-spring-fast-spatial)_var(--ease-spring-standard-spatial),height_var(--duration-spring-fast-spatial)_var(--ease-spring-standard-spatial),background-color_100ms_var(--ease-standard)]';
/** Press is contact, so it is the scale's shortest step and linear — a curve on a
 *  100ms squash is a shape nobody can see. Applied only while the press is held; the
 *  release falls back to the base spring above, which is the same `FastSpatial` the
 *  travel runs on, so the two land together. */
const PRESSED_HANDLE_TRANSITION =
  '[transition:width_100ms_linear,height_100ms_linear,background-color_100ms_var(--ease-standard)]';
/** The check crosses while the handle is still travelling, so it takes the fastest
 *  *effects* spring (ζ1.0 k3800, 108ms) rather than a hand-counted 33ms. */
const ICON_TRANSITION = '[transition:opacity_var(--duration-spring-fast-effects)_var(--ease-spring-effects)]';
/** Track and outline recolour together with the handle, on the same short step. */
const TRACK_TRANSITION =
  '[transition:background-color_100ms_var(--ease-standard),border-color_100ms_var(--ease-standard)]';

/**
 * Material 3 switch, at the spec's own numbers (material-web `md-switch`,
 * token set v0.192):
 *
 * | | |
 * |---|---|
 * | track | 52 × 32, `corner-full`, 2dp `outline` border while unselected |
 * | handle | **16dp** unselected, **24dp** selected, 28dp while pressed |
 * | state layer | 40dp circle centred on the handle |
 * | travel | 20dp, i.e. `track-width − track-height` |
 *
 * This is the spec's `selected-icon` variant: a check on the selected state and
 * nothing on the unselected one. The cross with it — material-web's `icons`
 * mode — reads as an assertion that the thing is *off* rather than simply not
 * on, which is a second piece of information a switch does not carry; M3 gives
 * the plain switch an empty handle and lets position and colour say it. The
 * unselected handle is then the plain switch's 16dp, because nothing has to fit
 * inside it, and the size difference between the two states becomes part of how
 * the control reads.
 *
 * That resize is why the handle needs the spec's two clocks: 250ms standard for
 * a state change, 100ms linear while pressed. The earlier `icons` build kept a
 * 24dp handle in both states, so it could collapse those into one 90ms linear
 * clock — with the sizes now differing, that shortcut would run the state
 * change at press speed.
 *
 * The 40dp state layer is wider *and* taller than the track and is meant to
 * bleed past it — that overhang is what the press reads as. Nothing in the
 * chain may clip it.
 *
 * The handle grows about its own centre, so its centre only ever sits at one
 * of two x positions and the travel is a plain ±10px `translate` on the
 * shell. The spec animates `margin-inline` on a handle-sized container
 * instead; centred in a flex track the two are algebraically the same, and
 * translate does not relayout.
 *
 * One deliberate divergence:
 *
 * - **No overshoot.** The spec's travel is
 *   `300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)` — the tail of that curve
 *   *is* the rebound, and it was removed on request. 300ms with the bounce
 *   taken out reads as sluggish, because the overshoot curve is already at the
 *   target by ~120ms. 200ms on `--ease-standard` arrives at the same moment
 *   and settles dead.
 *
 * And one palette note: the spec paints the selected icon
 * `on-primary-container`, which assumes that token flips with the scheme. This
 * palette deliberately holds `primary`/`on-primary` constant across schemes, so
 * `on-primary-container` would be pale pink on a white handle in the dark one.
 * The check stays `primary`.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  description,
  layout = 'inline',
  'aria-label': ariaLabel,
}: ToggleSwitchProps) {
  const stateLayerRef = useRef<HTMLSpanElement>(null);
  const isRow = layout === 'row';
  /**
   * The press state, driven by pointer events rather than by CSS `:active`.
   *
   * AOSP reads it from the `interactionSource` — an event stream — and that is the
   * difference that matters here rather than a token. `:active` is the browser's, and
   * on a touch screen the browser holds it past the release: Chrome delays applying it
   * so a scroll does not flash every control it passes, then keeps it for a minimum
   * visible period. The result on a tap was the handle still at its 28dp pressed width
   * *after* it had finished travelling to the other end — the grip cue outliving the
   * grip, which is the one thing it must not do. Off a real `pointerup` the shrink and
   * the travel start in the same frame and, both being `FastSpatial`, land together.
   *
   * `pointercancel` and `pointerleave` are not optional: a press that turns into a
   * scroll never sends `pointerup`, and without them the handle stays swollen until the
   * next interaction.
   */
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);

  return (
    <label
      /* `flex-row-reverse` plus `justify-between`, not a reordered DOM: the
         switch has to stay the first focusable node in the label so a click on
         the text still lands on the input it labels, while the eye reads
         label-then-control like every other row in the list. */
      className={cn(
        'group flex select-none',
        isRow ? 'w-full flex-row-reverse items-center justify-between gap-4' : 'items-center gap-3',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
      )}
    >
      <span className="group/switch relative inline-flex shrink-0 items-center">
        {/* The hit target, per the spec: the input itself, stretched over the
            whole control at the 48dp touch size and made transparent. It is
            absolutely positioned, so it buys that target without adding the
            16px of row height the spec's own `margin` version would.

            It also has to be the top-most node, which is why the ripple is
            spawned by hand here instead of by `<RippleLayer />`: with the
            input over everything, no press ever lands inside the circle that
            owns the wave. */}
        <input
          type="checkbox"
          /* `role="switch"`, which this did not have. A checkbox and a switch are
             different controls to a screen reader — the first is announced as
             "checked / not checked" and the second as "on / off" — and the
             difference is not cosmetic: a checkbox stages a change that a form
             submit will apply, while a switch takes effect the moment it moves,
             which is exactly what every one of these does. `switch` is a valid
             role on a checkbox input, so the platform keeps the space-bar
             behaviour and the `checked` state for free. */
          role="switch"
          className="peer absolute top-1/2 left-1/2 z-10 h-12 w-13 -translate-x-1/2 -translate-y-1/2 cursor-[inherit] appearance-none rounded-full outline-none"
          checked={checked}
          disabled={disabled}
          /* Only when the caller gives one. The fallback used to be the literal
             '开关' for any non-string `label`, which is worse than nothing: a
             `ReactNode` label is still inside the wrapping `<label>`, so the input
             already had an accessible name from it — and `aria-label` *overrides*
             that name rather than supplementing it. A switch whose label was
             `<>清理 <code>cache</code></>` announced itself as "开关". */
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.checked)}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onPointerDown={(e) => {
            if (!disabled && e.button === 0) setPressed(true);
            const host = stateLayerRef.current;
            if (!host || e.button !== 0) return;
            // Always from the middle of the circle: the switch's wave reads as
            // the handle pulsing, wherever along the track you pressed.
            const rect = host.getBoundingClientRect();
            spawnRipple(host, rect.width / 2, rect.height / 2);
          }}
        />
        {/* Track */}
        <span
          aria-hidden="true"
          className={`flex h-8 w-13 items-center justify-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:focus-ring ${TRACK_TRANSITION} ${
            checked
              ? 'border-transparent bg-primary'
              : 'border-outline bg-surface-container-highest'
          }`}
        >
          {/* Shell — carries the travel, nothing else. `FastSpatial`, the same
              spring as the handle's resize: the two are one movement, and running
              the travel on a 200ms curve while the resize ran on a 250ms one was
              the switch arriving in two instalments. */}
          <span
            className={`spring-fast-spatial flex items-center justify-center transition-[translate] ${
              checked ? 'translate-x-2.5' : '-translate-x-2.5'
            }`}
          >
            {/* State layer: the 40dp circle that clips the wave. `data-ripple`
                is what gives it `position: relative` + `overflow: hidden`. */}
            <span
              ref={stateLayerRef}
              data-ripple={disabled ? undefined : ''}
              className={`grid h-10 w-10 place-items-center rounded-full ${
                checked ? 'text-primary' : 'text-on-surface'
              }`}
            >
              {/* The tint is its own node rather than the `state-layer`
                  utility: that utility keys on the element's own `:hover`, but
                  a switch lights up from a hover anywhere on the control while
                  the layer itself only covers the part around the handle. */}
              {/* `group-*` rather than plain states, and gated on `disabled`: a
                  disabled switch used to keep lighting its hover layer, because the
                  only thing removed was `data-ripple`. The `state-layer` utility
                  gates itself on `:disabled`; this hand-rolled twin has to do the
                  same by hand. */}
              <span
                className={`absolute inset-0 rounded-full bg-current opacity-0 transition-opacity duration-150 ease-[var(--ease-standard)] ${
                  disabled
                    ? ''
                    : 'group-hover/switch:opacity-[var(--md-sys-state-hover-opacity)] group-has-[:focus-visible]/switch:opacity-[var(--md-sys-state-focus-opacity)] group-active/switch:opacity-[var(--md-sys-state-pressed-opacity)]'
                }`}
              />

              {/* Handle. `z-10` keeps it above the ripple, which the global
                  RippleLayer appends after it.
                  The pressed width comes from `pressed` rather than from
                  `group-active/switch:size-7` — see the note on that state. The size
                  classes are spelled per branch so only one `size-*` is ever emitted:
                  `cn` is a plain join and would otherwise leave Tailwind's output order
                  to pick between 28 and 24. */}
              <span
                className={cn(
                  'relative z-10 grid place-items-center rounded-full',
                  HANDLE_TRANSITION,
                  pressed && !disabled
                    ? cn(PRESSED_HANDLE_TRANSITION, 'size-7')
                    : checked
                      ? 'size-6'
                      : 'size-4',
                  checked ? 'bg-on-primary' : 'bg-outline group-hover/switch:bg-on-surface-variant',
                )}
              >
                {/* Only the selected state carries a mark. */}
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                  className={`absolute inset-0 m-auto size-4 text-primary ${ICON_TRANSITION} ${
                    checked ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <path
                    d="M2.5 6L5 8.5L9.5 3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </span>
          </span>
        </span>
      </span>
      {label && (
        <div className={isRow ? 'min-w-0 flex-1' : undefined}>
          {/* No ink prop. `colorClass` was a free-form `className` with zero call
              sites — a switch's label is a switch's label, and if one ever needs a
              semantic it takes a `tone` union like `Radio` does rather than an
              arbitrary string. */}
          <span className="text-label-l text-on-surface">{label}</span>
          {/* `on-surface-variant`, the supporting-text ink role — not `outline`,
              which is a *boundary* role for rules and field borders. */}
          {description && <p className="text-body-s text-on-surface-variant mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  );
}
