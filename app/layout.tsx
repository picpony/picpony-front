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
import { ImageLineProvider, SpoilerTagsProvider } from '@/components/ImageLineProvider';
import type { ImageLine } from '@/lib/route';
import OfflineBanner from '@/components/OfflineBanner';
import ServiceWorker from '@/components/ServiceWorker';
import { COOKIE_KEYS } from '@/lib/constants';
import { CUSTOM_PALETTE, PALETTES } from '@/lib/generated/themeColors';
import { deriveThemeCached, normalizeCustomSeed, paletteBlocksCss } from '@/lib/paletteRule';
import { inlineRoutePolicyScript, readRoutePolicy } from '@/lib/route.server';

/** The three the cookie may legitimately hold; anything else is treated as absent. */
const IMAGE_LINES: readonly ImageLine[] = ['direct', 'cdn', 'picpony'];

/* Validation lists for the cookie reads below. Spelled out, not imported from
   `lib/appearance` — that module is client-only (it holds hooks), this is a server
   component. The types live there; these three strings are the whole overlap. */
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

// Chinese site, but the family only shipped a Latin face — without this every CJK
// glyph fell back to the OS. `subsets` is deliberately omitted: Google slices this
// family by unicode-range, so there is nothing valid to request and, with no subset,
// nothing to preload — hence `preload: false`. Weights pinned rather than the
// variable axis, which for CJK carries every glyph at every weight.
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
  // `themeColor` deliberately absent — its absence is the fix. It used to carry two
  // `primary` literals (the app's only unavoidable ones): Next serialises them into a
  // `<meta name="theme-color">` the browser reads before any stylesheet exists, where
  // `var()` resolves to nothing. A static array cannot express eleven palettes, and
  // mutating Next's own tag does not survive a client navigation — so the tag is
  // rendered by hand below, from the cookie, using values `scripts/palette.mjs` generates.
  colorScheme: 'light dark',
  // Paints the shell under the notch/home indicator; the layout pays it back with
  // env(safe-area-inset-*) padding at the edges that need it.
  viewportFit: 'cover',
};

/** `{ id: [lightPrimary, darkPrimary] }`, for the pre-paint script to index. */
const BUILT_IN_BAR_COLORS = Object.fromEntries(
  PALETTES.map((p) => [p.id, [p.light.primary, p.dark.primary]]),
);

/**
 * The eleventh palette, resolved from the seed in the cookie: the two
 * `html[data-palette='custom']` blocks land in the first byte, so a user on a
 * custom colour never sees a frame of the default brand. No client-side equivalent
 * exists — the pre-paint script runs before stylesheets and cannot carry HCT, and
 * by the time `lib/paletteLazy.ts` loads the page has painted several times over.
 *
 * A malformed cookie yields null; the pre-paint script's lookup then falls the
 * stored palette back to `default` (both key off the same `BAR_COLORS` object).
 */
function customPalette(seedCookie: string | undefined) {
  const seed = normalizeCustomSeed(seedCookie);
  if (!seed) return null;
  const derived = deriveThemeCached(seed);
  return {
    seed,
    css: paletteBlocksCss(CUSTOM_PALETTE, derived),
    /* `[lightPrimary, darkPrimary]` — the shape the pre-paint script indexes with `k?1:0`. */
    bar: [derived.light.primary, derived.dark.primary] as const,
    /* Four hexes for `<html>`: fill and ink, per scheme. The picker's eleventh chip needs
       the user's colour while another theme is in force, which a token read cannot give.
       Order is `unpackCustomTones`'s in `lib/appearance.ts`. */
    tones: (['light', 'dark'] as const)
      .flatMap((scheme) => [derived[scheme].primary, derived[scheme]['on-primary']])
      .join(' '),
  };
}

/* The pre-paint script: the only code before first paint, so the only place a
   preference can be corrected without a flash of the wrong one. The server applied
   all five from cookies; this re-applies from localStorage (the authority) — a user
   who cleared cookies but not storage, or with a stale cookie, gets the right theme.

   **`get()` wraps each read on its own.** One `try` around everything used to include
   `s=localStorage` — and in a browser blocking site data, *touching* localStorage
   throws `SecurityError`, which the catch swallowed, so none of the five attributes
   nor the theme-color update were written: such a user got the light default with no
   cookie fallback either. So OS-derived answers are computed first and each stored
   value is an optional refinement of one. `lib/appearance.ts` wraps its reads the
   same way for the same reason.

   `C` doubles as the validation list, which makes the custom palette safe here with
   no derivation: it gains a `custom` key only when this request's cookie carried a
   usable seed, so a stored `custom` with nothing rendered for it falls back to
   `default` rather than selecting a palette no stylesheet answers to.

   Keys are spelled out because this is a string, not a module — it cannot import
   `LS_KEYS`; they must stay in step with `lib/constants.ts`. */
const prePaint = (barColors: Record<string, readonly string[]>) => `(function(){
var d=document.documentElement,C=${JSON.stringify(barColors)};
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
  /* Both awaited together: the policy read is timeout-bounded and cached across
     visitors, and `cookies()` already makes this route dynamic, so overlapping costs
     nothing while serialising puts the two latencies end to end. */
  const [cookieStore, routePolicy] = await Promise.all([cookies(), readRoutePolicy()]);
  const sidebarCollapsed = cookieStore.get(COOKIE_KEYS.sidebarCollapsed)?.value === 'true';
  const darkMode = cookieStore.get(COOKIE_KEYS.darkMode)?.value === 'true';

  /* Enumerated preferences validated rather than trusted: a cookie is user-editable,
     and an unknown value in `data-motion` would match no rule and silently mean
     "standard" — the one outcome a user who asked for no animation must not get by
     accident. */
  const paletteCookie = cookieStore.get(COOKIE_KEYS.palette)?.value;
  /* The user's own palette, derived here rather than shipped: `lib/paletteRule.ts` is a
     plain module, so the server can run it and put all sixty declarations in `<head>`. */
  const custom = customPalette(cookieStore.get(COOKIE_KEYS.paletteCustom)?.value);
  const builtIn = PALETTES.find((p) => p.id === paletteCookie) ?? PALETTES[0];
  const onCustom = paletteCookie === CUSTOM_PALETTE ? custom : null;
  const paletteId = onCustom ? CUSTOM_PALETTE : builtIn.id;
  const barColors = custom
    ? { ...BUILT_IN_BAR_COLORS, [CUSTOM_PALETTE]: custom.bar }
    : BUILT_IN_BAR_COLORS;
  const motionCookie = cookieStore.get(COOKIE_KEYS.motion)?.value;
  /* The image line this device is on, so the fifty `<img>` tags render the URLs the client
     wants: without it every card mismatched at hydration for anyone who had changed the
     setting, and React leaves a mismatched attribute alone, so the preference was ignored
     for the whole first screen. `null` on a first visit — with nothing stored, both sides
     compute the defaults. See `components/ImageLineProvider.tsx`. */
  /* The spoiler tags, so the gallery's covers are in the server's own HTML, not appearing
     after hydration. Bounded and split rather than trusted: it is a cookie reaching a
     per-card comparison on fifty cards, and a hostile one is free. 64 tags × 64 chars
     is far above anything the UI produces. */
  const spoilerCookie = cookieStore.get(COOKIE_KEYS.spoilerTags)?.value ?? '';
  const spoilerTags =
    spoilerCookie.length > 4096
      ? []
      : spoilerCookie
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0 && tag.length <= 64)
          .slice(0, 64);

  const imageLineCookie = cookieStore.get(COOKIE_KEYS.imageLine)?.value;
  const imageLine = IMAGE_LINES.includes(imageLineCookie as ImageLine)
    ? (imageLineCookie as ImageLine)
    : null;
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
      data-palette={paletteId}
      data-palette-seed={custom?.seed}
      data-palette-tones={custom?.tones}
      data-motion={motion}
      data-motion-speed={motionSpeed}
      data-entrance={entranceOff ? 'off' : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* The eleventh palette's rules, same shape as `app/theme-palettes.css` and the same
            `paletteBlocksCss`, so the two cannot diverge. A `<style>`, not inline properties on
            `<html>`: an inline style beats every selector including
            `html.dark[data-palette='custom']`, which would leave the dark scheme painting the
            light values. The id is what `applyCustomPalette` finds and replaces. */}
        {custom && <style id="palette-custom">{custom.css}</style>}
        {/* No `media`: this reports the scheme the *app* is in, which can differ from the OS's.
            Next's media-keyed tags meant that forcing dark mode on a light desktop left the
            browser chrome painted the light colour. */}
        <meta
          name="theme-color"
          content={
            onCustom ? onCustom.bar[darkMode ? 1 : 0] : builtIn[darkMode ? 'dark' : 'light'].primary
          }
        />
        {/* The four hosts the first screen cannot draw without, warmed while the HTML parses.
            The app had none of these, so a cold load paid DNS + TLS on each only *after* the
            layout discovered the first `<img>`.

            The three image hosts are `lib/imageLoader.ts`'s ladder in order — PicPony worker,
            CDN, Derpibooru direct. All three warmed, not just the current line: the ladder can
            move between them mid-page, and the second is reached exactly when the first is
            already failing — the worst moment to also pay for a handshake.

            `crossOrigin` on all of them: `next/image`'s optimizer and the font loader fetch
            as CORS/anonymous, and a preconnect whose CORS mode mismatches the request opens a
            second connection instead of being reused.

            No font host — `next/font/google` downloads faces at build time and serves them
            from this origin, so neither `fonts.googleapis.com` nor `fonts.gstatic.com` is
            ever contacted; a preconnect to either would open a socket to an unused host. */}
        <link rel="preconnect" href="https://147052.xyz" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://wsrv.nl" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://derpicdn.net" crossOrigin="anonymous" />
        {/* The no-JS floor for the motion preference: with scripting off the OS query is all
            there is. Keys on `data-motion='standard'` (not the attribute's absence) — the
            layout renders the attribute unconditionally, defaulting to `standard`, so a
            `:not([data-motion])` rule could never match. "The OS asks for less and nothing
            asks for even less than that." One blunt rule rather than a copy of the tier
            block: without JS there is no hero flight, shared axis or theme wipe to degrade,
            so what is left to stop is the CSS. */}
        <noscript>
          <style>{`@media (prefers-reduced-motion: reduce){html[data-motion='standard'] *,html[data-motion='standard'] *::before,html[data-motion='standard'] *::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important;transition-delay:0ms!important}}`}</style>
        </noscript>
        {/* `type` spelled out on both: something in the document (Next's SSR stream or, more
            likely, a script-management extension) hands the server HTML a
            `type="text/javascript"` the client render does not produce, and React reports the
            mismatch on every load. Declaring the spec default makes both sides agree. */}
        <script type="text/javascript" dangerouslySetInnerHTML={{ __html: prePaint(barColors) }} />
        {/* The request-line policy, if the server read one. A plain inline script, not a prop
            into a client component: it must be in force before the first *effect* in the tree
            runs, and effect order across a tree is not something a layout can promise — a
            script in `<head>` runs before hydration. Absent on read failure; `ensureRoutePolicy`
            then fetches it itself (see `lib/route.server.ts`). */}
        {routePolicy && (
          <script
            type="text/javascript"
            dangerouslySetInnerHTML={{ __html: inlineRoutePolicyScript(routePolicy) }}
          />
        )}
        <Script id="recaptcha-options" strategy="beforeInteractive" type="text/javascript">
          {`window.recaptchaOptions = { useRecaptchaNet: true };`}
        </Script>
      </head>

      <body className="h-full flex flex-col overflow-hidden">
        <LoadingOverlay />
        <NextTopLoader
          /* `on-primary`, not a literal white: the bar rides the bottom edge of the
             brand-coloured app bar, so it takes the ink that goes on `primary` — white
             today, following the brand through a re-seed and a palette change. It was
             `#ffffff`. */
          color="var(--md-sys-color-on-primary)"
          initialPosition={0.08}
          crawlSpeed={200}
          /* 4dp — M3's linear progress indicator height. It was 3. */
          height={4}
          crawl={true}
          showSpinner={false}
          /* `--ease-standard` spelled out: `easing` lands in a Web Animations easing
             string, where a failed `var()` silently falls back to `ease` rather than
             erroring — same reason the hero flight and `Popover` spell theirs out. The
             value IS the token's; keep them in step. (`color` can take a `var()`
             because it lands in a style declaration, not an animation string.) */
          easing="cubic-bezier(0.2, 0, 0, 1)"
          speed={200}
        />
        <ImageLineProvider value={imageLine}>
          <SpoilerTagsProvider value={spoilerTags}>
            <AuthProvider>
              <AppLayout initialCollapsed={sidebarCollapsed} overlay={imageDetail}>
                {children}
              </AppLayout>
            </AuthProvider>
          </SpoilerTagsProvider>
        </ImageLineProvider>
        <ToastContainer />
        <RippleLayer />
        <OfflineBanner />
        {/* Both render nothing. The worker registers on an idle callback and controls the
            *next* load, never this one; the banner is inert unless `experimental.useOffline`
            is on. `buildId` versions the worker's caches — a file in `public/` cannot read a
            build-time variable, so it arrives in the registration URL. */}
        <ServiceWorker version={process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'} />
      </body>
    </html>
  );
}
