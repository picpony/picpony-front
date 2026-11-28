'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
/* The runtime store only: the Stage shell is mounted by `AppLayout` on every route, returns
   `null` while idle, and loads `HeroStageActive` behind a dynamic import so detail chrome stays
   out of every route's initial document. */
import { getImageHeroStage, registerImageHeroStageWarmer, subscribeImageHeroStage } from '@/lib/hero/runtime';
import type { ImageHeroStageState } from '@/lib/hero/types';

const EMPTY_STAGE: ImageHeroStageState = { phase: 'idle', snapshot: null, sessionId: null };

function getServerStage() {
  return EMPTY_STAGE;
}

type ActiveStageModule = typeof import('./HeroStageActive');

let stageModule: ActiveStageModule | null = null;
let stageLoading: Promise<ActiveStageModule | null> | null = null;

/** Preload the active Stage module so arming/opening mounts synchronously. Idempotent. */
export function warmHeroStage(): Promise<ActiveStageModule | null> {
  if (stageModule) return Promise.resolve(stageModule);
  if (!stageLoading) {
    stageLoading = import('./HeroStageActive')
      .then((module) => {
        stageModule = module;
        return module;
      })
      .catch(() => {
        stageLoading = null;
        return null;
      });
  }
  return stageLoading;
}

export default function HeroStage() {
  const state = useSyncExternalStore(subscribeImageHeroStage, getImageHeroStage, getServerStage);
  const [ready, setReady] = useState(stageModule !== null);

  useEffect(() => registerImageHeroStageWarmer(warmHeroStage), []);

  const active = state.phase !== 'idle' && state.snapshot !== null;
  useEffect(() => {
    if (!active || stageModule) return;
    let live = true;
    void warmHeroStage().then((loaded) => {
      if (live && loaded) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [active, ready]);

  if (state.phase === 'idle' || !state.snapshot || !stageModule) return null;
  /* Read via module member expression (not a lowercase identifier) so React Compiler keeps the
     component reference instead of lowering it to an intrinsic tag. Once warmed on gallery
     mount/intent, `stageModule` is already resident so arming/opening renders synchronously. */
  const Active = stageModule.default;
  return <Active phase={state.phase} snapshot={state.snapshot} sessionId={state.sessionId} />;
}
