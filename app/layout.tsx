import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import AppLayout from "@/components/AppLayout";
import NextTopLoader from 'nextjs-toploader';
import { ToastContainer } from "@/components/Toast";
import LoadingOverlay from "@/components/LoadingOverlay";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s - PicPony",
    default: "主页 - PicPony",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get('sidebarCollapsed')?.value === 'true';
  const darkMode = cookieStore.get('darkMode')?.value === 'true';

  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${darkMode ? 'dark' : ''}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.recaptchaOptions = { useRecaptchaNet: true };`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(function(){var o=document.getElementById('loading-overlay');if(o){o.style.opacity='0';o.style.pointerEvents='none';setTimeout(function(){o.remove()},600)}},2000)`,
          }}
        />
      </head>
      <body className="h-full flex flex-col overflow-hidden">
        <LoadingOverlay />
        <NextTopLoader 
          color="#ffffff"
          initialPosition={0.08}
          crawlSpeed={200}
          height={3}
          crawl={true}
          showSpinner={false}
          easing="ease"
          speed={200}
        />
        <AppLayout initialCollapsed={sidebarCollapsed} initialDark={darkMode}>
          {children}
        </AppLayout>
        <ToastContainer />
      </body>
    </html>
  );
}