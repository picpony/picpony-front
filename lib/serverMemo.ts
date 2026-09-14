/**
 * A process-local memo for a server read, coalescing concurrent callers.
 *
 * The slot holds the **promise**, not the resolved value: two callers arriving before the first
 * fetch lands (e.g. `generateMetadata` and the page render, which Next runs concurrently) must
 * join one in-flight read instead of both fetching. The TTL is stamped when the read *starts*,
 * the conservative direction.
 *
 * It sits in front of Next's Data Cache rather than replacing it. A server read is reached by
 * `<Link>` prefetching too — the footer links to /about from every route, and rendering that RSC
 * payload runs the read. Explicit `next: { revalidate }` overrides upstream `no-store`;
 * this memo additionally coalesces in-flight work (including fetches with an AbortSignal,
 * which opt out of React's fetch memoization) and carries the original seed timestamp.
 *
 * `null` is never retained: a failed read must not pin a failure for the length of the TTL, and a
 * rejection drops the slot for the same reason. Both checks re-read the slot first, so a retry
 * that has already replaced it is left alone.
 */

/**
 * An override for every server-side cache lifetime, in **seconds**, read once at module load.
 *
 * Exists for the harness (`PICPONY_SERVER_MEMO_TTL_MS=0`), and must cover *both* caches in front
 * of these reads or it covers neither: the memo, and Next's Data Cache (which an explicit
 * `revalidate` overrides despite upstream `no-store`, and which persists to disk in
 * `.next/cache/fetch-cache`). Either layer left warm defeats an audit's floor — "a step that read
 * something before must still read something" — because from outside a cache hit and a screen
 * that has stopped loading are the same observation. Zero makes every server read cold; nothing
 * else sets it, and an unparseable value is ignored.
 */
const TTL_OVERRIDE_S = (() => {
  const raw = process.env.PICPONY_SERVER_MEMO_TTL_MS;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n / 1000 : null;
})();

/**
 * The effective lifetime for a server read, in seconds. Pass it to `next: { revalidate }` so the
 * Data Cache and the memo share one clock — and one switch.
 */
export function cacheSeconds(seconds: number): number {
  return TTL_OVERRIDE_S ?? seconds;
}

interface Slot<T> {
  at: number;
  /** False until the load resolves. An unsettled slot is joinable whatever the TTL says. */
  settled: boolean;
  promise: Promise<T | null>;
}

export function createServerMemo<A extends unknown[], T>(options: {
  /** How long a resolved value may be handed out, in ms. Match the client resource's own TTL. */
  ttlMs: number;
  /** Maximum live slots. Oldest insertion is evicted first. Omit for a single-key read. */
  max?: number;
  keyOf: (...args: A) => string;
  load: (...args: A) => Promise<T | null>;
}): ((...args: A) => Promise<T | null>) & { clear: () => void } {
  const { max = 1, keyOf, load } = options;
  const ttlMs = cacheSeconds(options.ttlMs / 1000) * 1000;
  const slots = new Map<string, Slot<T>>();

  const read = (...args: A) => {
    const key = keyOf(...args);
    const hit = slots.get(key);
    /* An **unsettled** slot is joined whatever the TTL says — that is why the slot carries a
       flag. Coalescing onto one in-flight request is de-duplication, not caching: no stale value
       is involved because there is no value yet, so it must survive TTL=0. */
    if (hit && (!hit.settled || Date.now() - hit.at < ttlMs)) return hit.promise;

    const finish = (retain: boolean) => {
      const slot = slots.get(key);
      if (slot?.promise !== promise) return;
      /* `null` is never retained: a failed read must not pin a failure for the TTL. */
      if (retain) slot.settled = true;
      else slots.delete(key);
    };
    const promise: Promise<T | null> = load(...args).then(
      (value) => {
        finish(value !== null);
        return value;
      },
      (error) => {
        finish(false);
        throw error;
      },
    );

    slots.delete(key);
    if (slots.size >= max) slots.delete(slots.keys().next().value!);
    slots.set(key, { at: Date.now(), settled: false, promise });
    return promise;
  };
  return Object.assign(read, { clear: () => slots.clear() });
}
