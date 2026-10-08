import type { Metadata } from 'next';

/* The page is a client component, which cannot export metadata; without a title of its own the
   tab read the root default. A layout is the one server file that can carry it. */
export const metadata: Metadata = { title: '声明与政策' };

export default function PolicyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
