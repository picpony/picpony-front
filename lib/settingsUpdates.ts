/**
 * Serialize cloud patches, including patches from a newly mounted settings screen.
 * Concurrent read/merge/write requests can otherwise restore an older preference.
 * Settled accounts leave the map, so session tokens are not retained indefinitely.
 */
const queues = new Map<string, Promise<unknown>>();

export function queueSettingsUpdate<T>(account: string, update: () => Promise<T>): Promise<T> {
  const previous = queues.get(account) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(update);
  queues.set(account, next);
  void next.finally(() => {
    if (queues.get(account) === next) queues.delete(account);
  }).catch(() => {});
  return next;
}
