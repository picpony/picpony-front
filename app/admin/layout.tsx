import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "管理面板",
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}