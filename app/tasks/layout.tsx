import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "等级与任务",
};

export default function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
