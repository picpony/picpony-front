'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Spinner from './Spinner';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';

export type { ButtonSize, ButtonVariant, ButtonClassOptions } from './buttonStyles';
/* Re-exported so existing `import { buttonClasses } from '@/components/Button'`
   keeps working from client components. A *server* component must import from
   `./buttonStyles` directly — pulling a plain function through a `'use client'`
   module gives you a client reference rather than the function, and calling it
   during render throws. That is what took `app/not-found.tsx` down. */
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

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      data-ripple={isDisabled ? undefined : ''}
      className={buttonClasses({
        variant,
        size,
        responsiveLabel,
        fullWidth,
        disabled: isDisabled,
        className,
      })}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" white={variant === 'filled' || variant === 'danger'} />
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
