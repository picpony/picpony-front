import type { SemanticSearchConfig } from '@/lib/semanticConfig';

export interface SavedSiteStatusPatch {
  maintenance?: boolean;
  semantic?: Partial<SemanticSearchConfig>;
}

const EMPTY: Readonly<SavedSiteStatusPatch> = Object.freeze({});
let snapshot: Readonly<SavedSiteStatusPatch> = EMPTY;
const listeners = new Set<() => void>();

export const getSavedSiteStatus = () => snapshot;
export const getServerSiteStatus = () => EMPTY;
export function subscribeSavedSiteStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Public facts acknowledged by this document, not an admin configuration cache. Only these
 * whitelisted fields are published: no provider URL, credential, permission or other private data.
 * They keep a cached Back navigation from reinstalling old server props; a new document starts
 * with its server answer (`app/search/semantic.server.ts` reads `GET /semantic-searches/settings`,
 * `lib/maintenance.server.ts` the maintenance status). No storage or polling.
 * Call only after an accepted, session-checked mutation.
 */
export function publishSavedSiteStatus(patch: SavedSiteStatusPatch): void {
  if (typeof window === 'undefined') return;
  const next: SavedSiteStatusPatch = { ...snapshot };
  let supplied = false;
  if (typeof patch.maintenance === 'boolean') {
    next.maintenance = patch.maintenance;
    supplied = true;
  }
  if (patch.semantic) {
    const semantic = { ...snapshot.semantic };
    const { availability, estimateMs, timeoutMs } = patch.semantic;
    if (availability === 'on' || availability === 'off' || availability === 'unknown') {
      semantic.availability = availability;
      supplied = true;
    }
    if (typeof estimateMs === 'number' && Number.isFinite(estimateMs) && estimateMs > 0) {
      semantic.estimateMs = estimateMs;
      supplied = true;
    }
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      semantic.timeoutMs = timeoutMs;
      supplied = true;
    }
    if (Object.keys(semantic).length) next.semantic = Object.freeze(semantic);
  }
  if (!supplied) return;
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}
