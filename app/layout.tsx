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
import { COOKIE_KEYS } from '@/lib/constants';
import { PALETTES } from '@/lib/generated/themeColors';

/* Validation lists for the cookie reads below. Spelled out rather than imported from
   `lib/appearance` because that module is client-only — it holds hooks — and this is a
   server component. The types live there; these three strings are the whole overlap. */
const MOTION_TIERS: readonly string[] = ['off', 'reduced', 'standard'];
const MOTION_SPEEDS: readonly string[] = ['fast', 'default', 'slow'];

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
  // `themeColor` is deliberately absent, and its absence is the fix rather than an
  // omission. It used to carry the app bar's two `primary` literals — the app's only
  // unavoidable ones, because Next serialises them into a `<meta name="theme-color">`
  // tag that the browser reads to paint its own chrome *before* any stylesheet exists,
  // where a `var()` resolves to nothing.
  //
  // A static array cannot express ten palettes, and mutating Next's own tag does not
  // survive a client navigation (the App Router re-renders metadata). So the tag is
  // rendered by hand below, from the cookie, out of the values `scripts/palette.mjs`
  // generates — which also retires the hand-copy step that used to follow a re-seed.
  colorScheme: 'light dark',
  // Lets the shell paint under the notch/home indicator; the layout then pays
  // it back with env(safe-area-inset-*) padding at the edges that need it.
  viewportFit: 'cover',
};

/** `{ id: [lightPrimary, darkPrimary] }`, for the pre-paint script to index. */
const BAR_COLORS = JSON.stringify(
  Object.fromEntries(PALETTES.map((p) => [p.id, [p.light.primary, p.dark.primary]])),
);

/* The pre-paint script: the only code that runs before the first paint, and therefore
   the only place a preference can be corrected without a flash of the wrong one.
   The server already applied all five from cookies; this re-applies them from
   localStorage, which is the authority — a user who cleared cookies but not storage, or
   whose cookie is stale, gets the right theme without a repaint.

   **`get()` wraps each read on its own, and that is the whole shape of this script.** It
   used to be one `try` around everything, `s=localStorage` included — and in a browser
   configured to block site data, *touching* `window.localStorage` throws `SecurityError`.
   `catch(e){}` swallowed it and then none of the five attributes were written, nor the
   `theme-color` update: such a user got the light default and `data-motion="standard"`
   whatever the OS said, with no cookie to fall back on either, because cookies are only
   written on an explicit commit. So the OS-derived answers are computed first and each
   stored value is an optional refinement of one. `lib/appearance.ts` wraps its reads
   individually for exactly this reason.

   The keys are spelled out because this is a string, not a module: it cannot import
   `LS_KEYS`. They must stay in step with `lib/constants.ts`, which is why each one is
   named in a comment there. */
const PRE_PAINT = `(function(){
var d=document.documentElement,C=${BAR_COLORS};
var get=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
var q=function(m){try{return matchMedia(m).matches}catch(e){return false}};
var f=get('followSystemPrefersColorScheme');
var k=(f===null||f==='true')?q('(prefers-color-scheme:dark)'):get('darkMode')==='true';
d.classList.toggle('dark',k);
var p=get('picpony_palette');if(!C[p])p='default';d.dataset.palette=p;
var m=get('picpony_motion');
if(m!=='off'&&m!=='reduced'&&m!=='standard')m=q('(prefers-reduced-motion:reduce)')?'reduced':'standard';
d.dataset.motion=m;
var v=get('picpony_motion_speed');d.dataset.motionSpeed=(v==='fast'||v==='slow')?v:'default';
if(get('picpony_entrance_motion')==='off')d.dataset.entrance='off';else delete d.dataset.entrance;
try{var t=document.querySelector('meta[name="theme-color"]');
if(t){t.removeAttribute('media');t.setAttribute('content',C[p][k?1:0]);}}catch(e){}
})();`;

export default async function RootLayout({
  children,
  imageDetail,
}: Readonly<{
  children: React.ReactNode;
  imageDetail: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get(COOKIE_KEYS.sidebarCollapsed)?.value === 'true';
  const darkMode = cookieStore.get(COOKIE_KEYS.darkMode)?.value === 'true';

  /* The three enumerated preferences, validated rather than trusted: a cookie is
     user-editable, and an unknown value in `data-motion` would match no rule and
     silently mean "standard" — which is the one outcome a user who asked for no
     animation must not get by accident. */
  const paletteCookie = cookieStore.get(COOKIE_KEYS.palette)?.value;
  const palette = PALETTES.find((p) => p.id === paletteCookie) ?? PALETTES[0];
  const motionCookie = cookieStore.get(COOKIE_KEYS.motion)?.value;
  const motion = MOTION_TIERS.includes(motionCookie ?? '') ? motionCookie! : 'standard';
  const speedCookie = cookieStore.get(COOKIE_KEYS.motionSpeed)?.value;
  const motionSpeed = MOTION_SPEEDS.includes(speedCookie ?? '') ? speedCookie! : 'default';
  /* Only `'off'` turns entrances off, so a corrupt cookie means "on" — the direction a
     default should fail in for something whose absence is the normal state. */
  const entranceOff = cookieStore.get(COOKIE_KEYS.entranceMotion)?.value === 'off';

  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} h-full antialiased ${darkMode ? 'dark' : ''}`}
      data-palette={palette.id}
      data-motion={motion}
      data-motion-speed={motionSpeed}
      data-entrance={entranceOff ? 'off' : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* No `media`: this reports the scheme the *app* is in, which can differ from the
            OS's. The two media-keyed tags Next used to generate meant that forcing dark
            mode on a light desktop left the browser chrome painted the light colour. */}
        <meta name="theme-color" content={palette[darkMode ? 'dark' : 'light'].primary} />
        {/* The no-JS floor for the motion preference. With scripting off nothing can read
            the stored tier, so the OS query is all there is.
            It keys on `data-motion='standard'` rather than on the attribute's *absence*: the
            layout renders it unconditionally from the cookie, defaulting to `standard`, so a
            `:not([data-motion])` rule — which is what this was — could never match anything.
            Matching the standard tier means "the OS asks for less and nothing has asked for
            even less than that". One blunt rule rather than a copy of the tier block: without
            JS there is no hero flight, no shared axis and no theme wipe to degrade, so what is
            left to stop is the CSS. */}
        <noscript>
          <style>{`@media (prefers-reduced-motion: reduce){html[data-motion='standard'] *,html[data-motion='standard'] *::before,html[data-motion='standard'] *::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important;transition-delay:0ms!important}}`}</style>
        </noscript>
        {/* `type` is spelled out on both of these, and it is the fix for a hydration warning
            rather than decoration. Something in the document — Next's own SSR stream or, more
            likely, a script-management extension — hands the server HTML a
            `type="text/javascript"` that the client render does not produce, and React reports the
            attribute mismatch on every load. Declaring the spec default makes both sides agree and
            changes nothing about how either script executes. */}
        <script type="text/javascript" dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
        <Script id="recaptcha-options" strategy="beforeInteractive" type="text/javascript">
          {`window.recaptchaOptions = { useRecaptchaNet: true };`}
        </Script>
      </head>

      <body className="h-full flex flex-col overflow-hidden">
        <LoadingOverlay />
        <NextTopLoader
          /* `on-primary`, not a literal white. The bar sits along the bottom edge
             of the brand-coloured app bar, so the role it wants is the ink that
             goes on `primary` — which is white today and follows the brand through
             a re-seed *and* through a palette change. It was `#ffffff`.
             The two literals this note used to point at, in `viewport.themeColor`,
             are gone: they are generated now and rendered as a `<meta>` above. */
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
          <AppLayout initialCollapsed={sidebarCollapsed} overlay={imageDetail}>
            {children}
          </AppLayout>
        </AuthProvider>
        <ToastContainer />
        <RippleLayer />
      </body>
    </html>
  );
}
