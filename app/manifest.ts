import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * **`theme_color` is deliberately absent**: a static JSON file cannot express eleven
 * palettes, and `app/layout.tsx` already renders `<meta name="theme-color">` from the
 * palette cookie at SSR. `background_color` is safe to fix — it is only painted on the
 * splash screen of a freshly-launched installed app, before any CSS exists to disagree.
 *
 * `display: 'standalone'` rather than `fullscreen`: the app is a browser-shaped thing
 * with links out of it, and taking the status bar away buys nothing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PicPony 小马图库',
    short_name: 'PicPony',
    description: '小马图片浏览与社区',
    start_url: '/',
    display: 'standalone',
    background_color: '#fff8f8',
    lang: 'zh-CN',
    dir: 'ltr',
    orientation: 'any',
    /**
     * **Only 128px, and that is a gap rather than a decision.** The app has no 192/512
     * or `maskable` icon: its only marks are a 128×128 PNG and a 2851×1001 wordmark,
     * and cropping that into a square is a design decision, not a build step. Adding
     * the two PNGs makes this installable with no other change.
     */
    icons: [
      {
        src: '/icon-128.png',
        sizes: '128x128',
        type: 'image/png',
      },
      {
        src: '/favicon.ico',
        sizes: '128x128',
        type: 'image/x-icon',
      },
    ],
  };
}
