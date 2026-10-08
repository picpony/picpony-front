import { ProfileMissing } from './ProfileMissing';

/**
 * The profile route's own not-found state — `page.tsx` calls `notFound()` when the backend says
 * the user does not exist, and the island shows the same view when its own read finds out
 * (R7-009). The segment's file rather than the app's 404: "用户不存在" says which thing is missing.
 */
export default function ProfileNotFound() {
  return <ProfileMissing />;
}
