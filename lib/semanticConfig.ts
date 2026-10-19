import { clamp } from '@/lib/utils';

export interface SemanticSearchConfig {
  availability: 'on' | 'off' | 'unknown';
  estimateMs: number;
  timeoutMs: number;
}

/**
 * `GET /api/v1/semantic-searches/settings` (`semantic_search::settings`) — the public switch and
 * the cloud model's timing. `semantic_search_estimate_ms` is `null` until the backend has timed a
 * parse.
 */
export interface SemanticSearchSettings {
  semantic_search_enabled: boolean;
  /** `off` | `legacy` | `qwen` */
  semantic_search_mode: string;
  semantic_cloud_enabled: boolean;
  semantic_cloud_has_key: boolean;
  semantic_cloud_configured: boolean;
  semantic_cloud_timeout_ms: number;
  semantic_search_estimate_ms: number | null;
}

/** What the timing rule reads: the settings' availability and timing fields, any of them absent
 *  for a caller that knows only some (an administrator's cloud save knows no mode). */
export type SemanticTimingInput = Partial<Pick<SemanticSearchSettings,
  'semantic_search_mode' | 'semantic_cloud_enabled' | 'semantic_cloud_has_key' | 'semantic_cloud_timeout_ms'>> & {
  semantic_search_estimate_ms?: number | null;
};

const CLOUD_ESTIMATE_MS = 3500;
const LOCAL_ESTIMATE_MS = 7000;
const MEASURED_FLOOR_MS = 800;
const DEFAULT_MODEL_TIMEOUT_MS = 8000;
const ROUND_TRIP_MARGIN_MS = 2000;

export const UNKNOWN_SEMANTIC_CONFIG: SemanticSearchConfig = {
  availability: 'unknown',
  estimateMs: CLOUD_ESTIMATE_MS,
  timeoutMs: DEFAULT_MODEL_TIMEOUT_MS + ROUND_TRIP_MARGIN_MS,
};

/** The same public timing/availability rule on the server and after an admin save. */
export function semanticConfigFrom(data: SemanticTimingInput): SemanticSearchConfig {
  const mode = data.semantic_search_mode;
  const on = mode === 'legacy' || mode === 'qwen';
  const cloud = data.semantic_cloud_enabled === true && data.semantic_cloud_has_key === true;
  const measured = data.semantic_search_estimate_ms;
  const estimateMs = typeof measured === 'number' && Number.isFinite(measured) && measured >= MEASURED_FLOOR_MS
    ? Math.round(measured)
    : cloud ? CLOUD_ESTIMATE_MS : LOCAL_ESTIMATE_MS;
  const modelTimeout = data.semantic_cloud_timeout_ms;
  const timeoutMs = clamp(
    Math.max(typeof modelTimeout === 'number' && Number.isFinite(modelTimeout) && modelTimeout > 0 ? modelTimeout : DEFAULT_MODEL_TIMEOUT_MS, estimateMs * 2)
      + ROUND_TRIP_MARGIN_MS,
    6000,
    25_000,
  );
  return { availability: on ? 'on' : 'off', estimateMs, timeoutMs };
}
