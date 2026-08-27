import { PICPONY_API_BASE, PICPONY_API_ORIGIN } from '@/lib/constants';
import type { SiteStatusResponse } from '@/lib/types/site';

/**
 * The route policy, read on the server so the first request of a cold load does not have to wait
 * for it.
 *
 * `lib/route.ts` used to say there was nothing here for the server to know, because a line only
 * affects `fetch` after hydration and so cannot change the first paint. That is true and it was
 * the wrong test. The policy is not needed *to paint*; it is needed before the first Derpibooru
 * request may be sent, and `proxyFetch` awaits it on every call. Measured with `npm run net:audit`,
 * that made `get_maintenance_status` round 1 on **every screen in the app** — including `/policy`,
 * which reads nothing — and put the home feed's own request in round 2. Against the real upstream
 * on a slow link the gap was over six seconds.
 *
 * Inlined into the document instead, it costs the client nothing and one fewer request.
 *
 * ## Two things this is not
 *
 * It is **not** a preference in `lib/appearance.ts`'s sense: no cookie, no attribute on `<html>`,
 * no pre-paint script. The five appearance preferences are the *device's* and are echoed back to
 * the server in a cookie; this is the *server's* and travels one way.
 *
 * It is **not** allowed to slow the document down. The upstream is reachable and slow — 9s through
 * curl on the machine this was written on — and `app/layout.tsx` awaits this, so an unbounded fetch
 * here would trade a client round trip for a server one and make every page's TTFB the upstream's
 * latency. Hence the timeout, and hence returning `null` rather than throwing: no policy is a state
 * the client already handles, because `ensureRoutePolicy` falls back to fetching it itself.
 */

/**
 * How long the document may wait for the policy.
 *
 * Short on purpose. Missing the policy costs one client request — the behaviour that shipped for
 * as long as this feature has existed — while a slow document costs every visitor the wait,
 * whether or not they ever send a Derpibooru request.
 */
const SERVER_POLICY_TIMEOUT_MS = 1500;

/**
 * How long a fetched policy is reused across visitors.
 *
 * The trade, stated plainly: an administrator pinning the site to one line now takes up to 30
 * seconds to reach a new page load, where the client fetch was fresh on every one. That is
 * affordable because nothing a user can *see* reads this document — `maintenance_mode` is rendered
 * nowhere in the app, only edited in the admin console — and because a line that is actually broken
 * is handled by `proxyFetch`'s failover ladder rather than by the policy being seconds fresher.
 * `refreshRoutePolicy()` remains the immediate read, and /settings still uses it.
 */
const SERVER_POLICY_REVALIDATE_S = 30;

/** The four fields `lib/route.ts` consumes, and nothing else from the document. */
export interface InlineRoutePolicy {
  api: string;
  image: string;
  thirdPartyUrl: string;
  thirdPartyPassApiKey: boolean;
}

/**
 * The inline script, with `<` escaped.
 *
 * `JSON.stringify` escapes quotes and backslashes and **does not touch `<`**, so a value containing
 * `</script>` ends the element and everything after it is markup. Three of the four fields here come
 * straight off the wire from the PicPony backend — `global_api_third_party_url` in particular is a
 * string an administrator types into a form — so this is a real path from an editable field into the
 * document, not a theoretical one. `<` is valid inside a JS string literal and inert to the
 * HTML parser, which closes it whatever the value is.
 *
 * It lives here rather than at the call site so the escape cannot be forgotten by whoever adds a
 * fifth field.
 */
export function inlineRoutePolicyScript(policy: InlineRoutePolicy): string {
  const json = JSON.stringify(policy).replace(/</g, '\\u003c');
  return `window.__picponyRoutePolicy=${json};`;
}

/**
 * Where the server reads the policy from. `PICPONY_API_ORIGIN` unless something overrides it.
 *
 * The override exists for `npm run net:audit`, and it is the one seam that command cannot do
 * without: it stubs the *browser's* requests over CDP, which reaches nothing this module does,
 * because this fetch leaves from Node. Without it the audit could only ever measure the fallback
 * path — the server read failing and the client fetching the policy itself — which is the exact
 * behaviour the inline document exists to replace.
 *
 * It happens also to be the knob you would want to point a deployment at a staging backend, which
 * is why it is a plain origin rather than something test-shaped.
 */
const UPSTREAM_ORIGIN = process.env.PICPONY_UPSTREAM_ORIGIN || PICPONY_API_ORIGIN;

export async function readRoutePolicy(): Promise<InlineRoutePolicy | null> {
  try {
    /* The absolute origin, not `PICPONY_API_BASE` alone. That constant is relative so the
       browser's request goes through `app/api.php/[[...path]]/route.ts`, which rewrites the
       backend's `Secure` session cookie; Node's `fetch` rejects a relative URL outright. This is
       the same trap `app/user/[id]/layout.tsx` documents falling into, and there is no cookie to
       rewrite on a policy read anyway. */
    const res = await fetch(`${UPSTREAM_ORIGIN}${PICPONY_API_BASE}?action=get_maintenance_status`, {
      next: { revalidate: SERVER_POLICY_REVALIDATE_S },
      signal: AbortSignal.timeout(SERVER_POLICY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as SiteStatusResponse;
    if (!data?.success) return null;
    return {
      api: data.global_api_route_policy ?? 'auto',
      image: data.global_image_route_policy ?? 'auto',
      thirdPartyUrl: data.global_api_third_party_url ?? '',
      thirdPartyPassApiKey: data.global_api_third_party_pass_api_key === true,
    };
  } catch {
    /* A timeout, an offline upstream, an HTML error page, a renamed action — all mean "no policy",
       which the client already treats as "fetch it yourself". Swallowed rather than logged, because
       it would log on every cold load of a site whose backend is briefly unhappy. */
    return null;
  }
}
