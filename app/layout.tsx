import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PicPony",
  description: "PicPony Frontend",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-slate-600 text-white flex items-center px-10 border-b border-slate-700 shrink-0">
          <div className="text-xl font-bold">PicPony</div>
        </header>
        
        {/* Body Container */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 bg-slate-50 flex flex-col shrink-0">
            <nav className="flex-1 py-4">
              <Link 
                href="/" 
                className="block px-6 py-3 text-slate-700 bg-slate-100 font-medium border-r-4 border-slate-600"
              >
                主页
              </Link>
            </nav>
          </aside>
          
          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-white p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
