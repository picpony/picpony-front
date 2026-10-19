import { notFound } from 'next/navigation';
import { faveOwnerOf } from '@/lib/favorites';
import SharedFolderScreen from './SharedFolderScreen';

/**
 * Somebody's public favourite folder: `/favorites/shared/<owner>/<folderId>` — the owner `~<id>`
 * (`sharedFolderHref`) or, in an older link, a username; folder 0 is every public folder of
 * theirs. The parameters are this route's own, handed down — never `useParams()`, which follows
 * the foreground while a picture opened from this folder is over it.
 */
export default async function SharedFolderPage({
  params,
}: {
  params: Promise<{ username: string; folderId: string }>;
}) {
  const { username, folderId } = await params;
  const name = safeDecode(username).trim();
  const id = Number(folderId);
  if (!name || !Number.isSafeInteger(id) || id < 0) notFound();
  return <SharedFolderScreen owner={faveOwnerOf(name)} folderId={id} />;
}

/** The router hands the segment back still percent-encoded (as `tagFromSegment` measured), so it
 *  is decoded exactly once. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
