import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonContentProps {
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  responsiveLabel?: boolean;
  loading?: boolean;
  busyIcon?: ReactNode;
  children?: ReactNode;
}

/** Shared slots and inner ripple clipping for commands and navigation actions. */
export default function ButtonContent({
  icon,
  trailingIcon,
  responsiveLabel = false,
  loading = false,
  busyIcon,
  children,
}: ButtonContentProps) {
  const hasIcon = Boolean(icon || trailingIcon);
  const replaceLabel = loading && !hasIcon && Boolean(children);
  return (
    <>
      <span data-ripple-host="" aria-hidden="true" />
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:block">
          {loading ? busyIcon : icon}
        </span>
      )}
      {loading && !hasIcon && (
        <span
          aria-hidden="true"
          className={replaceLabel ? 'pointer-events-none absolute inset-0 grid place-items-center' : 'shrink-0'}
        >
          {busyIcon}
        </span>
      )}
      {children && (
        <span className={cn('min-w-0 truncate', responsiveLabel && 'max-sm:hidden', replaceLabel && 'opacity-0')}>
          {children}
        </span>
      )}
      {trailingIcon && (
        <span aria-hidden="true" className={cn('shrink-0 [&>svg]:block', responsiveLabel && icon && 'max-sm:hidden')}>
          {loading && !icon ? busyIcon : trailingIcon}
        </span>
      )}
    </>
  );
}
