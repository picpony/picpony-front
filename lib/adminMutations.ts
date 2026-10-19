import { api, type ApiOptions } from '@/lib/api/http';

export type AdminRow = Record<string, unknown>;

/**
 * A v4 UUID for the backend's `request_id` fields (admin password, upstream credential, assistant
 * providers, maintenance-password rotation): those are typed `Uuid`, so `randomId`'s last-resort
 * timestamp form would be refused. `getRandomValues` exists on plain HTTP too, where
 * `crypto.randomUUID` does not.
 */
export function requestUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One console write against `/api/v1`. Every write carries a fresh `Idempotency-Key`: most admin
 * handlers refuse a write without one (`IDEMPOTENCY_KEY_REQUIRED`) and the rest ignore it. Nothing
 * here retries, so one key per press is the whole contract. A 204 answers `{}`; a refusal throws
 * the transport's `ApiError` (the backend's own `error.message` as its sentence).
 */
export async function adminWrite<T extends object = AdminRow>(method: string, path: string, options: ApiOptions = {}): Promise<T> {
  const data = await api<T | undefined>(method, path, { idempotencyKey: requestUuid(), ...options });
  return (data && typeof data === 'object' ? data : {}) as T;
}
