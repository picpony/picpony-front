import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '论坛',
};

export default function ForumLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
