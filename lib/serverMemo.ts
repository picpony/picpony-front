/**
 * A process-local memo for a server read, coalescing concurrent callers.
 *
 * Three `.server.ts` modules had written the same eight lines — a `Map`, a TTL test, a cap, and
 * "never memoise a failure" — and all three had the same hole: the entry is only written when the
 * fetch *resolves*, so two callers that arrive before the first one lands both miss and both
 * fetch. That is not a theoretical race. `/user/[id]` has exactly two callers per request —
 * `generateMetadata` and the page — and Next renders them concurrently, so `npm run net:audit`
 * measured the profile's server reads at **two** on a single navigation, which is precisely the
 * duplication the memo was added to remove.
 *
 * So the slot holds the **promise**, not the value. The second caller of a pair joins the first
 * one's fetch instead of starting a second, and the TTL is stamped when the read *starts* rather
 * than when it lands — the conservative direction, since a slow read then has less of its window
 * left rather than more.
 *
 * It sits in front of Next's own Data Cache rather than replacing it. `next: { revalidate }` is a
 * request Next honours only if the upstream does not send `Cache-Control: no-store`, and these
 * backends' headers are not ours to guarantee; every visible `<Link>` has its RSC payload
 * prefetched, and rendering that payload re-runs the read. Without a cache that cannot be
 * overruled from outside, browsing anywhere in the app re-fetches these.
 *
 * `null` is never retained: a failed read must not pin a failure for the length of the TTL, and a
 * rejection drops the slot for the same reason. Both checks re-read the slot first, so a retry
 * that has already replaced it is left alone.
 */

/**
 * An override for every server-side cache lifetime, in **seconds**, read once at module load.
 *
 * It exists for `npm run net:audit`, which sets it to `0`, and it has to cover *both* caches in
 * front of these reads or it covers neither:
 *
 * - the memo below, and
 * - Next's own Data Cache, which is the one that surprised this codebase. `next: { revalidate }`
 *   turned out to be honoured despite the upstream's `Cache-Control: no-store` — an explicit
 *   `revalidate` overrides the heuristic rather than being vetoed by it — and it persists to
 *   **disk**, in `.next/cache/fetch-cache`. So a count measured by the audit was a function of
 *   what previous runs had left there.
 *
 * Either one defeats the audit's **floor** — "a step that read something before must still read
 * something" — in the way that looks exactly like the bug the floor was written to catch: the
 * second journey to open `/` reads nothing on either layer, and from outside a cache hit and a
 * screen that has stopped loading are the same observation.
 *
 * Zero makes every server read cold, which is the path that costs something and therefore the one
 * worth measuring. Nothing else sets it, and an unparseable value is ignored.
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
}): (...args: A) => Promise<T | null> {
  const { max = 1, keyOf, load } = options;
  const ttlMs = cacheSeconds(options.ttlMs / 1000) * 1000;
  const slots = new Map<string, Slot<T>>();

  return (...args: A) => {
    const key = keyOf(...args);
    const hit = slots.get(key);
    /* An **unsettled** slot is joined whatever the TTL says, and that distinction is the whole
       reason the slot carries a flag. Coalescing two callers onto one in-flight request is
       de-duplication, not caching — there is no stale value involved, because there is no value
       yet — so it must survive `PICPONY_SERVER_MEMO_TTL_MS=0`. Without that, the audit measured
       `/user/[id]` at two server reads for one navigation: `generateMetadata` and the page render
       concurrently, and a TTL of zero told the second one to start its own fetch. What ships must
       be what is measured. */
    if (hit && (!hit.settled || Date.now() - hit.at < ttlMs)) return hit.promise;

    const finish = (retain: boolean) => {
      const slot = slots.get(key);
      if (slot?.promise !== promise) return;
      /* `null` is never retained: a failed read must not pin a failure for the length of the TTL,
         and a rejection drops the slot for the same reason. */
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
}
