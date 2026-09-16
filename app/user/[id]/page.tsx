import ProfileContent from './ProfileContent';
import { readUserProfile } from '@/lib/profile.server';

/**
 * The server shell for a profile. Only the header moves: `userProfile` is anonymous
 * (`get_user_profile` takes a `user_id`, no token), so it is shareable across visitors
 * and safe to render on the server; the four tabs under it are not, because
 * `userUploads` is keyed on a token and shows the owner more than anyone else.
 *
 * The read is the same one `layout.tsx` uses for the `<title>`, memoised in
 * `lib/profile.server.ts`, so the pair costs one upstream request — and the browser's
 * own copy of it disappears entirely.
 */
export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profileSeed = await readUserProfile(id);
  return <ProfileContent id={id} profileSeed={profileSeed} />;
}
