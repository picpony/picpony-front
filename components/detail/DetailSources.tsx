'use client';

import { useId } from 'react';
import type { ImagePreview } from '@/lib/types/image';

/** A URL as a person reads it: percent-escapes decoded where they decode cleanly. */
function readable(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** Only links a browser should follow: an `http(s)` URL, nothing a record could smuggle in. */
function sourcesOf(image: Pick<ImagePreview, 'source_url' | 'source_urls'>): string[] {
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

/**
 * Where the picture came from — every source the record names (Derpibooru keeps a list; only
 * the first used to be shown), each a link out.
 *
 * A source is one unbroken URL, often longer than a phone is wide: `wrap-anywhere` lets it wrap,
 * where the ordinary break-word rule leaves the box's minimum width at the longest segment and the
 * first line runs off the screen (the detail's scrollers clip sideways now).
 */
export default function DetailSources({ image }: { image: Pick<ImagePreview, 'source_url' | 'source_urls'> }) {
  const headingId = useId();
  const sources = sourcesOf(image);
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-label-m-emphasized text-on-surface-variant">
        来源
      </h2>
      <ul className="flex flex-col gap-1">
        {sources.map((url) => (
          <li key={url} className="min-w-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="prose-link inline-block max-w-full rounded-xs py-1 text-body-m wrap-anywhere focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
            >
              {readable(url)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
