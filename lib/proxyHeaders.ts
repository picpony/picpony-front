/**
 * The header rules the three server hops share (`app/api.php/…`, `app/relay`, `app/upload/submit`)
 * — review P1-F12. They had drifted: one hop dropped the headers its upstream's `Connection` named,
 * another did not, and each kept its own copy of the hop-by-hop list.
 *
 * What stays **per hop** is deliberate and is not here: which cookies travel (only `api.php`
 * forwards any, `backendCookies`), and the extra response headers a hop refuses (`set-cookie` on
 * the anonymous hops, CORS headers echoing our server's own `Origin`). A hop passes those as
 * `extra`.
 *
 * Pure: no Next import, so the VM-loaded route tests can load it as it is.
 */

/** RFC 9110 §7.6.1 hop-by-hop headers, plus the ones a re-encoded body invalidates. */
export const HOP_BY_HOP_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  /* `fetch` has already decoded the body, so its encoding and length no longer describe it. */
  'content-encoding',
  'content-length',
  /* Instructions for a CDN in front of the upstream, not for whoever is in front of us. */
  'cdn-cache-control',
  'vercel-cdn-cache-control',
  /* The upstream's software banner is not ours to advertise. */
  'x-powered-by',
  'server',
]);

/** The header names a message's own `Connection` header declares hop-by-hop, lower-cased. */
export function connectionTokens(headers: Headers): Set<string> {
  return new Set(
    headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  );
}

/**
 * The upstream response's headers a hop may pass on: everything except the hop-by-hop set, what
 * the upstream's own `Connection` names, and the hop's `extra` refusals. `set-cookie` is never
 * copied here — it can repeat, so a hop that forwards cookies appends `getSetCookie()` itself.
 */
export function forwardableResponseHeaders(upstream: Headers, extra: ReadonlySet<string> = new Set()): Headers {
  const named = connectionTokens(upstream);
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (key === 'set-cookie') return;
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key) || extra.has(key) || named.has(key)) return;
    out.set(key, value);
  });
  return out;
}
