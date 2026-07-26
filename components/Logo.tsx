'use client';

interface LogoProps {
  className?: string;
}

export default function Logo({ className = 'w-32 h-auto' }: LogoProps) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, theme toggle via CSS */}
      <img
        src="/img/picpony.svg"
        alt="PicPony"
        className={`${className} dark:hidden`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, theme toggle via CSS */}
      <img
        src="/img/picpony-w.svg"
        alt="PicPony"
        className={`${className} hidden dark:block`}
      />
    </>
  );
}
