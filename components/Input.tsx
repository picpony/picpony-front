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
 * **There are two fields, and the label decides which.**
 *
 * A *labelled* field is a slot in a form. It has a name, that name has to
 * survive being filled, and it gets M3's outlined field with the label floating
 * into the outline. It used to sit stacked above the control, and the note here
 * argued for that on the grounds that M3 allows both and changing ~40 forms
 * bought nothing. It buys one thing, which is the whole point of the pattern: an
 * empty field and a filled one stop being different objects. With a stacked
 * label, a form of six empty fields is six blank boxes and six captions floating
 * between them — and the caption belonging to the box *below* it sits exactly as
 * close as the one belonging to the box above.
 *
 * An *unlabelled* field is not a form slot — it is a search box, an admin
 * filter, a chat composer, and its placeholder is its whole identity. It gets
 * the filled treatment instead: a tone step, no border, no shadow. Dressed as an
 * outlined field it read as a form control whose label had failed to load, and
 * it put the heaviest boundary on the page around the least ceremonial thing on
 * it. Same 4dp corner, same 56dp box — one family, two boundary treatments.
 *
 * The geometry, the notch, the float and both treatments live in `.m3-field`
 * (globals.css), because the whole thing turns on `:focus-within` and
 * `:placeholder-shown` matching against a *sibling*, and on a real `<legend>` to
 * cut the hole.
 *
 * **An unlabelled field carries its own actions.** A search box with the submit
 * button outside it is two objects the eye has to associate; inside, it is one
 * control that does one job. Hence `trailing`, which is a flow item rather than
 * an overlay so that one button, two buttons, or a button with a word in it all
 * fit without a hand-typed reserve at the call site.
 *
 * **One height for a form slot, 56dp**, and that is a change. There used to be two
 * — 56dp labelled, 48dp unlabelled — on the argument that a floating label needs two
 * rows where a placeholder needs one. The argument is fine and the number was not:
 * `OutlinedTextFieldTokens.ContainerHeight` is 56dp and M3 gives a text field no
 * other height, while 48dp is the *touch-target minimum*, which is a floor on the
 * hit area rather than a step on the size scale. So the labelled field, the
 * unlabelled one, `Select`'s trigger, `CodeInput`'s boxes and the colour swatch all
 * stand at 56dp, and the two variants differ in exactly one thing — the boundary —
 * which is what the paragraphs above always claimed. `Textarea` follows through its
 * block padding rather than a fixed height, since it grows.
 *
 * **And one height for a field that is chrome, 40dp** — `size="sm"`, unlabelled
 * only. This is the app's own step rather than the spec's, and it is worth saying
 * why rather than leaving it to be discovered. A field in an admin filter bar or a
 * settings row is not a slot you fill in: its neighbours are a 40dp `Select`, a 32dp
 * chip and a 32dp switch, and a 56dp box among those is the tallest thing in the row
 * by half again. Every field in the app was 56 — including nine admin filters — so
 * a filter bar was a 56dp field beside a 56dp dropdown beside a 32dp chip. Matching
 * the neighbours is what "coordinated" means here, and matching a token specified
 * for a phone form is not.
 *
 * Two fences keep that from spreading. It is **unlabelled only**: the labelled
 * field's notch is a real `<legend>` whose width, float distance and negative
 * fieldset inset are all derived from 56dp, and a labelled field lives in a form
 * column anyway. And it takes **no `trailing` slot**: that inset is `(56 - 40) / 2`,
 * the only value that centres a 40dp control in the box, and a 40dp box has no room
 * for one at all — see the field block in globals.css.
 */

/** `OutlinedTextFieldTokens.ContainerHeight`. The only height M3 gives a field. */
const LABELLED_HEIGHT = 'h-14';
/**
 * The same 56dp, because there is no second figure to reach for *for a form slot*.
 * This was 44 (a value from Apple's guidelines, off Material's scale entirely) and
 * then 48, which looks like a scale step and is not one — 48dp is M3's *touch-target*
 * minimum, a floor on the hit area. No field, button or icon-button token in the spec
 * is 48. Kept as its own constant rather than folded into `LABELLED_HEIGHT` so the
 * two roles stay legible at the call sites that read them.
 */
const BARE_HEIGHT = 'h-14';
/**
 * `size="sm"` — the dense step, and the one height in this file M3 does not name.
 * 40dp is `Select size="sm"`'s box and the small control step, and the ink drops to
 * `body-m` to match it exactly, so a field and a dropdown in one filter bar are the
 * same height *and* the same size of type. See the docblock above for the two
 * fences: unlabelled only, and no `trailing`.
 */
const DENSE_HEIGHT = 'h-10';
/**
 * `size="lg"` — M3's *search bar*, which is its own component in the spec
 * (`SearchBarTokens`): the same 56dp, but `CornerFull` rather than the field's 4dp.
 * Now that every field is 56dp the shape is the whole difference, which is exactly
 * what the spec says it is.
 *
 * It exists for one field, the one on /search, and the reason is that that field
 * is the page. Cornered like a filter it read as a filter — a rectangle adrift in a
 * 1280px column with the site's primary verb inside it — which is the wrong shape
 * for the only thing on the screen you are meant to touch first. The 4dp corner
 * stays the default precisely so this cannot spread: an admin filter and a hero
 * search are not the same object.
 *
 * The pill is also what makes the buttons inside it work. Concentric corners
 * want `inner = outer - gap`, and at the field's own 4dp corner an inner control
 * would need a value someone has to remember. A centred pill inside a
 * pill needs no arithmetic at all: 40dp button, 56dp box, 8px gap, and
 * `28 - 8 = 20`, which *is* half the button's height. It is concentric for free,
 * at any size, forever.
 */
const HERO_HEIGHT = 'h-14';

/** The control's own ink and placeholder, shared by both primitives. */
const CONTROL = 'text-body-l placeholder:text-on-surface-variant';
/** The dense field's ink — `body-m`, matching `Select size="sm"`'s trigger exactly. */
const DENSE_CONTROL = 'text-body-m placeholder:text-on-surface-variant';

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
 * Focus, on both fields, is the app's one indicator — painted twice, in the two
 * places the two boundaries leave room for it.
 *
 * An *outlined* field has no focus ring. That is not the old exception coming
 * back: the focused outline is `primary` at 2px, which is the ring's own colour
 * at the ring's own weight, and what changed is only where it is painted — as
 * the control's boundary rather than as a second boundary 2px outside the first.
 * A field whose entire visual identity *is* a 1px outline cannot wear a 2px ring
 * around that outline without reading as two nested boxes, and M3 specifies the
 * thickened outline as this control's indicator for exactly that reason.
 *
 * A *filled* field has no outline to nest inside, so that objection does not
 * apply and it takes the ordinary ring. Both are `:focus-within`, not
 * `:focus-visible` — the element wearing the indicator is the container, and it
 * is reporting on the control inside it.
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
  hero?: boolean;
  dense?: boolean;
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
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const labelled = hasLabel(label);
  const hero = !labelled && size === 'lg';
  /* Both size branches are gated on `!labelled` rather than trusting the call site,
     because a labelled field's whole notch geometry is derived from 56dp. A `sm` on
     a labelled field is a no-op rather than an error, the same way `lg` already is. */
  const dense = !labelled && size === 'sm';

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName}>
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
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const labelled = hasLabel(label);
  const dense = !labelled && size === 'sm';

  return (
    <Field helper={helper} error={error} count={count} className={fieldClassName}>
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
          rows={rows}
          aria-invalid={error ? true : undefined}
          required={required}
          placeholder={placeholder ?? (labelled ? ' ' : undefined)}
          /* Asymmetric block padding only when there is a label: the floated
             label lands on the top border and the first line of text has to
             clear it. Without one there is nothing to clear, and the 16px was
             pure height — the direct-message composer is a single-row unlabelled
             textarea, so it stood taller than the send button beside it and read
             as a box that had been stretched.

             Symmetric 14px, measured rather than assumed: `body-l`'s line box is
             28px here, not the 24px the type scale implies, because this app's
             body line-heights run looser for Han glyphs. 28 + 28 lands a one-row
             field at 56dp — `BARE_HEIGHT`, i.e. exactly what an unlabelled
             single-line `Input` stands at.
             It was 10px, which landed 48. That was correct when an unlabelled field
             was 48dp and it was quietly left behind when 48 was retired from the
             control-height scale, so a textarea and an input of the same kind sat a
             step apart — and in the one place they sit *side by side*, the /messages
             composer, the field ended up shorter than the buttons flanking it.

             **The dense step keeps `body-l` and spends the padding instead**, which is
             the one place it parts company with `Input size="sm"`'s `body-m`. A filter
             field holds a token you type and read back; a composer holds prose you are
             writing, and 16px is the size to write at. With a 28px line box the
             arithmetic is exact: 10 + 28 + 10 = **48**, which is what the 48dp
             `IconButton`s beside it measure, so the trio lines up without anything being
             rounded to fit.

             48 rather than 40, and that is the second correction to this row: at 40 the
             field read *thin* on a desktop — a one-line box in a 56px band with a 16px
             glyph either side of it. 48 is the touch floor taken as a real box, which is
             what the accessories take too (the row sets `--touch-floor` locally, the way
             the app bar does), so all three agree at every density instead of stepping
             together between two. */
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
        /* 4dp and 56dp, matching the unlabelled text field it stands beside in the
           admin console — same kind of object, same box. Both numbers moved with
           the field: 4dp is `OutlinedTextFieldTokens.ContainerShape` and 56dp is
           its `ContainerHeight`, which is also the only height M3 gives a field. */
        'h-14 w-14 shrink-0 cursor-pointer rounded-xs border border-outline p-0.5',
        'outline-none transition-ui focus-visible:ring-2 focus-ring',
        'disabled:cursor-not-allowed disabled:disabled-content',
        className,
      )}
      {...rest}
    />
  );
}

export default Input;
