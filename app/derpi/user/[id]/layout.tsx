import { type Metadata } from 'next';

/**
 * The document's first title. The account's name arrives with the client's read, and the page
 * names the tab after it then (`page.tsx`); a bare number said nothing about whose page it was.
 */
export const metadata: Metadata = { title: 'Derpibooru 用户' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
