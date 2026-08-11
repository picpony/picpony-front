'use client';

import { ReactNode, useRef } from 'react';
import { spawnRipple } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string | ReactNode;
  description?: string;
  colorClass?: string;
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

/* Transitions copied verbatim from material-web's `md-switch`, where each
   property runs on its own clock — hence the arbitrary `transition` shorthand
   rather than a `transition-[…] duration-…` pair, which can only carry one. */

/** Handle: the spec's two clocks. A state change resizes it 16 → 24dp and runs
 *  on `standard`; a press swells it to 28dp and runs at 100ms linear, because
 *  contact feedback has to feel immediate. Colour keeps its own 67ms. */
const HANDLE_TRANSITION =
  '[transition:width_250ms_var(--ease-standard),height_250ms_var(--ease-standard),background-color_67ms_linear]';
const PRESSED_HANDLE_TRANSITION =
  'group-active/switch:[transition:width_100ms_linear,height_100ms_linear,background-color_67ms_linear]';
/** The check fades on the spec's 33ms — fast enough not to smear while the
 *  handle is still travelling. */
const ICON_TRANSITION = '[transition:opacity_33ms_linear]';
/** Track and its outline recolour together with the handle. */
const TRACK_TRANSITION = '[transition:background-color_67ms_linear,border-color_67ms_linear]';

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
  colorClass,
  layout = 'inline',
  'aria-label': ariaLabel,
}: ToggleSwitchProps) {
  const stateLayerRef = useRef<HTMLSpanElement>(null);
  const isRow = layout === 'row';

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
          className="peer absolute top-1/2 left-1/2 z-10 h-12 w-13 -translate-x-1/2 -translate-y-1/2 cursor-[inherit] appearance-none rounded-full outline-none"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel ?? (typeof label === 'string' ? undefined : '开关')}
          onChange={(e) => onChange(e.target.checked)}
          onPointerDown={(e) => {
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
          {/* Shell — carries the travel, nothing else. */}
          <span
            className={`flex items-center justify-center transition-[translate] duration-200 ease-[var(--ease-standard)] ${
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
              <span className="absolute inset-0 rounded-full bg-current opacity-0 transition-opacity duration-150 ease-[var(--ease-standard)] group-hover/switch:opacity-[var(--md-sys-state-hover-opacity)] group-has-[:focus-visible]/switch:opacity-[var(--md-sys-state-focus-opacity)] group-active/switch:opacity-[var(--md-sys-state-pressed-opacity)]" />

              {/* Handle. `z-10` keeps it above the ripple, which the global
                  RippleLayer appends after it. */}
              <span
                className={`relative z-10 grid place-items-center rounded-full ${HANDLE_TRANSITION} ${PRESSED_HANDLE_TRANSITION} group-active/switch:size-7 ${
                  checked
                    ? 'size-6 bg-on-primary'
                    : 'size-4 bg-outline group-hover/switch:bg-on-surface-variant'
                }`}
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
          <span className={cn('text-label-l', colorClass || 'text-on-surface')}>{label}</span>
          {/* `on-surface-variant`, the supporting-text ink role — not `outline`,
              which is a *boundary* role for rules and field borders. */}
          {description && <p className="text-body-s text-on-surface-variant mt-0.5">{description}</p>}
        </div>
      )}
    </label>
  );
}
