import { notFound } from 'next/navigation';
import FolderScreen from './FolderScreen';

/**
 * One of your own favourite folders. The folder's id comes from this route's own params, handed
 * down — never `useParams()`, which follows the foreground and would read the picture's id while a
 * picture opened from this folder is over it (AGENTS: a background route owns its parameters).
 * Everything else is token-gated and read in the browser.
 */
export default async function FavoriteFolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folderId = Number(id);
  if (!Number.isSafeInteger(folderId) || folderId <= 0) notFound();
  return <FolderScreen folderId={folderId} />;
}
