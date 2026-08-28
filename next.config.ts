import type { NextConfig } from "next";

/**
 * One id per build, inlined into the client bundle.
 *
 * It names the service worker's static cache. A file in `public/` cannot read a build-time
 * variable, so `components/ServiceWorker.tsx` passes this in the registration URL
 * (`/sw.js?v=…`) — which is also what makes the browser byte-compare the worker and find a new
 * one, since the file's own bytes never change.
 *
 * A fresh value per build is the correct behaviour rather than a wasteful one: a new build means
 * new content-hashed chunk URLs, so the previous generation has nothing left to serve.
 * `picpony-images` is deliberately *not* versioned — an optimised image is keyed on a URL that
 * already contains its source id and transforms, so it stays valid across deploys.
 *
 * `NEXT_PUBLIC_BUILD_ID` may be set by CI to something meaningful (a commit sha); the timestamp
 * is the fallback.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? Date.now().toString(36);

const nextConfig: NextConfig = {
  output: 'standalone',
  /**
   * Automatic memoisation. Enabled last, deliberately, so that anything it breaks is attributable
   * to it rather than to the SSR seams or the lazy-motion split that landed before it.
   *
   * The risk surface here is not the usual one. Three render-phase writes exist on purpose and
   * each is guarded by an **identity** comparison — `lib/resource.ts`'s `setRetained` against
   * `snapshot.data`, and `AppLayout`'s drawer state — so a memoised snapshot that changed
   * identity for an unchanged value would loop rather than merely re-render. The other is
   * `useGSAP`'s `dependencies` array, which is a runtime argument the compiler does not model
   * while still memoising the values fed into it: change how often those identities change and
   * you change how often the GSAP context is disposed, which is the "accumulated Observer" bug
   * this repo has already had once. `lib/motion.ts` and `components/Sheet.tsx` are the two files
   * that pass hand-tuned dependency lists, and both carry `'use no memo'` for the first release.
   *
   * `RouteCrossFade` is *not* a risk: it is a class component, which the compiler does not touch,
   * so `getSnapshotBeforeUpdate` is out of scope.
   *
   * **What it buys, measured** (`Performance.getMetrics` deltas, median of 9, headless Edge):
   * a tab switch's `ScriptDuration` falls 0.076s → 0.062s, **−18%**; a cold load of `/` rises
   * 0.211s → 0.223s, +6%. That is the shape memoisation always has — the first render pays to
   * fill 356 memo caches and every render after it collects — and the trade is taken because a
   * cold load happens once while the interactions happen all session. A 5-sample run of the same
   * probe reported the cold regression at +33%; it is noise at that sample size, which is worth
   * knowing before anyone re-measures and panics.
   */
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  experimental: {
    optimizePackageImports: ['react-icons/md'],
    /**
     * A navigation, prefetch, RSC fetch or Server Action interrupted by a connectivity drop stays
     * **pending and retries** when the network returns, instead of throwing.
     *
     * It is the half `public/sw.js` cannot do: the worker only sees requests the page makes
     * through it and cannot resume anything, and `useOffline` only lives inside a document that
     * is already loaded. Together they cover both cases — a drop mid-session, and a hard refresh
     * with nothing on the wire. `app/loading.tsx` already exists, which
     * `offline-support.md` names as what makes this work without Cache Components.
     */
    useOffline: true,
    /**
     * **`turbopackRustReactCompiler` is off, and that is a measurement rather than caution.**
     *
     * The Rust port (v16.3.0) is the obvious choice — native inside Turbopack, no Babel plugin to
     * install. Next reports it as enabled and the build succeeds. It then emits **nothing**:
     * counted in the built client chunks, the memo-cache call sites go from 356 with the Babel
     * transform to **0** with the Rust one, and the only `useMemoCache` references left are
     * React's own runtime definitions. A compiler that silently optimises no files is worse than
     * one that is off, because the flag says otherwise.
     *
     * The check is one line and worth repeating after any Next upgrade:
     *
     *     cat .next/static/chunks/*.js | grep -oE '[(]0,[a-zA-Z_$]+[.]c[)][(][0-9]+[)]' | wc -l
     *
     * Non-zero means the compiler ran. Re-test the Rust port when it leaves experimental.
     */
    // turbopackRustReactCompiler: true,
  },
  allowedDevOrigins: [
    '127.0.0.1',
    '.trae.cn',
    'run-agent-6a2d3ff6b85ce4091d8a7232-mqca1293-preview.agent-sandbox-bj-a1-gw.trae.cn',
    '171.100.154.38',
    'dev.muyni.dpdns.org',
    '192.168.31.153',
    '100.104.103.23',
    '192.168.31.36'
  ],
  // /api.php is proxied by app/api.php/[[...path]]/route.ts rather than a
  // rewrite: the backend's session cookie is marked Secure, and only a route
  // handler can rewrite that header when the page is served over plain HTTP.
  async redirects() {
    return [
      {
        source: '/forum',
        destination: '/?tab=forum',
        permanent: false,
      },
    ];
  },
  // 以图搜图 API 走服务端代理，避免 dev.picpony.top → picpony.top 的跨域 CORS。
  // search-api 无状态、不涉及 cookie，rewrites 足矣（区别于 /api.php 的 route handler）。
  /**
   * The service worker must never be cached, and the two failures look identical from outside:
   * the browser satisfying its own update check from the HTTP cache, and the worker itself being
   * stale. `updateViaCache: 'none'` at the registration covers one; this covers the other.
   *
   * `Content-Type` is stated because a worker served as anything but JavaScript is rejected
   * outright, and `public/` is served by whatever sits in front of the app in production.
   */
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/search-api/:path*',
        destination: 'https://picpony.top/search-api/:path*',
      },
    ];
  },
  images: {
    qualities: [75, 82, 88],
    /**
     * 31 days.
     *
     * The default is 4 hours, which is written for images that might change under a stable
     * URL. Nothing here does: every optimized variant is keyed on a Derpibooru CDN URL that
     * carries the image's own id, and a Derpibooru image's bytes never change under its id —
     * a re-upload is a new id. So a 4-hour TTL was re-fetching and re-encoding the same
     * bytes six times a day for a gallery of 50 images per page.
     *
     * The doc's warning about a long TTL — "there is no mechanism to invalidate the cache" —
     * is the reason this is 31 days rather than a year: if a variant ever does need
     * dropping, a month is a tolerable wait and `<distDir>/cache/images` can be deleted.
     *
     * Note this is a *floor*, not the value: the doc states the effective max-age is
     * whichever of this and the upstream `Cache-Control` is larger.
     */
    minimumCacheTTL: 2_678_400,
    /*
     * `formats` is deliberately left at its default of `['image/webp']`.
     *
     * Adding AVIF is the obvious next line and it is not taken, because the trade runs the
     * wrong way for this app. AVIF is ~20-30% smaller than WebP but far more expensive to
     * encode, and this is a self-hosted `output: 'standalone'` server with 50 images on the
     * front page — so every cold variant makes the *first* visitor wait on an encode, which
     * is the exact quantity this whole pass exists to reduce. WebP already captures most of
     * the byte saving at a fraction of the CPU. Revisit if the optimizer ever moves behind a
     * CDN that can absorb the cold cost.
     *
     * `deviceSizes` and `imageSizes` are likewise left at their defaults. Trimming them
     * would raise the optimizer's cache hit rate, but it cannot reduce what any one visitor
     * downloads, and getting it wrong means a tile silently picks a variant a step too large
     * or too small. The call sites' `sizes` values span 32px avatars to a 1216px banner, so
     * the useful range is very nearly the default range already.
     */
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'derpicdn.net',
      },
      {
        protocol: 'https',
        hostname: 'picpony.top',
      },
      {
        protocol: 'https',
        hostname: 'wsrv.nl',
      },
      {
        protocol: 'https',
        hostname: '147052.xyz',
      },
      {
        protocol: 'https',
        hostname: 'qlogo1.store.qq.com',
      },
      {
        protocol: 'https',
        hostname: 'qlogo2.store.qq.com',
      },
    ],
    unoptimized: process.env.NODE_ENV === 'development',
  },
};

export default nextConfig;
