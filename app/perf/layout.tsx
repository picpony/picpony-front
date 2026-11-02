import type { Metadata } from 'next';

/* The page is a client component, which cannot export metadata; a layout is the one server file
   that can carry the title. */
export const metadata: Metadata = { title: '性能测试' };

export default function PerfLayout({ children }: { children: React.ReactNode }) {
  return children;
}
