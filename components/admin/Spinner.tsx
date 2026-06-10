'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const sizeMap = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
};

export default function Spinner({ size = 'md', label = '加载中...', className = '' }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 ${className}`}>
      <div className={`${sizeMap[size]} border-2 border-primary/30 border-t-primary rounded-full animate-spin`} />
      {label && <span>{label}</span>}
    </div>
  );
}