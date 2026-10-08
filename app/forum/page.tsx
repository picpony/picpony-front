import { redirect } from 'next/navigation';

/** The forum list has one owner: the home route's forum tab. */
export default function ForumPage() {
  redirect('/?tab=forum');
}
