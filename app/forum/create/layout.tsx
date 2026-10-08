import type { Metadata } from 'next';

/* The page is a client component, which cannot export metadata; without this the tab read the
   forum section's "论坛". */
export const metadata: Metadata = { title: '发布帖子' };

export default function ForumCreateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
