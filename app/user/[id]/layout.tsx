import { type Metadata } from 'next';
import { PROFILE_MISSING, readUserProfile } from '@/lib/profile.server';

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * The title, from the same memoised read the page itself is seeded with — the two
 * callers cost one upstream read between them. (It must use the absolute origin rather
 * than `api.getUserProfile`, whose relative base makes Node's `fetch` throw.)
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const seed = await readUserProfile(id);
  if (seed === PROFILE_MISSING) return { title: '用户不存在' };
  return { title: seed?.data?.username ?? '个人资料' };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
