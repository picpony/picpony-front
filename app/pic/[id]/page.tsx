import { Suspense } from 'react';
import { cookies } from 'next/headers';
import PicDetail, { DetailPageFallback } from '@/components/PicDetail';
import { COOKIE_KEYS } from '@/lib/constants';
import { detailSeedOnImageLine, readImageDetailSeed } from '@/lib/detail.server';
import { readRoutePolicyOnce, ssrImageLine } from '@/lib/imageLine.server';

type Params = Promise<{ id: string }>;

/**
 * A direct `/pic/:id` — a shared link, a reload, a new tab. The picture's record is read here
 * (`lib/detail.server.ts`, shared across visitors and bounded at 2.5s), so the document arrives
 * with the header, a media box at the picture's own aspect ratio and the body under it, instead
 * of a skeleton that re-laid itself out when the browser's read landed (R12-015).
 *
 * Nothing is awaited out here, so the page never suspends to the route's generic fallback: while
 * the read runs, the first byte carries the detail's own placeholder and back affordance. A read
 * that misses (a timeout, an outage) hands down no seed, and the page reads for itself as before.
 *
 * The overlay presentation (a navigation from a list) is `app/@imageDetail/(.)pic/[id]`, and reads
 * nothing on the server: it already has the list's row, and a server read in its payload would sit
 * inside the hero flight's window.
 */
export default function PicPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailPageFallback />}>
      <SeededPicDetail params={params} />
    </Suspense>
  );
}

async function SeededPicDetail({ params }: { params: Params }) {
  const { id } = await params;
  const [jar, policy, seed] = await Promise.all([cookies(), readRoutePolicyOnce(), readImageDetailSeed(id)]);
  /* On the line this document renders with — a forced policy, else the device's cookie — so the
     server's `<img src>` and the hydrating render name the same URL. */
  const line = ssrImageLine(policy, jar.get(COOKIE_KEYS.imageLine)?.value);
  return <PicDetail seed={detailSeedOnImageLine(seed, line)} />;
}
