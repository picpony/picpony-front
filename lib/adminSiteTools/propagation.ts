import { semanticConfigFrom, type SemanticSearchConfig } from '@/lib/semanticConfig';
import { integer, type Row, type Values } from './model';

/** A cloud save changes timing only; a concurrent mode save owns availability. */
export function savedSemanticTiming(values: Values, response: Row, previouslyHadKey: boolean): Pick<SemanticSearchConfig, 'estimateMs' | 'timeoutMs'> {
  const hasKey = typeof response.semantic_cloud_has_key === 'boolean'
    ? response.semantic_cloud_has_key
    : values.semantic_cloud_clear_key === true ? false
      : typeof values.semantic_cloud_api_key === 'string' && values.semantic_cloud_api_key.trim() ? true : previouslyHadKey;
  const measured = response.semantic_search_estimate_ms;
  const config = semanticConfigFrom({
    semantic_cloud_enabled: typeof response.semantic_cloud_enabled === 'boolean' ? response.semantic_cloud_enabled : values.semantic_cloud_enabled === true,
    semantic_cloud_has_key: hasKey,
    semantic_cloud_timeout_ms: integer(response.semantic_cloud_timeout_ms, 500, 30000) ?? Number(values.semantic_cloud_timeout_ms),
    semantic_search_estimate_ms: typeof measured === 'number' || typeof measured === 'string' ? Number(measured) : undefined,
  });
  return { estimateMs: config.estimateMs, timeoutMs: config.timeoutMs };
}
