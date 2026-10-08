import { type Metadata } from 'next';

type Props = {
  params: Promise<{ username: string }>;
};

/* The folder's name comes from an anonymous read the screen makes; the document is named after
   the owner until it lands (`useDocumentTitle` then names the folder). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  let name = username;
  try {
    name = decodeURIComponent(username);
  } catch {
    /* An undecodable segment is shown as it came. */
  }
  return { title: `${name} 的收藏夹` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
