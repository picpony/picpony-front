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
 * label/helper/counter scaffolding lives in `Field` so an input and a textarea
 * cannot drift apart.
 *
 * The label sits above the control rather than floating into the border. M3
 * allows both, and stacked labels are what the app already used — a floating
 * label would have changed the interaction on ~40 forms for no clear gain.
 */

interface FieldProps {
  label?: ReactNode;
  /** Explanatory text under the control. Replaced by `error` when set. */
  helper?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Shows an `n / max` counter; pass alongside `maxLength`. */
  count?: { value: number; max: number };
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  helper,
  error,
  required,
  count,
  htmlFor,
  className = '',
  children,
}: FieldProps) {
  const overLimit = count ? count.value > count.max : false;

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-label-l text-on-surface-variant flex items-center gap-1"
        >
          {label}
          {required && (
            <span className="text-error" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      {children}

      {(error || helper || count) && (
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn('text-body-s min-w-0', error ? 'text-error' : 'text-on-surface-variant')}
            // Errors announce themselves; helper text is static and must not.
            role={error ? 'alert' : undefined}
          >
            {error || helper}
          </p>
          {count && (
            <span
              className={cn(
                'text-body-s shrink-0 tabular-nums',
                overLimit ? 'text-error' : 'text-outline',
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

/* The shared control shell. `transition` for these properties is already set
 globally on input/textarea in globals.css, so it is not repeated here. */
const CONTROL = cn(
  'w-full min-w-0 rounded-sm border bg-surface-container-lowest px-3',
  'text-body-l text-on-surface placeholder:text-outline',
  'outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

const CONTROL_OK = 'border-outline focus:border-primary focus:ring-2 focus:ring-primary/25';
const CONTROL_ERR = 'border-error focus:border-error focus:ring-2 focus:ring-error/25';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> &
  Omit<FieldProps, 'children' | 'htmlFor'> & {
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
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <Field
      label={label}
      helper={helper}
      error={error}
      required={required}
      count={count}
      htmlFor={inputId}
      className={fieldClassName}
    >
      <div className="relative flex w-full items-center">
        {icon && (
          <span
            aria-hidden="true"
            className="text-on-surface-variant pointer-events-none absolute left-3 flex items-center"
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(
            CONTROL,
            error ? CONTROL_ERR : CONTROL_OK,
            // 44px — the previous h-9/h-10 controls were below the comfortable
            // touch target on phones, which is most of this site's traffic.
            'h-11',
            icon && 'pl-10',
            trailing && 'pr-10',
            className,
          )}
          {...rest}
        />
        {trailing && (
          <span className="text-on-surface-variant absolute right-2 flex items-center">
            {trailing}
          </span>
        )}
      </div>
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  Omit<FieldProps, 'children' | 'htmlFor'> & { fieldClassName?: string };

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
    rows = 4,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;

  return (
    <Field
      label={label}
      helper={helper}
      error={error}
      required={required}
      count={count}
      htmlFor={areaId}
      className={fieldClassName}
    >
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        required={required}
        className={cn(CONTROL, error ? CONTROL_ERR : CONTROL_OK, 'resize-y py-2.5', className)}
        {...rest}
      />
    </Field>
  );
});

export default Input;
