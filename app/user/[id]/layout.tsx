import { Metadata } from 'next';
import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * The absolute form, not `api.getUserProfile`.
 *
 * That helper builds its URL from `PICPONY_API_BASE`, which is relative so the
 * browser's request goes through the `/api.php` route handler. Node's `fetch`
 * rejects a relative URL, so calling it from here threw `Failed to parse URL`,
 * the `catch` below swallowed it, and this route has served the fallback title
 * on every request since. Nothing else about the call needs the handler — there
 * is no cookie to rewrite on a public profile read — so the server talks to the
 * upstream directly.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const res = await fetch(
      `${PICPONY_API_ORIGIN}${PICPONY_API_BASE}?action=get_user_profile&user_id=${encodeURIComponent(id)}`,
      { next: { revalidate: 300 } },
    );
    if (res.ok) {
      const data = (await res.json()) as { success?: boolean; user?: { username?: string } };
      if (data.success && data.user?.username) return { title: data.user.username };
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
