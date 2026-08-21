import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_SC } from 'next/font/google';
import './globals.css';
import { cookies } from 'next/headers';
import Script from 'next/script';
import AppLayout from '@/components/AppLayout';
import { AuthProvider } from '@/components/AuthModal';
import NextTopLoader from 'nextjs-toploader';
import { ToastContainer } from '@/components/Toast';
import LoadingOverlay from '@/components/LoadingOverlay';
import RippleLayer from '@/components/RippleLayer';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// The site is Chinese but only shipped a Latin face, so every CJK glyph fell
// back to whatever the OS had. `subsets` is deliberately omitted: Google slices
// this family by unicode-range rather than by named subset, so there is nothing
// valid to request — and with no subset there is nothing to preload either,
// hence `preload: false`. Weights are pinned instead of using the variable
// axis, which for CJK carries every glyph at every weight.
const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  variable: '--font-noto-sc',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: {
    template: '%s - PicPony',
    default: '主页 - PicPony',
  },
};

export const viewport: Viewport = {
  // Matches the app bar so the mobile browser chrome blends into the header
  // instead of framing it with a white or black strip.
  //
  // The two literals here are the app's only unavoidable ones, and they are unavoidable
  // rather than tolerated: Next serialises this into a `<meta name="theme-color">` tag,
  // which the browser reads to paint its own chrome *before* any stylesheet exists, so
  // `var(--md-sys-color-primary)` would resolve to nothing. They are `primary` in each
  // scheme and must be re-copied by hand whenever `scripts/palette.mjs` moves the brand
  // — the one place in the app where that is true.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E06C9F' },
    { media: '(prefers-color-scheme: dark)', color: '#CB5B8D' },
  ],
  colorScheme: 'light dark',
  // Lets the shell paint under the notch/home indicator; the layout then pays
  // it back with env(safe-area-inset-*) padding at the edges that need it.
  viewportFit: 'cover',
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
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} h-full antialiased ${darkMode ? 'dark' : ''}`}
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
          /* `on-primary`, not a literal white. The bar sits along the bottom edge
             of the brand-coloured app bar, so the role it wants is the ink that
             goes on `primary` — which is white today and would follow the brand
             through a re-seed. It was `#ffffff`.
             Not "the one raw hex left", which is what this note used to claim:
             `viewport.themeColor` above carries two, and they cannot be anything
             else. This is the last raw hex in a *prop that CSS can reach*. */
          color="var(--md-sys-color-on-primary)"
          initialPosition={0.08}
          crawlSpeed={200}
          /* 4dp, M3's linear progress indicator height. It was 3. */
          height={4}
          crawl={true}
          showSpinner={false}
          /* `--ease-standard` spelled out. `easing` is handed to a Web Animations
             `easing:` string by the library, where a failed `var()` silently falls
             back to `ease` rather than erroring — the same reason the hero flight
             and `Popover` spell theirs out. The value IS the token's; keep them in
             step. (`color` above can take a `var()` because it lands in a style
             declaration, not in an animation string.) */
          easing="cubic-bezier(0.2, 0, 0, 1)"
          speed={200}
        />
        <AuthProvider>
          <AppLayout initialCollapsed={sidebarCollapsed} initialDark={darkMode} overlay={imageDetail}>
            {children}
          </AppLayout>
        </AuthProvider>
        <ToastContainer />
        <RippleLayer />
      </body>
    </html>
  );
}
