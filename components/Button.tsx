'use client';

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import Spinner from './Spinner';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';
import { cn } from '@/lib/utils';

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
  /** Trailing icon, such as a disclosure arrow; uses the same sized slot. */
  trailingIcon?: ReactNode;
  /**
   * Busy: the action is running. The glyph becomes `busyIcon`, the control keeps its
   * material, ink, footprint — and focus — and a press does nothing (see
   * `blockActivation`). Native `disabled` is for a control that is *unavailable*.
   */
  loading?: boolean;
  /**
   * What stands in the icon slot while `loading`. Defaults to the circular indicator; a
   * busy state with a motion of its own passes it here — `LoadMoreButton`'s dots.
   */
  busyIcon?: ReactNode;
  /** Hide the label below `sm`, keeping a square icon-only button. */
  responsiveLabel?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

/**
 * A busy control blocks activation instead of becoming `disabled`, because a disabled
 * element gives up focus: measured in Edge, a keyboard user who pressed a busy button was
 * dropped onto `<body>` and stayed there after it re-enabled, so the next Enter did
 * nothing. So the element stays focusable (`aria-disabled` + `aria-busy` say it is busy)
 * and the press is cancelled here: no default action — a busy submit does not submit
 * again, including through implicit submission from a field — and no bubbling, which is
 * what a disabled button's click never did either.
 */
export function blockActivation(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

/** The single button primitive. Its look lives in `./buttonStyles`. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'tonal',
    size = 'md',
    icon,
    trailingIcon,
    loading = false,
    busyIcon,
    responsiveLabel = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const hasIcon = Boolean(icon || trailingIcon);
  const replaceLabel = loading && !hasIcon && Boolean(children);
  // A busy action retains its own ink and container; only its glyph changes.
  const spinner = busyIcon ?? <Spinner size={size === 'lg' ? 'md' : 'sm'} tone="inherit" />;

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
      /* `button` unless the call site asks for `submit`, as `IconButton`: a `<button>` in a form
         submits it by default, and a command that happened to sit inside a form — the group
         editor's 待定标签库 — saved the group and closed the editor on every press. */
      type={type}
      /* Busy wins over unavailable: a press that starts a request while another lock is held
         made `loading && disabled`, and native `disabled` then dropped the focus busy exists to
         keep (G4-019). The busy state blocks activation by itself. */
      disabled={disabled && !loading}
      /* Always present, never conditional on `disabled`. The attribute is what
         gives this element its positioning; dropping it when the button becomes
         disabled un-positions the ripple *currently animating*, which reflows to the
         initial containing block and finishes in the top-left corner of the page —
         reachable from a single click on any button whose handler sets `loading`.
         `RippleLayer` already refuses to spawn on a disabled or busy target, so the
         gate belongs there and only there.
         `inner`: the wave is clipped by the host span below, not by this box, so the
         48px `touch-target` around a 40 or 32dp button is not clipped out of
         hit-testing with it. */
      data-ripple="inner"
      className={buttonClasses({
        variant,
        size,
        responsiveLabel,
        fullWidth,
        disabled: disabled || loading,
        loading,
        className,
      })}
      {...rest}
      onClick={loading ? blockActivation : onClick}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      aria-label={derivedLabel}
      aria-busy={loading || rest['aria-busy'] || undefined}
    >
      <span data-ripple-host="" aria-hidden="true" />
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:block">
          {loading ? spinner : icon}
        </span>
      )}
      {loading && !hasIcon && (
        /* A text-only action keeps its own footprint while busy. Adding a new
           leading slot moves every neighbour in a dialog's action row. */
        <span
          aria-hidden="true"
          className={replaceLabel ? 'pointer-events-none absolute inset-0 grid place-items-center' : 'shrink-0'}
        >
          {spinner}
        </span>
      )}
      {children && (
        /* Opacity preserves both the measured label and the button's name. */
        <span className={cn('min-w-0 truncate', responsiveLabel && 'max-sm:hidden', replaceLabel && 'opacity-0')}>
          {children}
        </span>
      )}
      {trailingIcon && (
        <span
          aria-hidden="true"
          className={cn('shrink-0 [&>svg]:block', responsiveLabel && icon && 'max-sm:hidden')}
        >
          {loading && !icon ? spinner : trailingIcon}
        </span>
      )}
    </button>
  );
});

export default Button;
