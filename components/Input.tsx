'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input primitives: `Input`, `Textarea`, `Field` and `ColorSwatch`.
 *
 * **There are two fields, and the label decides which.** A *labelled* field is a
 * slot in a form and gets M3's outlined field with the label floating into the
 * outline — an empty field and a filled one stop being different objects. An
 * *unlabelled* field is not a form slot (search box, admin filter, composer); its
 * placeholder is its whole identity, so it gets the filled treatment: a tone
 * step, no border, no shadow. Same 4dp corner, same 56dp box — one family, two
 * boundary treatments. Geometry, notch and float live in `.m3-field`
 * (globals.css), which turns on `:focus-within`/`:placeholder-shown` against a
 * *sibling* and a real `<legend>` to cut the notch.
 *
 * **An unlabelled field carries its own actions** via `trailing` — a flow item,
 * not an overlay, so any number of controls fit with no hand-typed width reserve.
 *
 * **One height for a form slot, 56dp** (`OutlinedTextFieldTokens.ContainerHeight`
 * is 56 and M3 gives no other). The two variants differ in exactly one thing: the
 * boundary. `Textarea` follows through block padding, since it grows.
 *
 * **One height for chrome, 40dp** — `size="sm"`, the app's own step (M3 offers
 * no 40dp field), matching `Select size="sm"` and the dense row it sits in. Two
 * fences: unlabelled only (the notch geometry is derived from 56dp), and no
 * `trailing` slot (the 8dp inset is `(56 - 40) / 2`; a 40dp box has no room to
 * centre a 40dp control).
 */

/** `OutlinedTextFieldTokens.ContainerHeight`. The only height M3 gives a field. */
const LABELLED_HEIGHT = 'h-14';
/**
 * The same 56dp — no second figure exists for a form slot. Kept as its own constant
 * so the two roles stay legible at the call sites that read them.
 */
const BARE_HEIGHT = 'h-14';
/**
 * `size="sm"` — the dense step, and the one height in this file M3 does not name.
 * 40dp matches `Select size="sm"`'s box, with `body-m` ink to match; a field and a
 * dropdown in one filter bar are the same height *and* the same size of type. See
 * the docblock above for the two fences: unlabelled only, and no `trailing`.
 */
const DENSE_HEIGHT = 'h-10';
/**
 * `size="lg"` — M3's *search bar* (`SearchBarTokens`): the same 56dp, but fully
 * rounded rather than the field's 4dp. Exists for the one field on /search, which
 * is the page — cornered like a filter it read as a filter. The 4dp corner stays
 * the default precisely so this cannot spread. The pill is also what makes the
 * buttons inside it work: a centred pill inside a pill is concentric for free at
 * any size (40dp button, 56dp box, 8px gap ⇒ half the button's height), where a
 * 4dp enclosure would need a remembered corner value.
 */
const HERO_HEIGHT = 'h-14';

/** The control's own ink and placeholder, shared by both primitives. */
const CONTROL = 'text-body-l placeholder:text-on-surface-variant';
/** The dense field's ink — `body-m`, matching `Select size="sm"`'s trigger exactly. */
const DENSE_CONTROL = 'text-body-m placeholder:text-on-surface-variant';

/* Same guard as `Skeleton`'s conditional radius: `cn` is a plain join, so a
 * textarea asking for `resize-none` used to emit that *and* the default
 * `resize-y`, leaving Tailwind's output order to decide which applied. */
const HAS_RESIZE = /(?:^|\s)resize(?:-\S+)?(?:\s|$)/;

interface FieldProps {
  label?: ReactNode;
  /** Explanatory text under the control. Replaced by `error` when set. */
  helper?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Shows an `n / max` counter; pass alongside `maxLength`. */
  count?: { value: number; max: number };
  className?: string;
}

/**
 * The supporting row under a control — helper text or an error, and a counter.
 * Renders no label (the label lives inside the control now). Inset 16dp, where
 * M3 puts supporting text: flush with the field's text, not its outline.
 */
export function Field({
  helper,
  error,
  count,
  className = '',
  children,
  supportId,
}: Pick<FieldProps, 'helper' | 'error' | 'count' | 'className'> & { children: ReactNode; supportId?: string }) {
  const overLimit = count ? count.value > count.max : false;

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
      {children}

      {(error || helper || count) && (
        <div id={supportId} className="flex items-start justify-between gap-3 px-4">
          <p
            className={cn('text-body-s min-w-0', error ? 'text-error' : 'text-on-surface-variant')}
            // Errors announce themselves; helper text is static and must not.
            role={error ? 'alert' : undefined}
          >
            {error || helper}
          </p>
          {count && (
            <span
              /* `on-surface-variant`, not `outline`: a character count is supporting
                 *text*, and `outline` is the boundary role — under the 4.5:1 AA floor
                 for body text on this app's light surface. */
              className={cn(
                'text-body-s shrink-0 tabular-nums',
                overLimit ? 'text-error' : 'text-on-surface-variant',
              )}
            >
              {count.value} / {count.max}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const hasLabel = (label: ReactNode) => label != null && label !== '' && label !== false;

/**
 * The visible label, and the invisible copy that cuts the notch.
 *
 * Two elements hold the same words on purpose: the `<label>` is what the user
 * reads and names the control; the `<legend>` exists only to have the right
 * *width*, because a legend is the one thing in CSS that removes a section of a
 * `<fieldset>`'s border. They stay in step (legend font-size = 0.75x label's).
 * The outline renders even without a label, but the `<legend>` is omitted
 * entirely rather than left empty — an empty legend reserves its own padding and
 * would leave a permanent nick in the top border.
 */
function FieldLabel({
  label,
  required,
  htmlFor,
}: {
  label: ReactNode;
  required?: boolean;
  htmlFor: string;
}) {
  const text = (
    <>
      {label}
      {required && (
        <span className="text-error" aria-hidden="true">
          &nbsp;*
        </span>
      )}
    </>
  );
  return (
    <>
      <label htmlFor={htmlFor}>{text}</label>
      <fieldset aria-hidden="true">
        <legend>
          <span>{text}</span>
        </legend>
      </fieldset>
    </>
  );
}

/**
 * Focus, on both fields, is the app's one indicator — painted twice, in the two
 * places the two boundaries leave room for it.
 *
 * An *outlined* field has no focus ring: the focused outline is `primary` at 2px
 * — the ring's colour at the ring's weight, drawn as the control's boundary
 * rather than as a second boundary 2px outside the first. A field whose entire
 * identity *is* a 1px outline cannot wear a ring around it without reading as
 * two nested boxes; M3 specifies the thickened outline for that reason.
 *
 * A *filled* field takes the ordinary ring — no outline to nest inside. Both key
 * off `:focus-within` (not `:focus-visible`): the element wearing the indicator
 * is the container, reporting on the control inside it.
 */
function shellProps(opts: {
  labelled: boolean;
  invalid: boolean;
  icon?: boolean;
  trailing?: boolean;
  multiline?: boolean;
  hero?: boolean;
  dense?: boolean;
}) {
  return {
    className: 'm3-field',
    // Data attributes rather than classes: each shifts several declarations in
    // `.m3-field` at once (control padding, resting label and notch share one
    // custom property), which a utility cannot express.
    'data-labelled': opts.labelled ? '' : undefined,
    'data-invalid': opts.invalid ? '' : undefined,
    'data-lead': opts.icon ? '' : undefined,
    'data-trail': opts.trailing ? '' : undefined,
    'data-multiline': opts.multiline ? '' : undefined,
    'data-size': opts.hero ? 'lg' : opts.dense ? 'sm' : undefined,
  };
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  FieldProps & {
    /** Leading adornment — an icon, not a control. */
    icon?: ReactNode;
    /** Trailing adornment; may be interactive (clear button, visibility toggle). */
    trailing?: ReactNode;
    /**
     * `lg` is M3's search bar — 56dp and fully rounded. `sm` is the dense step,
     * 40dp with `body-m`, for a filter bar or a row. Both are **unlabelled only**,
     * and `sm` additionally takes no `trailing`. See the docblock above.
     */
    size?: 'sm' | 'md' | 'lg';
    fieldClassName?: string;
  };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helper,
    error,
    required,
    count,
    icon,
    trailing,
    size = 'md',
    className = '',
    fieldClassName = '',
    id,
    placeholder,
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const supportId = helper || error || count ? `${autoId}-support` : undefined;
  const labelled = hasLabel(label);
  const hero = !labelled && size === 'lg';
  /* Both size branches are gated on `!labelled` rather than trusting the call site,
     because a labelled field's whole notch geometry is derived from 56dp. A `sm`
     on a labelled field is a no-op rather than an error, the same way `lg` is. */
  const dense = !labelled && size === 'sm';

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName} supportId={supportId}>
      <div
        {...shellProps({
          labelled,
          invalid: Boolean(error),
          icon: Boolean(icon),
          /* The dense field has no room for a control: the 8dp inset either side is
             `(56 - 40) / 2`, so at 40dp there is nothing left to centre. Dropped
             here rather than left to the call site, so the inset stays one value. */
          trailing: Boolean(trailing) && !dense,
          hero,
          dense,
        })}
      >
        {icon && (
          <span aria-hidden="true" className="m3-field-lead">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-describedby={[describedBy, supportId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          required={required}
          /* `:placeholder-shown` is what tells the label whether the field is
             empty, and it only matches while a placeholder *exists* — so a
             labelled field with nothing to suggest gets a single space, which
             the CSS keeps invisible until the label has floated clear. */
          placeholder={placeholder ?? (labelled ? ' ' : undefined)}
          className={cn(
            dense ? DENSE_CONTROL : CONTROL,
            labelled ? LABELLED_HEIGHT : hero ? HERO_HEIGHT : dense ? DENSE_HEIGHT : BARE_HEIGHT,
            className,
          )}
          {...rest}
        />
        {labelled && <FieldLabel label={label} required={required} htmlFor={inputId} />}
        {!labelled && <fieldset aria-hidden="true" />}
        {trailing && !dense && <span className="m3-field-trail">{trailing}</span>}
      </div>
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldProps & {
    /** Trailing controls, inside the box. See `Input`'s note. */
    trailing?: ReactNode;
    /**
     * `sm` is the dense step, unlabelled only — a one-row field at **48dp**, matching
     * the 48dp `IconButton`s the chat composer puts either side of it. See the
     * block-padding note below.
     */
    size?: 'sm' | 'md';
    fieldClassName?: string;
  };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    helper,
    error,
    required,
    count,
    trailing,
    className = '',
    fieldClassName = '',
    id,
    placeholder,
    rows = 4,
    size = 'md',
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const supportId = helper || error || count ? `${autoId}-support` : undefined;
  const labelled = hasLabel(label);
  const dense = !labelled && size === 'sm';

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName} supportId={supportId}>
      <div
        {...shellProps({
          labelled,
          invalid: Boolean(error),
          trailing: Boolean(trailing) && !dense,
          multiline: true,
          dense,
        })}
      >
        <textarea
          ref={ref}
          id={areaId}
          aria-describedby={[describedBy, supportId].filter(Boolean).join(' ') || undefined}
          rows={rows}
          aria-invalid={error ? true : undefined}
          required={required}
          placeholder={placeholder ?? (labelled ? ' ' : undefined)}
          /* Asymmetric block padding only when there is a label: the floated label
             lands on the top border and the first line has to clear it; without one
             the padding is pure height, and the composer read as a stretched box.
             Symmetric 14px, measured: `body-l`'s line box is 28px here (body
             line-heights run looser for Han glyphs), so 28 + 28 lands a one-row field
             at 56dp — exactly `BARE_HEIGHT`. A derived number needs its derivation
             recorded, or the next scale change orphans it.
             **The dense step keeps `body-l` and spends the padding instead** — the
             one place it parts company with `Input size="sm"`'s `body-m`: a composer
             holds prose you are writing, and 16px is the size to write at. With a
             28px line box, 10 + 28 + 10 = 48 matches the 48dp icon buttons beside it
             (the row sets the touch floor locally, as the app bar does), so the trio
             lines up at every density. */
          className={cn(
            CONTROL,
            !HAS_RESIZE.test(className) && 'resize-y',
            labelled ? 'pt-4 pb-3' : dense ? 'py-2.5' : 'py-3.5',
            className,
          )}
          {...rest}
        />
        {labelled && <FieldLabel label={label} required={required} htmlFor={areaId} />}
        {!labelled && <fieldset aria-hidden="true" />}
        {trailing && !dense && <span className="m3-field-trail">{trailing}</span>}
      </div>
    </Field>
  );
});

/**
 * The native colour swatch, wearing the app's border, radius and focus ring.
 * `<input type="color">` opens the OS picker — no M3 component does that job, so
 * the control stays native. `p-0.5` is not decoration: the swatch paints across
 * the whole content box, so without the inset the border and swatch touch and
 * the corner radius is lost under the fill.
 */
type ColorSwatchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  'aria-label': string;
};

/**
 * Forwards its ref, like `Input` and `Textarea`.
 *
 * Watch for one trap if a call site commits on change: React's `onChange` on an
 * `<input type="color">` is the native **`input`** event, which Chrome fires
 * continuously while the pointer moves inside the OS dialog — dozens of commits
 * per drag. The native **`change`** event is the one that means "the dialog
 * closed", and reaching it needs an `addEventListener` on the element.
 */
export const ColorSwatch = forwardRef<HTMLInputElement, ColorSwatchProps>(function ColorSwatch(
  { className = '', 'aria-label': ariaLabel, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="color"
      aria-label={ariaLabel}
      className={cn(
        /* 4dp and 56dp, matching the unlabelled text field it stands beside in the
           admin console — same kind of object, same box (the field token's shape
           and the only height M3 gives a field). */
        'h-14 w-14 shrink-0 cursor-pointer rounded-xs border border-outline p-0.5',
        'outline-none transition-ui focus-visible:ring-2 focus-ring',
        'disabled:cursor-not-allowed disabled:disabled-content',
        className,
      )}
      {...rest}
    />
  );
});

export default Input;
