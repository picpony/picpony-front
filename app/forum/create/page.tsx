'use client';

import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import SignInRequired from '@/components/SignInRequired';
import PostComposer from '@/components/forum/PostComposer';
import ComposerSkeleton from '@/components/forum/ComposerSkeleton';
import { useBackOrParent } from '@/lib/backNavigation';
import { useSession } from '@/lib/hooks';
import { forumPosts } from '@/lib/resources';

/**
 * 发布帖子. In the drawer, so it takes no back affordance of its own (R6-045); 取消 goes back when
 * there is somewhere in the app to go back to and to the forum otherwise, without the server
 * redirect `/forum` costs. Signed out it says what signing in is for, in place (decision 4,
 * R6-041); while the session is still unknown it is the form's own shape.
 *
 * Published, the thread **replaces** this entry: Back from the new post leads to where the writer
 * came from, not to an emptied form (R6-042).
 */
export default function CreateForumPostPage() {
  const router = useRouter();
  const { user, token, ready } = useSession();
  const cancel = useBackOrParent('/?tab=forum');

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="发布帖子" />
      {!ready ? (
        <ComposerSkeleton />
      ) : !token ? (
        <SignInRequired description="登录后即可发布帖子。" />
      ) : (
        <PostComposer
          key={token}
          userId={String(user?.id ?? 'self')}
          token={token}
          onDone={(id) => {
            forumPosts.expire();
            router.replace(`/forum/${id}`, { scroll: false });
          }}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
