/** PicPony 自有 API 基础路径 (Next.js rewrite to /api.php) */
export const PICPONY_API_BASE = '/api.php';

/** Derpibooru (Trixiebooru) API 基础路径 */
export const DERPIBOORU_API_BASE = 'https://trixiebooru.org/api/v1/json';

/** PicPony 图片代理加速服务器 */
export const PROXY_API_BASE = 'https://picponyapi.147052.xyz/?url=';

/** 搜索引擎图片搜索 API */
export const SEARCH_IMAGE_API = 'https://picpony.top/search-api/api/upload-search';

/** 浏览器 localStorage 中使用的键 */
export const LS_KEYS = {
  contentFilter: 'trixie_content_filter',
  banAnthro: 'trixie_ban_anthro',
  banDiscomfort: 'trixie_ban_discomfort',
  onlyPony: 'trixie_only_pony',
  useCdn: 'trixie_use_cdn',
  usePicponyProxy: 'picpony_use_proxy',
  useApiAccel: 'picpony_api_accel',
  homeSort: 'picpony_default_home_sort',
  searchSort: 'picpony_default_search_sort',
} as const;
