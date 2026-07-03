import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "发布图片",
};

export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
