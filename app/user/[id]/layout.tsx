import { Metadata } from 'next';
import { readUserProfile } from '@/lib/profile.server';

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * The title, from the same read the page itself is seeded with.
 *
 * This used to make its own `fetch` and use one field of the answer. That was already the right
 * shape in one respect — the absolute origin rather than `api.getUserProfile`, whose relative
 * `PICPONY_API_BASE` makes Node's `fetch` throw `Failed to parse URL`, which the old `catch`
 * swallowed so this route served the fallback title on every request for as long as it existed.
 *
 * What it got wrong was doing it alone: the page then fetched the same record from the browser to
 * draw the same name. `readUserProfile` is memoised, so the two callers cost one upstream read
 * between them, and the second caller hands the record to the client as a seed.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const seed = await readUserProfile(id);
  return { title: seed?.data?.username ?? '个人资料' };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
