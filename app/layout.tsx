import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_SC } from 'next/font/google';
import './globals.css';
import { cookies, headers } from 'next/headers';
import Script from 'next/script';
import AppLayout from '@/components/AppLayout';
import MaintenanceScreen from '@/components/MaintenanceScreen';
import { AuthProvider } from '@/components/AuthModal';
import NextTopLoader from 'nextjs-toploader';
import { ToastContainer } from '@/components/Toast';
import RippleLayer from '@/components/RippleLayer';
import { ImageLineProvider, SpoilerTagsProvider } from '@/components/ImageLineProvider';
import ServiceWorker from '@/components/ServiceWorker';
import SettingsSync from '@/components/SettingsSync';
import TagSubscriptionSync from '@/components/subscriptions/TagSubscriptionSync';
import VisitorTracker from '@/components/VisitorTracker';
import LegacySharedSearch from '@/app/search/LegacySharedSearch';
import { COOKIE_KEYS } from '@/lib/constants';
import { CUSTOM_PALETTE, PALETTES } from '@/lib/generated/themeColors';
import { deriveCustomThemeCached, paletteBlocksCss, paletteTones } from '@/lib/paletteRule';
import { packTones, parseCustomSpec } from '@/lib/paletteSpec';
import { inlineRoutePolicyScript } from '@/lib/route.server';
import { readRoutePolicyOnce, ssrImageLine } from '@/lib/imageLine.server';
import { readMaintenance } from '@/lib/maintenance.server';

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

/* **Windows' Chinese face; everywhere else, the last resort.** Apple, HarmonyOS, Android and
   the Linux desktops ship a Chinese UI face worth using, and `--font-han` in globals.css
   reaches it (by name, or through the generic `sans-serif`, which Chromium resolves per script
   under `lang="zh-CN"`), so there this is requested only for a glyph no system face has.
   Windows' only universal face is Microsoft YaHei, so on Windows this leads and YaHei merely
   fills the moment before a slice arrives. A slice is fetched once and then comes from cache.

   `subsets` is deliberately omitted: Google slices this family by unicode-range, so there
   is nothing valid to request and, with no subset, nothing to preload — hence `preload:
   false`. `swap`: on Windows the swap replaces YaHei's glyphs with these at the same advance
   and inside the same fixed line box, so it redraws shapes and moves nothing; elsewhere it can
   only replace a glyph that had no face at all. Weights pinned rather than the variable axis,
   which for CJK carries every glyph at every weight. */
const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  variable: '--font-noto-sc',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  /* The default is the brand, not 主页: a route without a title of its own used to announce
     itself as the home page (/about, /policy and the 404 all read "主页 - PicPony"). */
  title: {
    template: '%s - PicPony',
    default: 'PicPony',
  },
  applicationName: 'PicPony',
  /* The installed-app icons. An iOS home-screen icon must be opaque — a transparent corner
     is filled black — which the maskable variant is; iOS applies its own mask. */
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/icon-maskable-512.png', type: 'image/png', sizes: '512x512' }],
  },
  appleWebApp: {
    capable: true,
    title: 'PicPony',
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
  /* Paints the shell under the notch and the home indicator; the shell pays the insets back
     on every edge that has one — the top chrome, both sides of the app bar, the drawer and
     the content, the home pill's bottom. */
  viewportFit: 'cover',
  /* The on-screen keyboard resizes the layout viewport instead of sliding over it. The shell
     is a fixed-height document (`body` does not scroll), so under the default the keyboard
     covered the bottom of the shell — the chat composer and the reply box among it. */
  interactiveWidget: 'resizes-content',
};

/** `{ id: [lightPrimary, darkPrimary] }`, for the pre-paint script to index. */
const BUILT_IN_BAR_COLORS = Object.fromEntries(
  PALETTES.map((p) => [p.id, [p.light.primary, p.dark.primary]]),
);

/**
 * The eleventh palette, resolved from the spec in the cookie — its seed and its 副色相 (a bare
 * seed, what earlier builds wrote, reads as 自动): the `html[data-palette='custom']` blocks, 多色
 * and 单色, land in the first byte, so a user on a custom colour never sees a frame of the
 * default brand. No client-side equivalent exists — the pre-paint script runs before
 * stylesheets and cannot carry HCT, and by the time `lib/paletteLazy.ts` loads the page has
 * painted several times over.
 *
 * A malformed cookie yields null; the pre-paint script's lookup then falls the
 * stored palette back to `default` (both key off the same `BAR_COLORS` object).
 */
function customPalette(specCookie: string | undefined) {
  const spec = parseCustomSpec(specCookie);
  if (!spec) return null;
  const derived = deriveCustomThemeCached(spec);
  return {
    seed: spec.seed,
    accent: spec.accent === null ? undefined : String(spec.accent),
    css: paletteBlocksCss(CUSTOM_PALETTE, derived),
    /* `[lightPrimary, darkPrimary]` — the shape the pre-paint script indexes with `k?1:0`. */
    bar: [derived.light.primary, derived.dark.primary] as const,
    /* The picker's eleventh tile, for `<html>`: it needs the user's colours while another theme
       is in force, which a token read cannot give. The same packing `applyCustomPalette` writes. */
    tones: packTones(paletteTones(derived)),
  };
}

/* The pre-paint script: the only code before first paint, so the only place a
   preference can be corrected without a flash of the wrong one. The server applied
   all six from cookies; this re-applies from localStorage (the authority) — a user
   who cleared cookies but not storage, or with a stale cookie, gets the right theme.

   **`get()` wraps each read on its own.** One `try` around everything used to include
   `s=localStorage` — and in a browser blocking site data, *touching* localStorage
   throws `SecurityError`, which the catch swallowed, so none of the attributes
   nor the theme-color update were written: such a user got the light default with no
   cookie fallback either. So OS-derived answers are computed first and each stored
   value is an optional refinement of one. `lib/appearance.ts` wraps its reads the
   same way for the same reason.

   `C` doubles as the validation list, which makes the custom palette safe here with
   no derivation: it gains a `custom` key only when this request's cookie carried a
   usable seed, so a stored `custom` with nothing rendered for it falls back to
   `default` rather than selecting a palette no stylesheet answers to — and the shell
   then re-derives it from storage after mount (`recoverCustomPalette`).

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
if(get('picpony_palette_hues')==='mono')d.dataset.paletteHues='mono';else delete d.dataset.paletteHues;
var m=get('picpony_motion');
if(m!=='off'&&m!=='reduced'&&m!=='standard')m=q('(prefers-reduced-motion:reduce)')?'reduced':'standard';
d.dataset.motion=m;
var v=get('picpony_motion_speed');d.dataset.motionSpeed=(v==='fast'||v==='slow')?v:'default';
if(get('picpony_entrance_motion')==='off')d.dataset.entrance='off';else delete d.dataset.entrance;
var P=(navigator.userAgentData&&navigator.userAgentData.platform)||navigator.userAgent||'';
if(/Windows/i.test(P))d.dataset.os='windows';else delete d.dataset.os;
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
  /* Awaited together: the two status reads are timeout-bounded and cached across visitors
     (one document, one Data Cache entry), and `cookies()` already makes this route dynamic,
     so overlapping costs nothing while serialising puts the latencies end to end. */
  const [cookieStore, headerStore, routePolicy, maintenance] = await Promise.all([
    cookies(),
    headers(),
    readRoutePolicyOnce(),
    readMaintenance(),
  ]);
  /* Windows takes a different Chinese face (see the note above `--font-han` in globals.css),
     so the first byte has to know. Chromium states the platform in a default client hint;
     other engines only in the User-Agent. The pre-paint script repeats the test in the
     browser, which is what decides it if a proxy has dropped both headers. */
  const platformHint = headerStore.get('sec-ch-ua-platform');
  const isWindows = platformHint
    ? /windows/i.test(platformHint)
    : /Windows NT/i.test(headerStore.get('user-agent') ?? '');
  /* **Maintenance: the screen for visitors, the app for staff.** The server cannot tell staff
     from a visitor (the session's token lives in the browser), so it goes by the hint the
     client writes from the backend's own answer — see `components/MaintenanceScreen.tsx`,
     which also corrects the hint when it is wrong in either direction. */
  const maintenanceLocked =
    maintenance.active && cookieStore.get(COOKIE_KEYS.maintenanceStaff)?.value !== '1';
  const sidebarCollapsed = cookieStore.get(COOKIE_KEYS.sidebarCollapsed)?.value === 'true';
  const darkMode = cookieStore.get(COOKIE_KEYS.darkMode)?.value === 'true';
  /* Only an explicit dismissal hides the banner, so a missing or corrupt cookie shows it —
     the notice is the default state. */
  const devBannerVisible = cookieStore.get(COOKIE_KEYS.devBannerDismissed)?.value !== 'true';

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

  /* The image line the fifty `<img>` tags are rendered on — **the same answer the client's
     first render will give**. A line an administrator forces beats the device's cookie; the
     cookie decides only under `auto`. With the cookie alone, a forced policy on a first visit
     rendered every card on the proxy line while the client rendered them direct: a hydration
     mismatch React does not patch, fifty downloads through the line the policy forbids, and a
     degrade ladder reasoning about URLs that were not in the DOM. See `lib/imageLine.server.ts`. */
  const imageLine = ssrImageLine(routePolicy, cookieStore.get(COOKIE_KEYS.imageLine)?.value);
  const motion = MOTION_TIERS.includes(motionCookie ?? '') ? motionCookie! : 'standard';
  const speedCookie = cookieStore.get(COOKIE_KEYS.motionSpeed)?.value;
  const motionSpeed = MOTION_SPEEDS.includes(speedCookie ?? '') ? speedCookie! : 'default';
  /* Only `'off'` turns entrances off, so a corrupt cookie means "on" — the direction a
     default should fail in for something whose absence is the normal state. */
  const entranceOff = cookieStore.get(COOKIE_KEYS.entranceMotion)?.value === 'off';
  /* 单色 only on an explicit `mono`: a corrupt cookie means 多色, the default and the CSS's own
     attribute-free state. */
  const mono = cookieStore.get(COOKIE_KEYS.paletteHues)?.value === 'mono';

  return (
    <html
      /* Simplified Chinese, not bare `zh`: it is what picks the Simplified glyph forms and the
         per-script system face (see the font note above), the hyphenation and the voice. */
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} h-full antialiased ${darkMode ? 'dark' : ''}`}
      data-palette={paletteId}
      data-palette-seed={custom?.seed}
      data-palette-accent={custom?.accent}
      data-palette-tones={custom?.tones}
      data-palette-hues={mono ? 'mono' : undefined}
      data-motion={motion}
      data-motion-speed={motionSpeed}
      data-entrance={entranceOff ? 'off' : undefined}
      data-os={isWindows ? 'windows' : undefined}
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
        {/* The three image hosts, warmed while the HTML parses — `lib/imageLoader.ts`'s ladder
            in order (PicPony worker, CDN, Derpibooru direct), all three because the ladder can
            move between them mid-page and reaches the second exactly when the first is already
            failing. **No `crossOrigin`**: every picture here is a plain no-cors `<img>`, a
            credentialed request, and a connection opened in anonymous mode is a different pool
            that such a request cannot reuse — the attribute made each preconnect a socket
            nothing used. (The optimizer's own fetches are the server's, which no browser hint
            can warm.)

            No font host — `next/font/google` downloads faces at build time and serves them
            from this origin, so neither `fonts.googleapis.com` nor `fonts.gstatic.com` is
            ever contacted; a preconnect to either would open a socket to an unused host. */}
        <link rel="preconnect" href="https://147052.xyz" />
        <link rel="preconnect" href="https://wsrv.nl" />
        <link rel="preconnect" href="https://derpicdn.net" />
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
        {/* The request-line policy and the public rules. A plain inline script, not a prop
            into a client component: it must be in force before the first *effect* in the tree
            runs, and effect order across a tree is not something a layout can promise — a
            script in `<head>` runs before hydration. Always present: when the server's policy
            read fails it still carries the public filter rules and blacklist, with an empty
            `api` that makes the browser load the policy itself — holding no request more than
            2s for it (see `lib/route.server.ts` and `ensureRoutePolicy`). */}
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{ __html: inlineRoutePolicyScript(routePolicy) }}
        />
        <Script id="recaptcha-options" strategy="beforeInteractive" type="text/javascript">
          {`window.recaptchaOptions = { useRecaptchaNet: true };`}
        </Script>
      </head>

      {/* **No splash.** What the server rendered is what the first paint shows: an opaque
          overlay held it back until the shell hydrated — 6–10s on a slow phone, forever with
          scripting off — although the first page of content was already in the first byte.
          The app bar's mark writes itself on once instead (`Logo introOnce`), over a screen
          that is already usable, and client-rendered routes show their own skeletons. */}
      <body className="h-full flex flex-col overflow-hidden">
        <NextTopLoader
          /* Rides the chrome's bottom edge (`--app-chrome-bottom`, set in globals.css), where
             M3 puts a top app bar's linear indicator — and so below the dev banner and the
             offline banner too, which is where it has to be seen while a navigation waits
             for the network. On the surface under the bar, not on the bar, so it takes the
             brand's *ink* tone, which is the one tuned to read on that surface; it was the
             bar's own ink drawn at the top of the window, invisible over the dev banner. */
          color="var(--md-sys-color-primary-ink)"
          initialPosition={0.08}
          crawlSpeed={200}
          /* 4dp — M3's linear progress indicator height. It was 3. */
          height={4}
          crawl={true}
          showSpinner={false}
          /* M3's indicator has no glow. */
          shadow={false}
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
              {maintenanceLocked ? (
                /* Neither the page nor the image slot is rendered, so no route starts a read
                   the backend is refusing. */
                <MaintenanceScreen message={maintenance.message} />
              ) : (
                <AppLayout
                  initialCollapsed={sidebarCollapsed}
                  initialScheme={darkMode ? 'dark' : 'light'}
                  devBannerVisible={devBannerVisible}
                  maintenance={maintenance.active}
                  overlay={imageDetail}
                >
                  {children}
                </AppLayout>
              )}
            </AuthProvider>
          </SpoilerTagsProvider>
        </ImageLineProvider>
        <ToastContainer />
        <RippleLayer />
        {/* Renders nothing. The worker registers on an idle callback and controls the *next*
            load, never this one. `buildId` versions the worker's caches — a file in `public/`
            cannot read a build-time variable, so it arrives in the registration URL. */}
        <ServiceWorker version={process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'} />
        {/* Renders nothing: an original-front-end shared-search link, sent on to /search. */}
        <LegacySharedSearch />
        {/* Renders nothing: the settings sync, which writes to the account — not under maintenance. */}
        {!maintenanceLocked && <SettingsSync />}
        {/* Renders nothing: the tag-subscription sync, which writes to the account too. */}
        {!maintenanceLocked && <TagSubscriptionSync />}
        {/* Renders nothing: the visit count — production builds only (`lib/visitor.ts`). */}
        <VisitorTracker />
      </body>
    </html>
  );
}
