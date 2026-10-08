/**
 * A promise's outcome as a value: `{ ok: true, value }` or `{ ok: false, error }`. Never rejects.
 *
 * It exists for event handlers inside components. The React Compiler lowers neither a `try` with
 * a `finally` nor a conditional, a `&&` or an optional chain inside a `try` block, and either one
 * makes it skip the **whole** component — every render then rebuilds its subtree. A handler that
 * awaits `settle(work)` and branches on `ok` has no `try` at all, so the screen stays compiled.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error };
  }
}
