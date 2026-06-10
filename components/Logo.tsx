'use client';

interface LogoProps {
  className?: string;
}

export default function Logo({ className = 'w-32 h-auto' }: LogoProps) {
  return (
    <>
      <img
        src="/img/picpony.svg"
        alt="PicPony"
        className={`${className} dark:hidden`}
      />
      <img
        src="/img/picpony-w.svg"
        alt="PicPony"
        className={`${className} hidden dark:block`}
      />
    </>
  );
}
