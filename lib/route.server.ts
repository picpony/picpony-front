import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { SiteStatusResponse } from '@/lib/types/site';
import { cacheSeconds } from '@/lib/serverMemo';
import { readBlockFilters } from '@/lib/blockFilters.server';
import type { BlockFilters } from '@/lib/blockFilters';

/**
 * The route policy, read on the server so a cold load's first request does not wait for it:
 * `proxyFetch` awaits the policy on every call, so without this read the policy fetch would gate
 * the first Derpibooru request of every screen. Inlined into the document, it costs the client
 * nothing and one fewer request.
 *
 * Not a preference in `lib/appearance.ts`'s sense — no cookie, no `<html>` attribute, no
 * pre-paint script; the five appearance preferences are the *device's* and travel in a cookie,
 * this is the *server's* and travels one way. And not allowed to slow the document:
 * `app/layout.tsx` awaits this, so the fetch is bounded and returns `null` on failure — a state
 * the client already handles by fetching the policy itself.
 */

/** How long the document may wait for the policy. Short on purpose: missing the policy costs
 *  one client request, while a slow document costs every visitor the wait. */
const SERVER_POLICY_TIMEOUT_MS = 1500;

/** How long a fetched policy is reused across visitors. The trade: an administrator's line
 *  change takes up to 30s to reach a new page load — affordable because nothing a user can *see*
 *  reads this document, and a broken line is handled by `proxyFetch`'s failover ladder, not by
 *  the policy being seconds fresher. `refreshRoutePolicy()` remains the immediate read. */
const SERVER_POLICY_REVALIDATE_S = 30;

/** The four fields `lib/route.ts` consumes, and nothing else from the document. */
export interface InlineRoutePolicy {
  api: string;
  image: string;
  thirdPartyUrl: string;
  thirdPartyPassApiKey: boolean;
  blockFilters?: BlockFilters;
}

/**
 * The inline script, with `<` escaped: `JSON.stringify` does not touch `<`, so a value
 * containing `</script>` would end the element — and three of the four fields come straight off
 * the wire (the third-party URL is admin-typed), a real path from an editable field into the
 * document. `<` is valid in a JS string literal and inert to the HTML parser. Centralised here
 * so the escape cannot be forgotten.
 */
export function inlineRoutePolicyScript(policy: InlineRoutePolicy): string {
  const json = JSON.stringify(policy).replace(/</g, '\\u003c');
  return `window.__picponyRoutePolicy=${json};`;
}

/** Where the server reads the policy from: `PICPONY_API_ORIGIN` unless overridden, e.g. to
 *  point a deployment at a staging backend or to stub the Node-side fetch for an audit (CDP
 *  stubbing reaches only browser requests, never this one). */
const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export async function readRoutePolicy(): Promise<InlineRoutePolicy | null> {
  const filters = readBlockFilters();
  const fallback = async (): Promise<InlineRoutePolicy> => ({
    /* An empty API policy asks the browser to retry policy loading; it can still use the
       server's public filter definitions for the very first resource key. */
    api: '', image: 'auto', thirdPartyUrl: '', thirdPartyPassApiKey: false,
    blockFilters: await filters,
  });
  try {
    /* The absolute origin, not `PICPONY_API_BASE` alone: that constant is relative (for the
       browser's request path) and Node's `fetch` rejects a relative URL outright. */
    const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_maintenance_status`, {
      /* Through `cacheSeconds`, like the other server reads, so the memo TTL env knob reaches
         this one too — without it the Data Cache can warm behind an audit's back and every
         measured document reads a warm path while the harness reports cold reads. */
      next: { revalidate: cacheSeconds(SERVER_POLICY_REVALIDATE_S) },
      signal: AbortSignal.timeout(SERVER_POLICY_TIMEOUT_MS),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as SiteStatusResponse;
    if (!data?.success) return fallback();
    return {
      api: data.global_api_route_policy ?? 'auto',
      image: data.global_image_route_policy ?? 'auto',
      thirdPartyUrl: data.global_api_third_party_url ?? '',
      thirdPartyPassApiKey: data.global_api_third_party_pass_api_key === true,
      blockFilters: await filters,
    };
  } catch {
    /* A timeout, an offline upstream, an HTML error page — all mean "no policy", which the
       client already treats as "fetch it yourself". Swallowed rather than logged: this runs on
       every cold load of a site whose backend is briefly unhappy. */
    return fallback();
  }
}
