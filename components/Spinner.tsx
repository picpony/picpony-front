'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /** For buttons on dark/brand backgrounds — uses white border */
  white?: boolean;
}

const sizeMap: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'w-4 h-4 border-2',
  md: 'w-5 h-5 border-2',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-12 h-12 border-[4px]',
};

export default function Spinner({ size = 'md', label, className = '', white = false }: SpinnerProps) {
  const circle = (
    <div
      className={`rounded-full animate-spin ${
        white
          ? 'border-white/30 border-t-white'
          : 'border-slate-300/50 dark:border-white/30 border-t-primary dark:border-t-pink-300'
      } ${sizeMap[size]} ${className}`}
    />
  );

  if (label !== undefined) {
    return (
      <div className={`flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 ${className}`}>
        {circle}
        {label && <span className={white ? 'text-white' : ''}>{label}</span>}
      </div>
    );
  }

  return circle;
}
