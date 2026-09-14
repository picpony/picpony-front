'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';

export type { ButtonSize, ButtonVariant, ButtonClassOptions } from './buttonStyles';
/* Re-exported so `import { buttonClasses } from '@/components/Button'` keeps working
   from client components. A *server* component must import from `./buttonStyles`
   directly — pulling a plain function through a `'use client'` module gives a client
   reference, and calling it during render throws. */
export { buttonClasses } from './buttonStyles';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon; hidden from a11y since the label carries the meaning. */
  icon?: ReactNode;
  /** Swaps the icon for a spinner and blocks interaction. */
  loading?: boolean;
  /** Hide the label below `sm`, keeping a square icon-only button. */
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

/** The single button primitive. Its look lives in `./buttonStyles`. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'tonal',
    size = 'md',
    icon,
    loading = false,
    responsiveLabel = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const spinnerTone = variant === 'filled' ? 'on-primary'
    : variant === 'danger' || variant === 'success' || variant === 'warning' ? 'inherit'
    : 'primary';

  /* Below `sm`, `responsiveLabel` puts the label behind `display: none`, which
     removes it from the accessibility tree as well as from layout — so derive an
     accessible name from a string label when the call site gave none. An explicit
     `aria-label` still wins. */
  const derivedLabel =
    responsiveLabel && typeof children === 'string' && !rest['aria-label']
      ? children
      : rest['aria-label'];

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      /* Always present, never conditional on `disabled`. The attribute is what
         gives this element its positioning and clipping; dropping it when the
         button becomes disabled un-positions the ripple *currently animating*,
         which reflows to the initial containing block and finishes in the
         top-left corner of the page — reachable from a single click on any
         button whose handler sets `loading`. `RippleLayer` already refuses to
         spawn on a disabled target, so the gate belongs there and only there. */
      data-ripple=""
      className={buttonClasses({
        variant,
        size,
        responsiveLabel,
        fullWidth,
        disabled: isDisabled,
        className,
      })}
      {...rest}
      aria-label={derivedLabel}
    >
      {loading ? (
        <Spinner size="sm" tone={spinnerTone} />
      ) : (
        icon && (
          <span aria-hidden="true" className="shrink-0 [&>svg]:block">
            {icon}
          </span>
        )
      )}
      {children && (
        <span className={responsiveLabel ? 'max-sm:hidden' : undefined}>{children}</span>
      )}
    </button>
  );
});

export default Button;
