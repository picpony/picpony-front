import { Metadata, ResolvingMetadata } from 'next';
import { api } from '@/lib/api';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  
  try {
    const res = await api.getUserProfile(id);
    if (res.success && res.user) {
      return {
        title: `${res.user.username}`,
      };
    }
  } catch (error) {
    console.error('Failed to fetch user profile for metadata:', error);
  }

  return {
    title: '个人资料',
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
