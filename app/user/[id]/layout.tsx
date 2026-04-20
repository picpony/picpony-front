import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '个人资料',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
