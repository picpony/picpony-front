/**
 * Typed tag text, as Derpibooru tag names — shared by every field that collects tags (a block
 * group, a tag group, an upload). Plain module: the tests import it.
 *
 * A Derpibooru tag is lower case, single-spaced, and never begins with a search operator; a comma
 * is never part of one (it is the list separator in every tag field Derpibooru has), so a comma
 * typed or pasted into the field separates tags here too — 「pony, cute, safe」 is three.
 */

/** One typed tag as a tag name, or `''` when nothing is left of it. */
export function normalizeTag(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^[-!~]+/, '')
    .trim()
    .toLowerCase();
}

/** Every tag in a typed or pasted run, in order, without repeats. */
export function splitTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,，、\n]/)) {
    const tag = normalizeTag(part);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** The term the dictionary is asked about: two characters of Latin text, or one of Chinese. */
export function lookupTerm(text: string): string {
  const parts = text.split(/[,，、\n]/);
  const last = normalizeTag(parts[parts.length - 1] ?? '').replace(/["()[\]{}*]/g, '').trim();
  return last.length >= 2 || /[㐀-鿿]/.test(last) ? last : '';
}
