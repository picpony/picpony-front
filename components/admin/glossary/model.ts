/**
 * The glossary editor's rules as plain functions — no React, no browser — so the Node suite can
 * hold them to the original glossary editor's contract (`https://picpony.top/ciku.html`):
 *
 * - **Untranslated is `cn === ''` or `cn === '未翻译'`**, and a save writes `''` for "no
 *   translation". The first translation is the main one, the rest are aliases.
 * - **A save carries the row's flags through** (`is_restricted`, `is_original_translation`,
 *   `is_sensitive`): the original editor sends them on every save, so a save that left them out
 *   could clear a 限制级 mark nobody touched.
 * - **Batch import is one request**, `batch_import_dictionary_tags {mode:'create_only', tasks}`,
 *   which skips what the dictionary already holds — not an existence read and a save per line.
 * - **History times are UTC**: the original editor appends `Z` before converting
 *   (`formatHistoryTime`) — one of the three UTC columns `lib/format.ts` reads with
 *   `parseBackendUtcTime`. Every other timestamp the backend writes is Beijing time.
 */

import { formatDateTime, parseBackendUtcTime } from '@/lib/format';

/**
 * A count a batch answer reports (`created`, `skipped`, `failed`, `deleted_count`): a whole number of
 * zero or more, or `null` when it did not arrive or is not one — never a 0 the backend did not send
 * (G4-015's rule, for the bulk toasts and the sync's tally).
 */
export function reportedCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export interface GlossaryTag {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
  is_restricted?: number | boolean | null;
  is_original_translation?: number | boolean | null;
  is_sensitive?: number | boolean | null;
  [key: string]: unknown;
}

export interface DerpiTagRow {
  name: string;
  category: string;
  images: number;
}

export interface TagForm {
  en: string;
  translations: string;
  cat: string;
  count: number;
  description: string;
}

export const TAG_CATEGORIES: { value: string; label: string }[] = [
  { value: 'general', label: '常规（general）' },
  { value: 'character', label: '角色（character）' },
  { value: 'species', label: '种族（species）' },
  { value: 'rating', label: '分级（rating）' },
  { value: 'origin', label: '来源（origin）' },
  { value: 'content-official', label: '官方内容（content-official）' },
  { value: 'content-fanmade', label: '同人内容（content-fanmade）' },
  { value: 'error', label: '错误（error）' },
];

export const CATEGORY_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '全部分类' },
  { value: 'general', label: '常规' },
  { value: 'character', label: '角色' },
  { value: 'species', label: '种族' },
  { value: 'rating', label: '分级' },
  { value: 'origin', label: '来源' },
  { value: 'content-official', label: '官方内容' },
  { value: 'content-fanmade', label: '同人内容' },
  { value: 'error', label: '错误' },
];

export const SORTS: { value: string; label: string }[] = [
  { value: 'count_desc', label: '热度从高到低' },
  { value: 'count_asc', label: '热度从低到高' },
  { value: 'newest', label: '最新添加' },
  { value: 'en_asc', label: '英文 A–Z' },
];

/** The page sizes offered; the field that took any number could not be edited (R9-033). */
export const PAGE_SIZES = [20, 50, 100, 150] as const;
export const DEFAULT_PAGE_SIZE = 100;

/** A stored page size, snapped to an offered one. */
export function pageSizeOf(value: unknown): number {
  const number = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(number) ? number : DEFAULT_PAGE_SIZE;
}

/** Whether two spellings name one dictionary entry: the dictionary keys tags lower-cased and trimmed. */
export function sameTag(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isUntranslated(cn: string | null | undefined): boolean {
  const value = (cn ?? '').trim();
  return value === '' || value === '未翻译';
}

/** A tag's translations in order — the main one, then its aliases — as the field shows them. */
export function translationsText(tag: Pick<GlossaryTag, 'cn' | 'aliases'>): string {
  if (isUntranslated(tag.cn)) return '';
  return [tag.cn, ...(tag.aliases ?? [])].join(', ');
}

/**
 * The field's text as `cn` and `aliases`: commas of either width separate, blanks drop out.
 *
 * `、` is **not** a separator (review P6-F3): the field's own helper says 用逗号分隔, the original
 * editor's batch import splits on commas alone (`cnRaw.replace(/，/g, ',').split(',')`), and a
 * Chinese name may well contain an enumeration comma — splitting on it turned one name into a name
 * and an alias.
 */
export function parseTranslations(text: string): { cn: string; aliases: string[] } {
  const parts = text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '未翻译');
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return { cn: unique[0] ?? '', aliases: unique.slice(1) };
}

export function emptyTagForm(prefill?: Partial<DerpiTagRow>): TagForm {
  return {
    en: prefill?.name ?? '',
    translations: '',
    cat: prefill?.category || 'general',
    count: Number(prefill?.images) || 0,
    description: '',
  };
}

export function tagFormOf(tag: GlossaryTag): TagForm {
  return {
    en: tag.en,
    translations: translationsText(tag),
    cat: tag.cat || 'general',
    count: Number(tag.count) || 0,
    description: tag.description ?? '',
  };
}

const flag = (value: unknown) => (value === true || Number(value) === 1 ? 1 : 0);

/**
 * The `save_dictionary_tag` body: the original editor's, flags carried through on an edit.
 *
 * **An untouched translations field sends the stored names as they are** (review P6-F3). The
 * original editor gives each name its own input, so a stored name may contain a comma; this one
 * joins them into one comma-separated field, and re-parsing that on every save split such a name in
 * two — on a save that only changed the description. Only a field the operator edited is parsed.
 */
export function tagSavePayload(form: TagForm, tag?: GlossaryTag | null): Record<string, unknown> {
  const untouched = tag && !isUntranslated(tag.cn) && form.translations === translationsText(tag);
  const { cn, aliases } = untouched
    ? { cn: tag.cn, aliases: Array.isArray(tag.aliases) ? [...tag.aliases] : [] }
    : parseTranslations(form.translations);
  const payload: Record<string, unknown> = {
    en: tag ? tag.en : form.en.trim().toLowerCase(),
    cn,
    aliases,
    cat: form.cat || 'general',
    count: Number(form.count) || 0,
    description: form.description.trim(),
    is_restricted: flag(tag?.is_restricted),
    is_original_translation: flag(tag?.is_original_translation),
    is_sensitive: flag(tag?.is_sensitive),
  };
  if (tag) payload.id = tag.id;
  return payload;
}

/** The row as it reads after a save, for correcting the page in place before it is read again. */
export function savedTag(tag: GlossaryTag, payload: Record<string, unknown>): GlossaryTag {
  return {
    ...tag,
    cn: String(payload.cn ?? ''),
    aliases: Array.isArray(payload.aliases) ? (payload.aliases as string[]) : [],
    cat: String(payload.cat ?? tag.cat),
    description: String(payload.description ?? ''),
  };
}

export interface ImportTask {
  en: string;
  cn: string;
  aliases: string[];
  cat: string;
  count: number;
  description: string;
}

/**
 * `英文标签 = 主中文名, 别名1, 别名2`, one per line, as the original editor parses it: a line
 * without `=` or starting with `#` is skipped, the English tag is lower-cased, a tag repeated
 * later in the text is ignored, and a line with no Chinese name is not a task.
 */
export function parseImport(text: string): { tasks: ImportTask[]; skipped: number } {
  const tasks: ImportTask[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const en = at < 0 ? '' : line.slice(0, at).trim().toLowerCase();
    const { cn, aliases } = parseTranslations(at < 0 ? '' : line.slice(at + 1));
    if (!en || !cn || seen.has(en)) {
      skipped += 1;
      continue;
    }
    seen.add(en);
    tasks.push({ en, cn, aliases, cat: 'general', count: 0, description: '' });
  }
  return { tasks, skipped };
}

/**
 * A page of tags in the import format, one `en = cn, alias` line each — so an export can be
 * imported again (R9-035: it wrote `A:… - B:… - C:…` joined by ` // `, which nothing reads). An
 * untranslated tag is written as a comment, since an import skips a line with no Chinese name.
 */
export function exportText(tags: readonly GlossaryTag[]): string {
  return tags
    .map((tag) => {
      const translations = translationsText(tag);
      return translations ? `${tag.en} = ${translations}` : `# ${tag.en} =`;
    })
    .join('\n');
}

/**
 * A sync of Derpibooru's popular tags, one page at a time, into new untranslated rows. The value
 * is `未翻译`, which every reader of the dictionary takes as no translation and which the backend
 * accepts as a required field.
 */
export function syncTasks(tags: readonly DerpiTagRow[]): ImportTask[] {
  return tags
    .filter((tag) => tag.name)
    .map((tag) => ({
      en: tag.name.toLowerCase(),
      cn: '未翻译',
      aliases: [],
      cat: tag.category || 'general',
      count: Number(tag.images) || 0,
      description: '',
    }));
}

/** Pages of popular tags a sync may fetch in one run. */
export const SYNC_MAX_PAGES = 100;

export function syncRange(start: string, end: string): { from: number; to: number } | { error: string; field: 'start' | 'end' } {
  const from = Number(start.trim());
  const to = Number(end.trim());
  if (!/^\d+$/.test(start.trim()) || !Number.isSafeInteger(from) || from < 1) return { error: '起始页须为正整数', field: 'start' };
  if (!/^\d+$/.test(end.trim()) || !Number.isSafeInteger(to) || to < 1) return { error: '结束页须为正整数', field: 'end' };
  if (to < from) return { error: '结束页不能小于起始页', field: 'end' };
  if (to - from + 1 > SYNC_MAX_PAGES) return { error: `一次最多同步 ${SYNC_MAX_PAGES} 页`, field: 'end' };
  return { from, to };
}

/** A history row's time: written in UTC (see the module docstring), shown on the app's clock. */
export function historyTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const date = parseBackendUtcTime(value);
  return date ? formatDateTime(date) : value.trim();
}

/** A history row's aliases, whichever wire spelling it came in. */
export function historyAliases(value: unknown): string {
  if (Array.isArray(value)) return value.filter((alias) => typeof alias === 'string' && alias).join('、');
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) return historyAliases(parsed);
      } catch {
        /* Not JSON: the text itself. */
      }
    }
    return text;
  }
  return '';
}

/**
 * What a feedback offers as the translation: the line `submit_tag_feedback` appends for a
 * suggested one (「建议的正确翻译：…」, `lib/api/picpony.ts`), else the whole text.
 */
export function suggestedTranslation(content: string): string {
  const match = /建议的正确翻译[:：]\s*(.+)\s*$/m.exec(content);
  return (match ? match[1] : content).trim();
}

/** The translations field after taking a feedback's suggestion: appended as one more alias. */
export function withSuggestion(translations: string, content: string): string {
  const suggestion = suggestedTranslation(content);
  if (!suggestion) return translations;
  const current = translations.trim();
  return current ? `${current}, ${suggestion}` : suggestion;
}

/** The percentage of the dictionary translated, to two places, or `null` with nothing counted. */
export function translatedShare(stats: { total: number; translated: number } | null | undefined): number | null {
  if (!stats || !(stats.total > 0)) return null;
  return Math.round((stats.translated / stats.total) * 10000) / 100;
}
