'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { tagFromSegment } from '@/components/subscriptions/href';
import SubscriptionView from '@/components/subscriptions/SubscriptionView';
import { LS_KEYS } from '@/lib/constants';
import { useStoredValue } from '@/lib/hooks';
import { parseContentFilter } from '@/lib/searchQuery';

/**
 * One subscription's pictures. The tag comes from this page's own `params`, never `useParams()`:
 * that follows the foreground, and an image opened over the gallery would otherwise rename it.
 * The router hands the segment over still percent-encoded, so it is decoded here, once.
 *
 * Keyed on the tag and the content filter, so a filter change adopts that filter's remembered
 * page before its first read, as the Derpibooru profile does.
 */
export default function SubscriptionPage({ params }: { params: Promise<{ tag: string }> }) {
  const tag = tagFromSegment(use(params).tag);
  const contentFilter = parseContentFilter(useStoredValue(LS_KEYS.contentFilter, 'safe'));
  if (!tag) notFound();
  return <SubscriptionView key={`${tag}\n${contentFilter}`} tag={tag} contentFilter={contentFilter} />;
}
