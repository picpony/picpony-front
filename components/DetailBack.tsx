'use client';

import type { ButtonHTMLAttributes } from 'react';
import { MdArrowBack } from 'react-icons/md';

type DetailBackProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  passive?: boolean;
};

export default function DetailBack({
  passive = false,
  className = '',
  type = 'button',
  title = '返回图库 (Esc)',
  tabIndex,
  'aria-label': ariaLabel = '返回图片列表',
  'aria-hidden': ariaHidden,
  ...props
}: DetailBackProps) {
  return (
    <button
      {...props}
      type={type}
      title={title}
      tabIndex={passive ? -1 : tabIndex}
      aria-label={ariaLabel}
      aria-hidden={passive ? true : ariaHidden}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-100 px-3.5 text-sm font-medium text-primary transition-colors duration-150 hover:bg-slate-200 active:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40 sm:h-10 dark:bg-slate-800 dark:hover:bg-slate-700 dark:active:bg-slate-600 dark:focus-visible:ring-offset-slate-950 ${className}`}
    >
      <MdArrowBack size={20} aria-hidden="true" />
      <span>返回图库</span>
    </button>
  );
}
