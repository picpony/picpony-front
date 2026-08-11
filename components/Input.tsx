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
 * Text input primitives.
 *
 * The string
 * `border border-outline rounded-lg
 * focus:ring-2 focus:ring-primary/20 focus:border-primary`
 * appeared at dozens of call sites, each pairing a light and a dark colour by
 * hand, and each re-deciding whether to show a label, a hint, or an error. The
 * helper/error/counter scaffolding lives in `Field` so an input and a textarea
 * cannot drift apart.
 *
 * **The label floats into the outline.** It used to sit stacked above the
 * control, and the note here argued for that on the grounds that M3 allows both
 * and changing ~40 forms bought nothing. It buys one thing, which is the whole
 * point of the pattern: an empty field and a filled one stop being different
 * objects. With a stacked label, a form of six empty fields is six blank boxes
 * and six captions floating between them — and the caption belonging to the box
 * *below* it sits exactly as close as the one belonging to the box above.
 *
 * The geometry, the notch and the float live in `.m3-field` (globals.css),
 * because the whole thing turns on `:focus-within` and `:placeholder-shown`
 * matching against a *sibling*, and on a real `<legend>` to cut the hole.
 *
 * Two heights, and the difference is content rather than density: a field with a
 * floating label needs a label row and a text row, so it takes M3's 56dp; a
 * field with no label — a search box, an admin filter — is one row and stays at
 * 44dp. Nothing else varies between them.
 */

/** M3's outlined text field height, once there is a label to float. */
const LABELLED_HEIGHT = 'h-14';
/** One row. 44px is the comfortable touch minimum, and most of this site's
 *  traffic is a phone. */
const BARE_HEIGHT = 'h-11';

/** The control's own ink and placeholder, shared by both primitives. */
const CONTROL = 'text-body-l placeholder:text-on-surface-variant';

/* Same guard, and for the same reason, as `Skeleton`'s conditional radius: `cn`
 * is a plain join, so a textarea asking for `resize-none` used to emit that
 * *and* the default `resize-y`, leaving Tailwind's output order to decide which
 * applied. Eight of the app's twelve textareas ask for it. */
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
 *
 * It no longer renders the label: the label belongs inside the control now, and
 * a `Field` that emitted one as well would put the same words on screen twice.
 * Inset to 16dp, which is where M3 puts supporting text — flush with the field's
 * own text rather than with its outline.
 */
export function Field({
  helper,
  error,
  count,
  className = '',
  children,
}: Pick<FieldProps, 'helper' | 'error' | 'count' | 'className'> & { children: ReactNode }) {
  const overLimit = count ? count.value > count.max : false;

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
      {children}

      {(error || helper || count) && (
        <div className="flex items-start justify-between gap-3 px-4">
          <p
            className={cn('text-body-s min-w-0', error ? 'text-error' : 'text-on-surface-variant')}
            // Errors announce themselves; helper text is static and must not.
            role={error ? 'alert' : undefined}
          >
            {error || helper}
          </p>
          {count && (
            <span
              /* `on-surface-variant`, not `outline`. A character count is
                 supporting *text*, and `outline` is the boundary role — 4.3:1
                 on this app's light surface, under the 4.5:1 AA floor for body
                 text. It passes in the dark scheme, which is why it lasted. */
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
 * Two elements hold the same words on purpose. The `<label>` is what the user
 * reads and what names the control; the `<legend>` exists only to have the right
 * *width*, because a legend is the one thing in CSS that removes a section of a
 * `<fieldset>`'s border. They stay in step because the legend's font-size is
 * exactly 0.75x the label's and the label scales to 0.75 when it floats.
 *
 * The outline is rendered even without a label, so the border is drawn in one
 * place either way — but the `<legend>` is then omitted entirely rather than
 * left empty, since an empty legend still reserves its own padding and would
 * leave a permanent 8px nick in the top border.
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
 * There is no focus *ring* on a text field, and that is not the old exception
 * coming back.
 *
 * The rule is that focus looks identical on every control, and it still does:
 * the focused outline is `primary` at 2px, which is the ring's own colour at the
 * ring's own weight. What changed is where it is painted — as the control's own
 * boundary rather than as a second boundary 2px outside the first. A field whose
 * entire visual identity *is* a 1px outline cannot wear a 2px ring around that
 * outline without reading as two nested boxes, and M3 specifies the thickened
 * outline as this control's indicator for exactly that reason.
 *
 * (The alphas the old ring carried are described in prose, not spelled as class
 * names — see the note on comment-generated CSS in AGENTS.md.)
 */
function shellProps(opts: {
  labelled: boolean;
  invalid: boolean;
  icon?: boolean;
  trailing?: boolean;
  multiline?: boolean;
}) {
  return {
    className: 'm3-field',
    // Data attributes rather than classes: each one shifts several declarations
    // in `.m3-field` at once (the control's padding, the resting label and the
    // notch all read the same custom property), which a utility cannot express.
    'data-labelled': opts.labelled ? '' : undefined,
    'data-invalid': opts.invalid ? '' : undefined,
    'data-lead': opts.icon ? '' : undefined,
    'data-trail': opts.trailing ? '' : undefined,
    'data-multiline': opts.multiline ? '' : undefined,
  };
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  FieldProps & {
    /** Leading adornment — an icon, not a control. */
    icon?: ReactNode;
    /** Trailing adornment; may be interactive (clear button, visibility toggle). */
    trailing?: ReactNode;
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
    className = '',
    fieldClassName = '',
    id,
    placeholder,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const labelled = hasLabel(label);

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName}>
      <div
        {...shellProps({
          labelled,
          invalid: Boolean(error),
          icon: Boolean(icon),
          trailing: Boolean(trailing),
        })}
      >
        {icon && (
          <span
            aria-hidden="true"
            className="text-on-surface-variant pointer-events-none absolute left-3 z-1 flex items-center"
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          required={required}
          /* `:placeholder-shown` is what tells the label whether the field is
             empty, and it only matches while a placeholder *exists* — so a
             labelled field with nothing to suggest gets a single space, which
             the CSS keeps invisible until the label has floated clear. */
          placeholder={placeholder ?? (labelled ? ' ' : undefined)}
          className={cn(CONTROL, labelled ? LABELLED_HEIGHT : BARE_HEIGHT, className)}
          {...rest}
        />
        {labelled && <FieldLabel label={label} required={required} htmlFor={inputId} />}
        {!labelled && <fieldset aria-hidden="true" />}
        {trailing && (
          <span className="text-on-surface-variant absolute right-2 z-1 flex items-center">
            {trailing}
          </span>
        )}
      </div>
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldProps & { fieldClassName?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    helper,
    error,
    required,
    count,
    className = '',
    fieldClassName = '',
    id,
    placeholder,
    rows = 4,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const labelled = hasLabel(label);

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName}>
      <div {...shellProps({ labelled, invalid: Boolean(error), multiline: true })}>
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          aria-invalid={error ? true : undefined}
          required={required}
          placeholder={placeholder ?? (labelled ? ' ' : undefined)}
          /* Asymmetric block padding on purpose: the floated label lands on the
             top border and the first line of text has to clear it. */
          className={cn(
            CONTROL,
            !HAS_RESIZE.test(className) && 'resize-y',
            'pt-4 pb-3',
            className,
          )}
          {...rest}
        />
        {labelled && <FieldLabel label={label} required={required} htmlFor={areaId} />}
        {!labelled && <fieldset aria-hidden="true" />}
      </div>
    </Field>
  );
});

/**
 * The native colour swatch, wearing the app's border, radius and focus ring.
 *
 * `<input type="color">` opens the OS picker and there is no M3 component that
 * does that job, so the control itself stays native — but its *box* was being
 * hand-written at three call sites in the admin console, two of which shipped
 * without an accessible name and none of which had a focus ring. It was the one
 * form control in the app where Tab landed on nothing visible.
 *
 * `p-0.5` is not decoration: a `type="color"` paints its swatch across the whole
 * content box, so without the inset the border and the swatch touch and the
 * corner radius is lost under the fill.
 */
export function ColorSwatch({
  className = '',
  'aria-label': ariaLabel,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & { 'aria-label': string }) {
  return (
    <input
      type="color"
      aria-label={ariaLabel}
      className={cn(
        // 12dp and 44px, matching the unlabelled text field it stands beside in
        // the admin console — same kind of object, same box.
        'h-11 w-11 shrink-0 cursor-pointer rounded-md border border-outline p-0.5',
        'outline-none transition-ui focus-visible:ring-2 focus-ring',
        'disabled:cursor-not-allowed disabled:disabled-content',
        className,
      )}
      {...rest}
    />
  );
}

export default Input;
