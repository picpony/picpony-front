import { Metadata } from 'next';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `用户 #${id}`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
