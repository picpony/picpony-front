import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "找回密码",
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
