import { type Metadata } from 'next';

/* The generic name until the thread arrives: the page sets the post's own title then. It is not
   read on the server for this — a thread read counts a view, so the metadata would count every
   visit twice. */
export const metadata: Metadata = {
  title: '帖子',
};

export default function ForumPostLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
