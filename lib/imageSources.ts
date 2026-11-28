/**
 * A picture's sources (`source_url` / `source_urls`) as the detail lists them: which ones are
 * links at all, and the text each link shows. Plain module: the server renders the same list.
 */

/**
 * Characters that change how the text *around* them is laid out or read without being seen
 * themselves: the bidirectional overrides, embeddings and isolates, the zero-width marks and
 * joiners, and the C0/C1 controls.
 */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * A URL as a person reads it: percent-escapes decoded where they decode cleanly — **except** an
 * escape that decodes to an invisible character, which stays escaped (P3-F5). `decodeURI` turned
 * `%E2%80%AE` into U+202E, and a right-to-left override in a link's text shows the rest of the
 * address reversed: a source the uploader wrote as `https://evil.example/%E2%80%AEgpj.moc.elgoog`
 * read as a link to google.com. The `href` was always the real address; this keeps the words
 * honest about it.
 */
export function readableSourceUrl(url: string): string {
  let text: string;
  try {
    text = decodeURI(url);
  } catch {
    text = url;
  }
  return text.replace(INVISIBLE, (character) => encodeURIComponent(character));
}

/** Only links a browser should follow: an `http(s)` URL, nothing a record could smuggle in. */
export function sourceLinksOf(image: { source_url?: string | null; source_urls?: readonly string[] | null }): string[] {
  const all = [...(image.source_urls ?? []), image.source_url ?? ''];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
