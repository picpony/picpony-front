import { type Metadata } from 'next';

/* Whose space it is comes from a read the screen makes; it names the document once it lands. */
export const metadata: Metadata = {
  title: '隐私空间',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
