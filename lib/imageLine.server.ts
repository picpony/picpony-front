import { cache } from 'react';
import type { ImageLine } from '@/lib/route';
import { readRoutePolicy } from '@/lib/route.server';

/**
 * The image line a server render puts its `<img>` and `<video>` URLs on — the one answer the
 * layout (for `ImageLineProvider`) and the home page (for its seeded rows) must share, so that
 * the HTML, the hydrating render and the rows' own URLs all agree.
 *
 * **A forced policy first, then the device's cookie, then nothing.** The policy is the
 * administrator's and "a forced line is not ours to leave" (AGENTS.md, Request lines); the
 * cookie is only the device's own choice under `auto`. The cookie alone was the old answer, and
 * on a first visit under a forced policy the server rendered the defaults while the client
 * rendered the forced line: a hydration mismatch React does not patch, so the whole first
 * screen downloaded through the line the policy forbids. `null` means "the defaults", which
 * both sides compute identically.
 */

const IMAGE_LINES: readonly ImageLine[] = ['direct', 'cdn', 'picpony'];

const asLine = (value: string | null | undefined): ImageLine | null =>
  IMAGE_LINES.includes(value as ImageLine) ? (value as ImageLine) : null;

/**
 * The route policy, read once per request however many server components ask. The read opts
 * out of `fetch` memoisation (it carries an abort signal for its timeout), so the layout and a
 * page each calling it would send it twice on a cache miss.
 */
export const readRoutePolicyOnce = cache(readRoutePolicy);

export function ssrImageLine(
  policy: { image: string } | null,
  cookieLine: string | undefined,
): ImageLine | null {
  return asLine(policy?.image) ?? asLine(cookieLine);
}
