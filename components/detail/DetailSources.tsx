'use client';

import { useId } from 'react';
import type { ImagePreview } from '@/lib/types/image';
import { readableSourceUrl, sourceLinksOf } from '@/lib/imageSources';

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
  const sources = sourceLinksOf(image);
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
              {readableSourceUrl(url)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
