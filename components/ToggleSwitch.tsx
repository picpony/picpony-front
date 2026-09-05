'use client';

import { ReactNode, useRef, useState } from 'react';
import { spawnRipple } from '@/lib/ripple';
import { cn } from '@/lib/utils';

import CheckGlyph from './CheckGlyph';

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
   * This is the M3 list convention and what a settings row is: label at the left,
   * control at the right, one reading order down the card.
   */
  layout?: 'inline' | 'row';
  /** Needed when `label` is omitted — the wrapping label is then empty. */
  'aria-label'?: string;
}

/* Two motion systems, split the way M3 splits them: the handle's *geometry* is
   component motion and takes a spring, while its *colour* is a recolour and takes a
   short curve. A single `transition-[…] duration-…` pair can only carry one clock.
   `Switch.kt` says `FastSpatial` for the geometry; the recolours take the scale's
   `short2` (100ms).

   Written as arbitrary properties, these are the one form the reduced-motion
   enumeration missed for months — see the note at the bottom of globals.css. Both
   bracket shapes are matched now, so the handle stops resizing under the
   preference while its colours keep changing. */

/** Handle geometry: `FastSpatial`, per `Switch.kt`. Colour is not geometry, so it
 *  keeps its own short clock. */
const HANDLE_TRANSITION =
  '[transition:width_var(--duration-spring-fast-spatial)_var(--ease-spring-standard-spatial),height_var(--duration-spring-fast-spatial)_var(--ease-spring-standard-spatial),background-color_var(--transition-duration-press)_var(--ease-standard)]';
/** Press is contact, so it is the scale's shortest step and linear — a curve on a
 *  100ms squash is a shape nobody can see. Applied only while the press is held; the
 *  release falls back to the base spring above, which is the same `FastSpatial` the
 *  travel runs on, so the two land together. */
const PRESSED_HANDLE_TRANSITION =
  '[transition:width_var(--transition-duration-press)_linear,height_var(--transition-duration-press)_linear,background-color_var(--transition-duration-press)_var(--ease-standard)]';
/** The check crosses while the handle is still travelling, so it takes the fastest
 *  *effects* spring (ζ1.0 k3800, 108ms) rather than a hand-counted 33ms. */
const ICON_TRANSITION = '[transition:opacity_var(--duration-spring-fast-effects)_var(--ease-spring-effects)]';
/** Track and outline recolour together with the handle, on the same short step. */
const TRACK_TRANSITION =
  '[transition:background-color_var(--transition-duration-press)_var(--ease-standard),border-color_var(--transition-duration-press)_var(--ease-standard)]';

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
 * The spec's `selected-icon` variant: a check on the selected state, nothing on
 * the unselected one (M3 gives the plain switch an empty handle and lets position
 * and colour say it). That resize is why the handle needs two clocks — a state
 * change and a press cannot share one when the sizes differ.
 *
 * The 40dp state layer is wider and taller than the track and is meant to bleed
 * past it — that overhang is what the press reads as. Nothing in the chain may
 * clip it.
 *
 * The handle grows about its own centre, so the travel is a plain ±10px
 * `translate` on the shell (the spec animates margin on a handle-sized container;
 * centred in a flex track the two are equivalent, and translate does not relayout).
 *
 * One deliberate divergence, **do not "fix"**: no overshoot. The spec's travel
 * curve's tail *is* the rebound, and it was removed on request; 200ms on the
 * standard curve arrives at the same moment and settles dead.
 *
 * And one palette note: the spec paints the selected icon `on-primary-container`,
 * which assumes that token flips with the scheme. This palette deliberately holds
 * `primary`/`on-primary` constant across schemes, so the check stays `primary`.
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
   * The press state, driven by pointer events rather than by CSS `:active` —
   * deliberately, do not simplify. On a touch screen the browser owns `:active`:
   * Chrome delays applying it (so a scroll does not flash every control it passes)
   * and holds it for a minimum period after release. The visible result on a tap
   * was the handle still at its 28dp pressed width *after* it had finished
   * travelling — the grip cue outliving the grip. Off a real `pointerup` the shrink
   * and the travel start in the same frame and, both being the same spring, land
   * together. `pointercancel` and `pointerleave` are part of it, or a press that
   * turns into a scroll leaves the handle swollen.
   */
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);

  return (
    <label
      /* Reversed flex order, not reordered DOM: the switch stays the first
         focusable node in the label so a click on the text still lands on the
         input it labels, while the eye reads label-then-control like every
         other row in the list. */
      className={cn(
        'group flex select-none',
        isRow ? 'w-full flex-row-reverse items-center justify-between gap-4' : 'items-center gap-3',
        disabled ? 'cursor-not-allowed disabled-content' : 'cursor-pointer',
      )}
    >
      <span className="group/switch relative inline-flex shrink-0 items-center">
        {/* The hit target, per the spec: the input itself, stretched over the
            whole control at the 48dp touch size and made transparent.
            Absolutely positioned, so it buys the target without adding row
            height. It must also be the top-most node, which is why the ripple
            is spawned by hand here instead of by `<RippleLayer />`: with the
            input over everything, no press ever lands inside the circle that
            owns the wave. */}
        <input
          type="checkbox"
          /* `role="switch"`, which a bare checkbox lacks: a screen reader announces
             "on / off" rather than "checked / not checked" — and the difference is
             real, since a switch takes effect the moment it moves. A valid role on
             a checkbox input, so space-bar behaviour and `checked` come free. */
          role="switch"
          className="peer absolute top-1/2 left-1/2 z-10 h-12 w-13 -translate-x-1/2 -translate-y-1/2 cursor-[inherit] appearance-none rounded-full outline-none"
          checked={checked}
          disabled={disabled}
          /* Only when the caller gives one. An `aria-label` *overrides* the
             accessible name the wrapping `<label>` already provides — so a
             fallback here would rename labelled switches to a generic word. */
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
          {/* Shell — carries the travel, nothing else. Same spring as the handle's
              resize: the two are one movement, and two clocks read as the switch
              arriving in two instalments. */}
          <span
            className={`spring-fast-spatial flex items-center justify-center transition-[translate] ${
              checked ? 'translate-x-2.5' : '-translate-x-2.5'
            }`}
          >
            {/* State layer: the 40dp circle that clips the wave. `data-ripple`
                gives it `position: relative` + `overflow: hidden`. */}
            <span
              ref={stateLayerRef}
              data-ripple={disabled ? undefined : ''}
              className={`grid h-10 w-10 place-items-center rounded-full ${
                checked ? 'text-primary-ink' : 'text-on-surface'
              }`}
            >
              {/* The tint is its own node rather than the `state-layer` utility:
                  that utility keys on the element's own `:hover`, but a switch
                  lights up from a hover anywhere on the control while the layer
                  itself only covers the part around the handle. */}
              {/* `group-*` rather than plain states, and gated on `disabled`:
                  this hand-rolled twin of the `state-layer` utility has to gate
                  itself on `:disabled` by hand, or a disabled switch keeps
                  lighting its hover layer. */}
              <span
                className={`absolute inset-0 rounded-full bg-current opacity-0 transition-opacity duration-state ease-[var(--ease-standard)] ${
                  disabled
                    ? ''
                    : 'group-hover/switch:opacity-[var(--md-sys-state-hover-opacity)] group-has-[:focus-visible]/switch:opacity-[var(--md-sys-state-focus-opacity)] group-active/switch:opacity-[var(--md-sys-state-pressed-opacity)]'
                }`}
              />

              {/* Handle. `z-10` keeps it above the ripple, which the global
                  RippleLayer appends after it.
                  The pressed width comes from `pressed` rather than an active
                  variant — see the press-state note. The size classes are spelled
                  per branch so only one size class is ever emitted: `cn` is a
                  plain join and would leave Tailwind's output order to pick. */}
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
                <CheckGlyph
                  className={`absolute inset-0 m-auto size-4 text-primary-ink ${ICON_TRANSITION} ${
                    checked ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </span>
            </span>
          </span>
        </span>
      </span>
      {label && (
        <div className={isRow ? 'min-w-0 flex-1' : undefined}>
          {/* No ink prop: if a label ever needs a semantic it takes a `tone`
              union like `Radio` does, not an arbitrary string. */}
          <span className="text-label-l text-on-surface">{label}</span>
          {/* `on-surface-variant`, the supporting-text ink role — not `outline`,
              which is a *boundary* role for rules and field borders. */}          {description && <p className="text-body-s text-on-surface-variant mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  );
}
