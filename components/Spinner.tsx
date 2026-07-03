'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  className?: string;
  /** For buttons on dark/brand backgrounds — uses white color */
  white?: boolean;
}

const sizeConfig = {
  sm: { width: 20, ring: 3 },
  md: { width: 24, ring: 4 },
  lg: { width: 36, ring: 6 },
  xl: { width: 50, ring: 8 },
};

export default function Spinner({ size = 'md', label, className = '', white = false }: SpinnerProps) {
  const cfg = sizeConfig[size];
  const color = white ? '#ffffff' : 'var(--color-primary)';

  const circle = (
    <div
      className="animate-spin"
      style={{
        width: cfg.width,
        height: cfg.width,
        borderRadius: '50%',
        background: `
          radial-gradient(farthest-side, ${color} 94%, transparent) top/${cfg.ring}px ${cfg.ring}px no-repeat,
          conic-gradient(transparent 30%, ${color})
        `,
        WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${cfg.ring}px), #000 0)`,
        mask: `radial-gradient(farthest-side, transparent calc(100% - ${cfg.ring}px), #000 0)`,
      }}
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
