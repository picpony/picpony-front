/** Route payloads can still be starting server reads after the counted browser APIs go quiet. */
export function isRouteRequest(request, type, origin) {
  let url;
  try { url = new URL(request.url); } catch { return false; }
  if (url.origin !== origin) return false;
  return type === 'Document' || url.searchParams.has('_rsc') ||
    Object.entries(request.headers ?? {}).some(([name, value]) => name.toLowerCase() === 'rsc' && String(value) === '1');
}

/** Observes completion, without adding documents or RSC payloads to the API cost. */
export function createStepActivity(origin, idleMs, now = () => performance.now()) {
  const pending = new Set();
  let lastAt = now();
  const touch = () => { lastAt = now(); };
  return {
    touch,
    start(requestId, request, type, counted) {
      if (!counted && !isRouteRequest(request, type, origin)) return;
      pending.add(requestId);
      touch();
    },
    finish(requestId) {
      if (pending.delete(requestId)) touch();
    },
    isQuiet: () => pending.size === 0 && now() - lastAt >= idleMs,
  };
}
