/**
 * Addresses on derpibooru.org for a Derpibooru account (review P5-F5). Plain module, for the tests.
 *
 * **The site's profile page is keyed by the slug, not the name or the id.** `ProfileController`
 * loads `Users.load_profile(actor, slug)`, and the slug is `Philomena.Slug.slug(name)`: `-` →
 * `-dash-`, `/` → `-fwslash-`, `\` → `-bwslash-`, `:` → `-colon-`, `.` → `-dot-`, `+` → `-plus-`,
 * and a space → `+`. The page linked `/profiles/<encodeURIComponent(name)>`, which is a 404 for
 * every name with one of those characters — a space is the commonest — and its failure state
 * linked `/profiles/<id>`, a slug only an account literally named after a number has. The JSON
 * API (which this app reads the profile from) is the one keyed by id, and it sends the slug.
 */

/** Philomena's reversible slug (`lib/philomena/slug.ex`), in its own order of replacements. */
export function philomenaSlug(name: string): string {
  return name
    .replaceAll('-', '-dash-')
    .replaceAll('/', '-fwslash-')
    .replaceAll('\\', '-bwslash-')
    .replaceAll(':', '-colon-')
    .replaceAll('.', '-dot-')
    .replaceAll('+', '-plus-')
    .replaceAll(' ', '+');
}

/** The account's page: the slug the API sent, else the one its name makes. */
export function derpiProfileUrl(profile: { name: string; slug?: unknown }): string {
  const slug = typeof profile.slug === 'string' && profile.slug ? profile.slug : philomenaSlug(profile.name);
  /* `+` is the slug's own space and is kept; everything else a path segment cannot carry is encoded. */
  return `https://derpibooru.org/profiles/${encodeURIComponent(slug).replaceAll('%2B', '+')}`;
}

/**
 * Where to send a reader when the account could not be read at all: by name, its page; by id —
 * which the site's pages do not take — the account's uploads, the one public view keyed by id.
 */
export function derpiFallbackUrl(routeId: string): string {
  if (/^[1-9]\d{0,15}$/.test(routeId)) return `https://derpibooru.org/search?q=${encodeURIComponent(`uploader_id:${routeId}`)}`;
  return derpiProfileUrl({ name: routeId });
}
