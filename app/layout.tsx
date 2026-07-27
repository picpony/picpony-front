import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import Script from "next/script";
import AppLayout from "@/components/AppLayout";
import NextTopLoader from 'nextjs-toploader';
import { ToastContainer } from "@/components/Toast";
import LoadingOverlay from "@/components/LoadingOverlay";
import RippleLayer from "@/components/RippleLayer";

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
  imageDetail,
}: Readonly<{
  children: React.ReactNode;
  imageDetail: React.ReactNode;
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
            __html: `(function(){try{var d=localStorage.getItem('followSystemPrefersColorScheme'),t;t=d===null||d==='true'?window.matchMedia('(prefers-color-scheme:dark)').matches:localStorage.getItem('darkMode')==='true';t?document.documentElement.classList.add('dark'):document.documentElement.classList.remove('dark')}catch(e){}})();`,
          }}
        />
        <Script id="recaptcha-options" strategy="beforeInteractive">
          {`window.recaptchaOptions = { useRecaptchaNet: true };`}
        </Script>
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
          easing="ease-in-out"
          speed={200}
        />
        <AppLayout
          initialCollapsed={sidebarCollapsed}
          initialDark={darkMode}
          overlay={imageDetail}
        >
          {children}
        </AppLayout>
        <ToastContainer />
        <RippleLayer />
      </body>
    </html>
  );
}
