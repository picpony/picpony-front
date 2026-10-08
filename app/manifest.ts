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
    // Generated from the existing square mark by scripts/pwaIcons.mjs.
    // The maskable variant keeps the whole mark inside the circular safe area.
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
