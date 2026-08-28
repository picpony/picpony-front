import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * **`theme_color` is deliberately absent.** A manifest is a static JSON file and this app has ten
 * palettes, so any single value here would be wrong for nine of them — and it would compete with
 * the one owner that can get it right. `app/layout.tsx` renders `<meta name="theme-color">` from
 * the palette cookie at SSR, which is the same reason Next's own `viewport.themeColor` export was
 * removed from this app: a static array cannot express ten palettes, and mutating Next's tag does
 * not survive a client navigation.
 *
 * `background_color` is the default palette's `surface`, and that one is safe to fix: it is only
 * painted on the splash screen of a freshly-launched installed app, before any CSS has run, so
 * there is no palette in force yet to disagree with.
 *
 * `display: 'standalone'` rather than `fullscreen`: the app is a browser-shaped thing with links
 * out of it, and taking the status bar away from an image gallery buys nothing.
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
     * **Only 128px, and that is a gap rather than a decision.** `public/favicon.ico` holds one
     * 128×128 PNG and nothing else; `icon-128.png` is that exact image extracted, not resampled.
     * An install prompt wants 192 and 512, and at least one `maskable`. The app's only other mark
     * is `img/picpony-g.svg`, a 2851×1001 wordmark — cropping or padding that into a square is a
     * design decision, not a build step, so no icon here is invented. Add the two PNGs and this
     * becomes installable with no other change.
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
