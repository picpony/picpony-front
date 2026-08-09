'use client';

import { getTagTranslations } from '@/lib/api/picpony';

/**
 * 词库中文翻译的批量加载与缓存（对应旧前端 `applyTagTranslations` 的
 * `get_tag_translations` 接口）。词库的 en 存的是不带命名空间前缀的纯标签名
 * （接口验证：`character:trixie` 查不到、`trixie` 查得到），所以查询与缓存
 * 的 key 统一剥离 `xxx:` 前缀并转小写。
 *
 * 与 `tagCounts` 不同，未翻译的标签（miss）也会缓存，但 TTL 短得多：
 * 计数 miss 通常是查询失败，翻译 miss 则是"词库确实没有"这一稳定状态，
 * 而词库翻译率只有约 2%——不缓存 miss 意味着每次打开详情页都要把整张图
 * 的标签重新 POST 一遍。
 */

const CACHE_KEY = 'picpony_tag_translations_v1';
const CACHE_LIMIT = 2000;
const CACHE_EVICT = 500;
/** 已翻译条目几乎不变；未翻译条目可能被社区补上，一天后重试。 */
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/** 单次请求上限，与旧前端一致。 */
const BATCH_SIZE = 500;

interface CacheEntry {
  /** 中文翻译；null 表示词库未收录。 */
  c: string | null;
  /** 获取时间，用于上面的 TTL。 */
  t: number;
}

let cache: Map<string, CacheEntry> | null = null;

function store(): Map<string, CacheEntry> {
  if (cache) return cache;
  cache = new Map();
  if (typeof window === 'undefined') return cache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const now = Date.now();
      for (const [tag, entry] of Object.entries(JSON.parse(raw) as Record<string, CacheEntry>)) {
        const ttl = entry.c ? HIT_TTL_MS : MISS_TTL_MS;
        if (entry && typeof entry.c === 'string' && now - entry.t < ttl) {
          cache.set(tag, entry);
        }
      }
    }
  } catch {
    /* 缓存损坏就当冷启动。 */
  }
  return cache;
}

function persist() {
  const entries = store();
  /* 插入序即最旧在前，从头部丢弃即旧前端同款 FIFO。 */
  if (entries.size > CACHE_LIMIT) {
    let toDrop = entries.size - CACHE_LIMIT + CACHE_EVICT;
    for (const key of entries.keys()) {
      if (toDrop-- <= 0) break;
      entries.delete(key);
    }
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 超出配额：缓存只是优化，不是状态。 */
  }
}

/** 剥离命名空间前缀：`artist:xxx` → `xxx` */
function stripNamespace(tag: string): string {
  const colon = tag.indexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}

/** 请求在途的翻译，使并发调用合并到同一次请求。 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * 各标签的中文翻译，key 为剥离前缀后的小写名；词库未收录的标签对应 null
 * （与 `tagCounts` 的 null 语义一致：null 也是"已查询过"的结果，调用方据此
 * 停止追问，避免一张全未翻译的图反复触发请求）。
 *
 * `onPartial` 会在每组结果到达时被调用（缓存命中在下一微任务、请求逐批），
 * 让画面先拿到手头已有的翻译。
 */
export async function loadTagTranslations(
  tags: string[],
  onPartial?: (translations: Record<string, string | null>) => void,
): Promise<Record<string, string | null>> {
  const entries = store();
  const cached: Record<string, string> = {};
  const joined: { tag: string; translation: Promise<string | null> }[] = [];
  const missing: string[] = [];
  const claimed = new Set<string>();

  for (const tag of tags) {
    const key = stripNamespace(tag).toLowerCase();
    const hit = entries.get(key);
    if (hit?.c) {
      cached[key] = hit.c;
      continue;
    }
    const existing = inFlight.get(key);
    if (existing) {
      joined.push({ tag: key, translation: existing });
      continue;
    }
    if (claimed.has(key)) continue;
    claimed.add(key);
    missing.push(key);
  }

  const groups: Promise<Record<string, string | null>>[] = [];

  if (Object.keys(cached).length > 0) groups.push(Promise.resolve(cached));

  if (joined.length > 0) {
    groups.push(
      Promise.all(
        joined.map(({ tag, translation }) => translation.then((t) => [tag, t] as const)),
      ).then((pairs) => Object.fromEntries(pairs)),
    );
  }

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const request = getTagTranslations(batch)
      .then((data) => (data?.success && data.translations ? data.translations : {}))
      .catch(() => ({}));

    void request.then((translations) => {
      const now = Date.now();
      let stored = false;
      for (const tag of batch) {
        entries.set(tag, { c: translations[tag] ?? null, t: now });
        stored = true;
      }
      if (stored) persist();
    });

    for (const tag of batch) {
      const settled = request.then(
        (translations) => translations[tag] ?? null,
        () => null,
      );
      inFlight.set(tag, settled);
      void settled.then(() => {
        if (inFlight.get(tag) === settled) inFlight.delete(tag);
      });
    }

    groups.push(request);
  }

  const result: Record<string, string | null> = {};
  const parts = await Promise.all(
    groups.map((group) =>
      group.then((part) => {
        onPartial?.(part);
        return part;
      }),
    ),
  );
  for (const part of parts) {
    for (const [tag, cn] of Object.entries(part)) {
      result[tag] = cn ?? null;
    }
  }
  /* 每个请求过的拼写都有条目（含 null），与 tagCounts 保持一致。 */
  for (const tag of tags) {
    const key = stripNamespace(tag).toLowerCase();
    if (!(key in result)) result[key] = entries.get(key)?.c ?? null;
  }
  return result;
}
