'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/lib/api/errors';
import { pollImageTranslation, requestImageTranslation, translateText } from '@/lib/api/translate';

/*
 * The two translations the detail offers (decision 15), as hooks: a passage of text — a
 * description, a comment — and the picture itself (the one-click image translation). The
 * contracts are in `lib/api/translate.ts`.
 */

// ---------------------------------------------------------------------------
// A passage
// ---------------------------------------------------------------------------

/** Translations already fetched this page life, by source text: showing one again costs nothing. */
const textCache = new Map<string, string>();

export interface TextTranslation {
  /** The translation, while it is shown. */
  translation: string | null;
  busy: boolean;
  /** Show the translation (fetching it the first time), or hide it again. */
  toggle: () => void;
}

/**
 * One passage's translation, shown and hidden in place. Keyed by the text: a different passage
 * (the next picture's description) starts hidden. A failure is reported through `onError`.
 */
export function useTextTranslation(text: string, onError: (message: string) => void): TextTranslation {
  const [state, setState] = useState<{ text: string; shown: boolean; busy: boolean }>({
    text,
    shown: false,
    busy: false,
  });
  const current = state.text === text ? state : { text, shown: false, busy: false };
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const toggle = useCallback(() => {
    if (current.busy) return;
    if (current.shown) {
      setState({ text, shown: false, busy: false });
      return;
    }
    if (textCache.has(text)) {
      setState({ text, shown: true, busy: false });
      return;
    }
    setState({ text, shown: false, busy: true });
    translateText(text).then(
      (translation) => {
        textCache.set(text, translation);
        setState((previous) => (previous.text === text ? { text, shown: true, busy: false } : previous));
      },
      (error: unknown) => {
        setState((previous) => (previous.text === text ? { text, shown: false, busy: false } : previous));
        onErrorRef.current(apiErrorMessage(error, '翻译失败'));
      },
    );
  }, [current.busy, current.shown, text]);

  return {
    translation: current.shown ? (textCache.get(text) ?? null) : null,
    busy: current.busy,
    toggle,
  };
}

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

/** The original front end's cadence and patience: a poll every 2 s, for up to three minutes. */
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 90;

/** Finished translations this page life, by the picture's raw URL. */
const imageCache = new Map<string, string>();

export type ImageTranslationPhase =
  | 'idle'
  /** Asking the service to take it. */
  | 'requesting'
  | 'queued'
  | 'translating'
  /** Fetching the finished picture, so it can be shown decoded. */
  | 'loading'
  | 'ready'
  | 'failed'
  /** Still in the service's hands after the polling budget; it may finish later. */
  | 'stalled';

export interface ImageTranslation {
  phase: ImageTranslationPhase;
  /** Jobs ahead in the queue while `queued`. */
  queueAhead: number;
  /** The translated picture once `ready`. */
  url: string | null;
  /** Whether the translated picture is the one on screen. */
  shown: boolean;
  /** Why it failed. */
  message: string | null;
  /** Start (or restart after a failure), or switch between the two pictures once ready. */
  toggle: () => void;
  /** The shown translation could not be drawn after all: back to the original, and say so. */
  reportBroken: () => void;
}

interface ImageTranslationState {
  key: string;
  phase: ImageTranslationPhase;
  queueAhead: number;
  url: string | null;
  shown: boolean;
  message: string | null;
}

function idle(key: string): ImageTranslationState {
  const url = imageCache.get(key) ?? null;
  return { key, phase: url ? 'ready' : 'idle', queueAhead: 0, url, shown: false, message: null };
}

/** Resolves once the picture is decoded; rejects if it cannot be drawn. */
function preload(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    const abort = () => {
      image.src = '';
      reject(new DOMException('cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          signal.removeEventListener('abort', abort);
          if (image.naturalWidth > 0) resolve();
          else reject(new Error('empty'));
        });
    };
    image.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('unreadable'));
    };
    image.src = url;
  });
}

/** Waits `ms`, and for the tab to be visible: a hidden tab does not spend the polling budget. */
function waitVisible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const done = () => {
      document.removeEventListener('visibilitychange', onVisible);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (document.visibilityState === 'visible' ? done() : undefined), ms);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') arm();
    };
    const onAbort = () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      reject(new DOMException('cancelled', 'AbortError'));
    };
    document.addEventListener('visibilitychange', onVisible);
    signal.addEventListener('abort', onAbort, { once: true });
    arm();
  });
}

/**
 * The job itself: queue, poll, fetch the result decoded. Module scope rather than inside the
 * hook, so the hook stays one the React Compiler can lower.
 */
async function translatePicture(
  sourceUrl: string,
  signal: AbortSignal,
  patch: (next: Partial<ImageTranslationState>) => void,
  onWaitedFinish: () => void,
): Promise<void> {
  patch({ phase: 'requesting', message: null, queueAhead: 0 });
  let waited = false;
  try {
    let status = await requestImageTranslation(sourceUrl, signal);
    for (let polls = 0; ; polls += 1) {
      if (status.state === 'completed' && status.translatedUrl) {
        const url = status.translatedUrl;
        patch({ phase: 'loading' });
        try {
          await preload(url, signal);
        } catch {
          if (!signal.aborted) patch({ phase: 'failed', message: '译图加载失败，请稍后重试' });
          return;
        }
        imageCache.set(sourceUrl, url);
        patch({ phase: 'ready', url, shown: true });
        if (waited) onWaitedFinish();
        return;
      }
      if (status.state === 'failed') {
        patch({ phase: 'failed', message: status.message ?? '翻译失败，请稍后重试' });
        return;
      }
      if (polls >= MAX_POLLS) {
        patch({ phase: 'stalled' });
        return;
      }
      patch({ phase: status.state === 'translating' ? 'translating' : 'queued', queueAhead: status.queueAhead });
      waited = true;
      await waitVisible(POLL_INTERVAL_MS, signal);
      status = await pollImageTranslation(sourceUrl, signal);
    }
  } catch (error) {
    if (!signal.aborted) patch({ phase: 'failed', message: apiErrorMessage(error, '翻译失败，请稍后重试') });
  }
}

/**
 * The one-click image translation for one picture: queue it with the translation service, poll
 * the job, fetch the result decoded, and switch between it and the original. Keyed by the
 * picture's raw URL; a step to another picture abandons the polling (the job carries on at the
 * service, and asking again later answers at once when it has finished).
 *
 * `onFinished` fires when a job finishes after the reader had to wait for it — they may have
 * scrolled away to read comments meanwhile. `onBroken` when a shown translation turns out not
 * to draw.
 */
export function useImageTranslation(
  sourceUrl: string | null,
  { onFinished, onBroken }: { onFinished: () => void; onBroken: () => void },
): ImageTranslation {
  const key = sourceUrl ?? '';
  const [state, setState] = useState<ImageTranslationState>(() => idle(key));
  const current = state.key === key ? state : idle(key);
  if (state.key !== key) setState(current);
  const controllerRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onFinished, onBroken });
  useEffect(() => {
    callbacks.current = { onFinished, onBroken };
  });

  /* A new picture, or leaving: whatever was in flight for the last one stops here. */
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [key],
  );

  const patch = useCallback(
    (next: Partial<ImageTranslationState>) =>
      setState((previous) => (previous.key === key ? { ...previous, ...next } : previous)),
    [key],
  );

  const run = useCallback(() => {
    if (!sourceUrl) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    void translatePicture(sourceUrl, controller.signal, patch, () => callbacks.current.onFinished()).then(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [patch, sourceUrl]);

  const toggle = useCallback(() => {
    if (current.phase === 'ready') {
      patch({ shown: !current.shown });
      return;
    }
    if (current.phase === 'idle' || current.phase === 'failed' || current.phase === 'stalled') run();
  }, [current.phase, current.shown, patch, run]);

  const reportBroken = useCallback(() => {
    if (sourceUrl) imageCache.delete(sourceUrl);
    patch({ phase: 'failed', shown: false, url: null, message: '译图暂时无法显示，已恢复原图' });
    callbacks.current.onBroken();
  }, [patch, sourceUrl]);

  return {
    phase: current.phase,
    queueAhead: current.queueAhead,
    url: current.url,
    shown: current.phase === 'ready' && current.shown,
    message: current.message,
    toggle,
    reportBroken,
  };
}
