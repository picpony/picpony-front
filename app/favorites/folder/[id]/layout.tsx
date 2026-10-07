import { type Metadata } from 'next';

/* The folder's name is the account's, so the server cannot know it: the screen names the
   document once its list is in (`useDocumentTitle`). */
export const metadata: Metadata = {
  title: '收藏夹',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
