import { notFound } from 'next/navigation';
import SharedPrivacyScreen from './SharedPrivacyScreen';

/**
 * Somebody's privacy space, behind its password: `/favorites/privacy/<ownerId>`, what a privacy
 * share card links to. The owner's id is this route's own parameter, handed down.
 */
export default async function SharedPrivacyPage({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await params;
  const id = Number(ownerId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return <SharedPrivacyScreen ownerId={id} />;
}
