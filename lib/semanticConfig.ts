import { clamp } from '@/lib/utils';
import type { SiteStatusResponse } from '@/lib/types/site';

export interface SemanticSearchConfig {
  availability: 'on' | 'off' | 'unknown';
  estimateMs: number;
  timeoutMs: number;
}

export type SemanticStatus = SiteStatusResponse & {
  semantic_search_enabled?: boolean;
  semantic_search_mode?: string;
  semantic_cloud_enabled?: boolean;
  semantic_cloud_has_key?: boolean;
  semantic_cloud_timeout_ms?: number;
  semantic_search_estimate_ms?: number;
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
export function semanticConfigFrom(data: SemanticStatus): SemanticSearchConfig {
  const mode = data.semantic_search_mode;
  const on = mode === 'legacy' || mode === 'qwen' || (mode === undefined && data.semantic_search_enabled === true);
  const cloud = data.semantic_cloud_enabled === true && data.semantic_cloud_has_key === true;
  const measured = Number(data.semantic_search_estimate_ms);
  const estimateMs = Number.isFinite(measured) && measured >= MEASURED_FLOOR_MS
    ? Math.round(measured)
    : cloud ? CLOUD_ESTIMATE_MS : LOCAL_ESTIMATE_MS;
  const modelTimeout = Number(data.semantic_cloud_timeout_ms);
  const timeoutMs = clamp(
    Math.max(Number.isFinite(modelTimeout) && modelTimeout > 0 ? modelTimeout : DEFAULT_MODEL_TIMEOUT_MS, estimateMs * 2)
      + ROUND_TRIP_MARGIN_MS,
    6000,
    25_000,
  );
  return { availability: on ? 'on' : 'off', estimateMs, timeoutMs };
}
