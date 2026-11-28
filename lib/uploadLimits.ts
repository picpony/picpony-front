/**
 * What a 发布图片 submission may carry — one copy of the limits for the form that checks them
 * (`app/upload/page.tsx`) and the hop that enforces them (`app/upload/submit/route.ts`). Pure and
 * import-free beyond the platform, so the server route and the tests reach it without the client.
 *
 * They were three copies that disagreed (review P4-F2): the form counted the description in
 * characters, the hop in UTF-16 units under a 128KB body cap, and Derpibooru counts it in **UTF-8
 * bytes** (Philomena: `validate_length(:description, max: 50_000, count: :bytes)`). A Chinese
 * description of 20,000 characters passed the form and was refused by Derpibooru; one of 45,000
 * was refused by the hop as 「请求过大」. The form now counts what Derpibooru counts.
 */

/** Derpibooru's description limit, in UTF-8 bytes. */
export const UPLOAD_MAX_DESCRIPTION_BYTES = 50_000;
/** The longest `tag_input` the hop forwards. */
export const UPLOAD_MAX_TAG_INPUT = 10_000;
/** The longest source address the hop forwards. */
export const UPLOAD_MAX_SOURCE_URL = 2048;

const encoder = new TextEncoder();

/** A text's length as Derpibooru counts it. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/**
 * The description's complaint, or `null` when it fits. Derpibooru counts UTF-8 bytes, so a Chinese
 * character costs three: the limit is said in both units, with where the text stands.
 */
export function uploadDescriptionProblem(value: string): string | null {
  const bytes = utf8Length(value.trim());
  if (bytes <= UPLOAD_MAX_DESCRIPTION_BYTES) return null;
  return `作品描述超出 Derpibooru 的长度上限（${UPLOAD_MAX_DESCRIPTION_BYTES} 字节，约 ${Math.floor(UPLOAD_MAX_DESCRIPTION_BYTES / 3)} 个汉字），当前 ${bytes} 字节`;
}

/**
 * A source address the hop accepts — an absolute http(s) URL with a host and no credentials,
 * within `UPLOAD_MAX_SOURCE_URL` characters — as its normalised form; `null` for anything else.
 */
export function uploadSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > UPLOAD_MAX_SOURCE_URL) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** The tag list as submitted: the rating first, then the tags, comma-separated. */
export function uploadTagInput(rating: string | null, tags: readonly string[]): string {
  return [rating, ...tags].filter(Boolean).join(', ');
}
