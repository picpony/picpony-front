'use client';

interface LogoProps {
  className?: string;
}

export default function Logo({ className = 'w-32 h-auto' }: LogoProps) {
  return (
    <div className="group relative inline-block">
      {/* Monochrome base (light/dark theme-aware). Stays fully visible; the
          color layer clips in on top, so mouse-out has no fade gap. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, theme toggle via CSS */}
      <img
        src="/img/picpony-b.svg"
        alt="PicPony"
        className={`${className} dark:hidden`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, theme toggle via CSS */}
      <img
        src="/img/picpony-w.svg"
        alt="PicPony"
        className={`${className} hidden dark:block`}
      />

      {/* Color reveal on hover: the full-color logo wipes in left-to-right.
          clip-path interpolates natively for a smooth sweep. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
      <img
        src="/img/picpony.svg"
        alt=""
        aria-hidden="true"
        className={`${className} pointer-events-none absolute inset-0 [clip-path:inset(0_100%_0_0)] transition-[clip-path] duration-[550ms] ease-[var(--ease-decelerate)] group-hover:[clip-path:inset(0_0_0_0)]`}
      />
    </div>
  );
}
