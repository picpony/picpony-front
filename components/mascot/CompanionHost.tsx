'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { useDocumentVisible } from '@/lib/mascot/visibility';
import { runWhenIdle } from '@/lib/utils';

const CompanionRuntime = dynamic(() => import('./CompanionRuntime'), { ssr: false });

/**
 * Optional companions start after the page's useful paint; no engine belongs to its initial
 * document. The runtime mounts for the mascot when it is shown, and for a signed-in account either
 * way — that account's desktop ponies and 彩彩 AI's folder slideshow live in it too.
 *
 * `runWhenIdle`'s contract, not a local copy of it: the deadline is the same with or without
 * `requestIdleCallback` (a hand-rolled version fired at 400ms on engines without one, five times
 * earlier than intended and inside the cold-load window).
 */
export default function CompanionHost() {
  const { ready, token } = useSession();
  const shown = useSyncedSetting('showMascot');
  const visible = useDocumentVisible();
  const [idle, setIdle] = useState(false);
  const wanted = shown || Boolean(token);
  useEffect(() => {
    if (!ready || !visible || idle || !wanted) return;
    return runWhenIdle(() => setIdle(true), 2000);
  }, [ready, visible, idle, wanted]);
  return idle && wanted ? <CompanionRuntime /> : null;
}
