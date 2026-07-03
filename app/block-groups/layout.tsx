import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "屏蔽组",
};

export default function BlockGroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
