'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { useSession, readToken } from '@/lib/hooks';
import { useSyncedSetting } from '@/lib/settingsSync';
import { useMotionTier } from '@/lib/appearance';
import { useCompanionPresence } from '@/lib/mascot/visibility';
import { useAuthModal } from '@/components/AuthModal';
import { SKIP, useResource } from '@/lib/resource';
import { myPonies } from '@/lib/desktopPonies/queries';
import { getAppScroller } from '@/lib/appScroller';
import { bindAssistantSlideshow, type AssistantSlideshowRequest, type AssistantSlideshowReceipt } from '@/lib/assistant/slideshow';
import { settleHistoryLayers } from '@/lib/historyLayers';
import { apiErrorMessage, isAborted } from '@/lib/api/errors';
import { showToast } from '@/components/Toast';

/* Its own chunk, loaded only while the mascot is shown: a signed-in account with the mascot off
   still mounts this runtime for its ponies and the slideshow, and used to fetch the mascot's code
   and stylesheet regardless. */
const Mascot = dynamic(() => import('./Mascot'), { ssr: false, loading: () => null });
const PoniesRuntime = dynamic(() => import('@/components/desktopPonies/PoniesRuntime'), { ssr: false });
const AssistantPanel = dynamic(() => import('@/components/assistant/AssistantPanel'), { ssr: false });
const FolderSlideshow = dynamic(() => import('@/components/assistant/FolderSlideshow'), { ssr: false });
interface SlideshowJob {
  request: AssistantSlideshowRequest;
  preparing: boolean;
  started: boolean;
  resolve: (receipt: AssistantSlideshowReceipt) => void;
  fail: (error: unknown) => void;
}

export default function CompanionRuntime() {
  const shown = useSyncedSetting('showMascot');
  const { token } = useSession();
  const { present, away } = useCompanionPresence();
  const tier = useMotionTier();
  const { openAuth } = useAuthModal();
  const [host] = useState(() => getAppScroller() ?? document.body);
  const [chat, setChat] = useState<{ token: string; open: boolean } | null>(null);
  const [slideshow, setSlideshow] = useState<SlideshowJob | null>(null);
  const job = useRef<SlideshowJob | null>(null);
  /* The ponies' chunk — the engine's frame, its stylesheet, the catalogue read — is fetched only
     for an account that has chosen some (G1-017): the selection is one small read made here, where
     mounting the runtime to find out cost both reads and the chunk on every signed-in cold load.
     Not a synced flag: the original front end edits the same selection and would leave one stale.
     Latched per account once wanted, so 清空 still fades the ponies on the engine's own clock and
     撤销 finds them where they stood (`PoniesRuntime`'s grace for an emptied frame). */
  const poniesAllowed = present && Boolean(token) && tier === 'standard';
  const selection = useResource(myPonies, poniesAllowed && token ? { token } : SKIP);
  const [poniesFor, setPoniesFor] = useState<string | null>(null);
  if (token && poniesFor !== token && (selection.data?.length ?? 0) > 0) setPoniesFor(token);
  const onChat = () => {
    const current = readToken();
    if (!current) { openAuth('login'); return; }
    setChat({ token: current, open: true });
  };
  const close = useCallback(() => {
    if (job.current?.preparing) job.current.fail(new DOMException('Cancelled', 'AbortError'));
    setChat(previous => previous ? { ...previous, open: false } : null);
  }, []);
  const prepareViewer = useCallback(async () => {
    if (job.current) job.current.preparing = false;
    setChat(previous => previous ? { ...previous, open: false } : null);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await settleHistoryLayers();
  }, []);
  const closeSlideshow = useCallback(() => {
    const current = job.current;
    if (current && !current.started) current.fail(new DOMException('Cancelled', 'AbortError'));
    job.current = null; setSlideshow(null);
  }, []);
  useEffect(() => bindAssistantSlideshow(request => new Promise((resolve, reject) => {
    if (readToken() !== request.token || job.current) { reject(new Error('当前会话无法开始新的放映')); return; }
    const next: SlideshowJob = {
      request, preparing: true, started: false,
      resolve: receipt => { next.started = true; resolve(receipt); },
      fail: error => {
        reject(error);
        if (job.current === next) { job.current = null; setSlideshow(null); }
        if (!isAborted(error) && readToken() === request.token) showToast(apiErrorMessage(error), 'warning');
      },
    };
    job.current = next; setSlideshow(next);
  })), []);
  useEffect(() => {
    if (job.current && job.current.request.token !== token) job.current.fail(new DOMException('Account changed', 'AbortError'));
  }, [token]);
  return createPortal(<>
    {poniesAllowed && token && poniesFor === token && <PoniesRuntime key={token} token={token} paused={away} />}
    {shown && <Mascot onChat={onChat} active={present && !away} />}
    {chat && chat.token === token && <AssistantPanel isOpen={chat.open} onClose={close} />}
    {slideshow && slideshow.request.token === token && <FolderSlideshow request={slideshow.request} onReady={prepareViewer} onStarted={slideshow.resolve} onError={slideshow.fail} onClose={closeSlideshow} />}
  </>, host);
}
