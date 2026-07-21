import type { Metadata } from 'next';
import PicDetail from '@/components/PicDetail';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `#${id}` };
}

export default function InterceptedPicPage() {
  return <PicDetail presentation="overlay" />;
}
