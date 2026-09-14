import type { NextConfig } from "next";

/**
 * One id per build, inlined into the client bundle. Names the service worker's static cache: a
 * file in `public/` cannot read a build-time variable, so `components/ServiceWorker.tsx` passes
 * this in the registration URL (`/sw.js?v=…`) — which also makes the browser byte-compare the
 * worker and find a new one, since the file's own bytes never change. A fresh value per build is
 * correct (new chunks make the previous generation useless); `picpony-images` is deliberately
 * *not* versioned — an optimised image is keyed on a URL that already contains its source id and
 * transforms. `NEXT_PUBLIC_BUILD_ID` may be set by CI (a commit sha); the timestamp is the
 * fallback.
 */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? Date.now().toString(36);

const nextConfig: NextConfig = {
  output: 'standalone',
  // Dependencies and source live in this checkout; unrelated parent lockfiles must
  // not change Turbopack's resolution or its file-watching boundary.
  turbopack: { root: __dirname },
  /**
   * Automatic memoisation. Enabled last on purpose, so anything it breaks is attributable to it.
   *
   * Risk surface: render-phase writes exist on purpose and are guarded by *identity*
   * comparisons (`lib/resource.ts`'s `setRetained`, `AppLayout`'s drawer state) — a memoised
   * snapshot that changed identity for an unchanged value would loop. And `useGSAP`'s
   * `dependencies` is a runtime argument the compiler does not model while still memoising the
   * values fed into it; `lib/motion.ts` and `components/Sheet.tsx` carry `'use no memo'` for the
   * first release. `RouteCrossFade` is not a risk (a class component, untouched).
   *
   * Measured (`perf:metrics`, median of 9): a tab switch's script time −18%, a cold load +6% —
   * the usual memoisation shape, and the trade is taken. (A 5-sample run reported the cold
   * regression at +33%; noise at that size.) Cost: +15.8KB brotli on every route.
   */
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  experimental: {
    optimizePackageImports: ['react-icons/md'],
    /**
     * A navigation, prefetch, RSC fetch or Server Action interrupted by a connectivity drop stays
     * **pending and retries** when the network returns — the half `public/sw.js` cannot do (the
     * worker only sees requests the page makes through it and cannot resume anything; `useOffline`
     * only lives inside a loaded document). `app/loading.tsx` already exists, which
     * `offline-support.md` names as what makes this work without Cache Components.
     */
    useOffline: true,
    /**
     * **`turbopackRustReactCompiler` is off, and that is a measurement rather than caution.**
     *
     * The Rust port (v16.3.0) reports as enabled and the build succeeds, but emits **nothing**:
     * memo-cache call sites in the built client chunks go from 356 with the Babel transform to
     * **0** with the Rust one. A compiler that silently optimises no files is worse than one
     * that is off, because the flag says otherwise. The check, one line, worth repeating after
     * any Next upgrade:
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
   * The service worker must never be cached. The two failures look identical from outside: the
   * browser satisfying its own update check from the HTTP cache (covered by
   * `updateViaCache: 'none'` at the registration) and the worker itself being stale (covered
   * here). `Content-Type` is stated because a worker served as anything but JavaScript is
   * rejected outright, and `public/` is served by whatever sits in front of the app.
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
     * 31 days. The default (4 hours) is written for images that might change under a stable URL;
     * nothing here does — every optimized variant is keyed on a Derpibooru CDN URL carrying the
     * image's own id, and a re-upload is a new id. 31 rather than a year because if a variant
     * ever needs dropping, a month is a tolerable wait. Note this is a *floor*: the effective
     * max-age is whichever of this and the upstream `Cache-Control` is larger.
     */
    minimumCacheTTL: 2_678_400,
    /*
     * `formats` deliberately left at its default (`['image/webp']`). AVIF is ~20-30% smaller
     * but far more expensive to encode, and this is a self-hosted server with 50 images on the
     * front page — every cold variant makes the *first* visitor wait on an encode. Revisit if
     * the optimizer ever moves behind a CDN. `deviceSizes`/`imageSizes` likewise left alone:
     * trimming them cannot reduce what any one visitor downloads and risks a tile picking a
     * variant a step off; the call sites span 32px avatars to a 1216px banner, nearly the
     * default range already.
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
