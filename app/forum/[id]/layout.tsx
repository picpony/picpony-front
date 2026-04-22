import { Metadata } from "next";

export const metadata: Metadata = {
  title: "帖子详情 - PicPony",
};

export default function ForumPostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {children}
    </div>
  );
}
