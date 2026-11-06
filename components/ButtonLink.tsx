import Link from 'next/link';
import type { ComponentProps } from 'react';
import ButtonContent, { type ButtonContentProps } from './ButtonContent';
import { buttonClasses, type ButtonClassOptions } from './buttonStyles';

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, 'children' | 'className' | 'scroll'> &
  Pick<ButtonClassOptions, 'variant' | 'size' | 'responsiveLabel' | 'fullWidth' | 'className'> &
  Pick<ButtonContentProps, 'icon' | 'trailingIcon' | 'children'>;

/** A real link with the button's slots, hit area, ripple and shape feedback. */
export default function ButtonLink({
  variant = 'tonal',
  size = 'md',
  responsiveLabel = false,
  fullWidth = false,
  className = '',
  icon,
  trailingIcon,
  children,
  ...rest
}: ButtonLinkProps) {
  const label = rest['aria-label'] ?? (responsiveLabel && typeof children === 'string' ? children : undefined);
  return (
    <Link
      {...rest}
      scroll={false}
      data-ripple="inner"
      aria-label={label}
      className={buttonClasses({ variant, size, responsiveLabel, fullWidth, className })}
    >
      <ButtonContent icon={icon} trailingIcon={trailingIcon} responsiveLabel={responsiveLabel}>
        {children}
      </ButtonContent>
    </Link>
  );
}
