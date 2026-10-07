import { legacySharedImageHref, legacySharedSearchHref } from '@/lib/searchState';
import { legacyFavoritesHref } from '@/lib/favorites';

/**
 * Links inside rendered posts and comments: which stay in the app, and where they lead.
 *
 * A link into PicPony navigates in place, like every other link in the app; one elsewhere opens
 * beside it. Every link used to open a new tab, so a thread linking another thread left the
 * reader with two copies of the app.
 */

/** The site's own hosts: links an author copied from the address bar. */
const SITE_HOSTS = new Set(['picpony.top', 'www.picpony.top']);

/** A path the app renders, as opposed to one of the backend's files or endpoints. */
function isAppPath(path: string): boolean {
  return !/\.(?:php|html?)$/i.test(path) && !/^\/(?:api|uploads|relay)(?:[/.?#]|$)/i.test(path);
}

/**
 * Whether a link belongs to the app — **deterministic**, so the server's HTML and the browser's
 * agree on it (the answer decides an attribute). Root-relative, or on the site's own host.
 */
export function isInternalHref(href: string): boolean {
  if (href.startsWith('/') && !href.startsWith('//')) return isAppPath(href.split(/[?#]/)[0]);
  try {
    const url = new URL(href);
    return /^https?:$/.test(url.protocol) && SITE_HOSTS.has(url.hostname) && isAppPath(url.pathname);
  } catch {
    return false;
  }
}

/**
 * The route a link leads to inside the app, or `null` to let the browser follow it. The original
 * front end's forms are its routes now: a picture (`/#q=id:N`), a shared search or tag group
 * (`/#mode=shared_search…`), a shared folder or privacy space (`/#mode=shared_faves…`,
 * `/#shared_privacy:…`), a thread (`/?post=N`, what its 分享 copied).
 *
 * `origin` is the page's own, read at the event — a link to the origin the app happens to be
 * served from counts as internal there, which `isInternalHref` cannot know on the server.
 */
export function inAppHref(href: string, origin?: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin ?? 'https://picpony.top');
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const own = SITE_HOSTS.has(url.hostname) || (origin !== undefined && url.origin === origin);
  if (!own) return null;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const picture = legacySharedImageHref(url.hash);
    if (picture) return picture;
    const search = legacySharedSearchHref(url.hash);
    if (search) return search;
    const favourites = legacyFavoritesHref(url.hash);
    if (favourites) return favourites;
    const post = url.searchParams.get('post');
    if (post && /^\d{1,10}$/.test(post)) return `/forum/${post}`;
    if (url.pathname === '/index.html') return '/';
  }
  if (!isAppPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A click the browser should keep: another button, a modifier, a new-tab gesture. */
export function isPlainActivation(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
