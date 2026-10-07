import { picponyPostJson } from './http';

/** The original front end's abort, for a request nobody waits on. */
const VISIT_DEADLINE_MS = 10_000;

/**
 * `POST api.php?action=track_visitor {visitor_id, path}` — no token (a visit is anonymous),
 * `keepalive` so a count sent as the tab goes away still leaves, bounded at ten seconds. Fire and
 * forget: it resolves whatever happened, never rejects, and nothing reads its answer.
 */
export async function trackVisitor(visitorId: string, path: string): Promise<void> {
  try {
    const response = await picponyPostJson(
      'track_visitor',
      { visitor_id: visitorId, path },
      { keepalive: true, cache: 'no-store', timeoutMs: VISIT_DEADLINE_MS },
    );
    void response.body?.cancel().catch(() => {});
  } catch {
    /* A count that did not arrive is a count, not an event. */
  }
}
