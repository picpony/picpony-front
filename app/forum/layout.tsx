import { type Metadata } from 'next';

/* A segment that names itself with a plain string passes no template on, so the routes under this
   one read 「帖子」 and 「发布帖子」 with no site name after them. The template is restated here
   for them; `/forum` itself only redirects. */
export const metadata: Metadata = {
  title: {
    template: '%s - PicPony',
    default: '论坛 - PicPony',
  },
};

export default function ForumLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
