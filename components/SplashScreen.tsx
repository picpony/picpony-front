'use client';

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import Logo, { INTRO_DURATION_MS, INTRO_LATEST_START_MS, sinceFirstByte, warmIntro } from './Logo';
import {
  MOTION_SPEED_SCALE,
  entranceMode,
  motionTier,
  useEntranceMode,
  useMotionTier,
} from '@/lib/appearance';

/** How long the finished mark holds before the splash leaves. */
const HOLD_MS = 200;
/**
 * The splash leaves on the exit step (`duration-exit`, 200ms). The unmount waits for it at the
 * slowest speed: the number bounds an animation, so it is the longest that animation can take.
 */
const EXIT_HOLD_MS = Math.round(200 * MOTION_SPEED_SCALE.slow);
/**
 * Past this, a splash that mounts still opaque is not the cold load's — the stylesheet's own
 * deadline would have lifted that one long before — but one mounting into a session under way (a
 * refresh after the maintenance screen, a hot reload), and it goes before it can paint.
 */
const STALE_AFTER_MS = INTRO_LATEST_START_MS + 5000;

/** Once per document, whatever remounts. A property, not a reassigned binding, so the compiler
 *  can see the write is a callback's and not the render's. */
const splash = { ended: false };

/* The player and the boot cut, fetched while the rest of the app's script evaluates and hydrates —
   only when this document is going to show the splash — so the trace can start the moment the
   splash takes over instead of a round trip later. */
if (
  typeof document !== 'undefined' &&
  document.documentElement.dataset.entrance !== 'off' &&
  motionTier('entrance') === 'standard'
) {
  warmIntro();
}

/**
 * `done`, once the hydrated page has been presented — called from the hydrating commit, so two
 * frames on is the first frame the page is on screen as the app rather than as the server's markup.
 * Not the document's `load`: the document streams, and its last byte — the feed's server read, a
 * boundary still resolving — lands long after the page is usable (2.9s against 1.2s, measured on
 * the development server), which made 不阻塞 end exactly when 阻塞 did. Returns the cancel.
 */
function whenPagePresented(done: () => void): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(done);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/**
 * The full-screen splash — 入场动画's two modes that play, 阻塞 and 不阻塞 (the default). The PicPony
 * mark writes itself on in the middle of the screen; what differs is who decides when it leaves.
 * Under **阻塞** the mark does: the page waits behind it until the signature has landed and held for
 * a beat. Under **不阻塞** the page does: the splash leaves the moment the page has loaded — hydrated
 * and on screen (`whenPagePresented`) — mid-stroke if the mark is still writing, and never later
 * than 阻塞 would; so on a fast load little of the signature shows, and on a slow one most of it.
 *
 * **In the first byte, and gated by the stylesheet.** The server renders it unless the cookie says
 * 关闭, under the standard tier (`app/layout.tsx`); the rules in globals.css show it only while
 * `<html>` agrees — the attributes the pre-paint script has corrected from storage — so a stale
 * cookie can render it and never paint it. 减弱 and 关闭 play no Lottie, and a splash that cannot
 * animate is only a page held back, so neither shows it.
 *
 * **It never waits on hydration.** Its own deadline is CSS (`app-splash-lift`, delayed by
 * `INTRO_LATEST_START_MS`): with no script — a slow phone still evaluating, scripting off, a chunk
 * that failed — the splash lifts by itself and shows the page the server sent. The script takes
 * over when it arrives in time (`data-held`), with a ceiling in case no answer ever comes. A
 * takeover too late for the write-on to read as an arrival leaves at once.
 *
 * Hit-testable while it covers — a tap must not land on a page the reader cannot see — and not
 * from the moment it starts to leave. Decorative, so hidden from assistive technology: the page
 * under it is readable from the first byte.
 */
export default function SplashScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(splash.ended);
  /* Whether the mark writes itself on: under either mode that plays, at the standard tier. The
     server's defaults are exactly that, so the hydrating render agrees with the first byte. */
  const mode = useEntranceMode();
  const tier = useMotionTier('entrance');
  const play = mode !== 'off' && tier === 'standard';
  const timers = useRef<number[]>([]);
  const leaving = useRef(false);

  const later = useCallback((task: () => void, ms: number) => {
    timers.current.push(window.setTimeout(task, ms));
  }, []);

  const finish = useCallback(() => {
    splash.ended = true;
    setGone(true);
  }, []);

  /** Fade out after `delay`, then unmount — once, whoever asks first. */
  const leave = useCallback(
    (delay: number) => {
      if (leaving.current) return;
      leaving.current = true;
      later(() => {
        ref.current?.setAttribute('data-leaving', '');
        later(finish, EXIT_HOLD_MS);
      }, delay);
    },
    [finish, later],
  );

  /* The takeover. Read off the DOM, not the hooks above: in the hydrating commit those still
     answer with the server's defaults. A layout effect, so a splash mounting into a session under
     way is hidden before the frame that would have painted it. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = sinceFirstByte();
    const current = entranceMode();
    let cancelLoad = () => {};
    if (current === 'off' || motionTier('entrance') !== 'standard' || now > STALE_AFTER_MS) {
      /* The stylesheet never painted it — storage disagreed with the cookie that rendered it — or
         this is not the cold load. */
      el.style.display = 'none';
      leaving.current = true;
      later(finish, 0);
    } else if (Number(getComputedStyle(el).opacity) < 1) {
      /* Hydration came after the stylesheet's deadline, which is already lifting it. */
      leaving.current = true;
      later(finish, EXIT_HOLD_MS);
    } else if (now >= INTRO_LATEST_START_MS) {
      leave(0);
    } else {
      el.setAttribute('data-held', '');
      /* The mark answers when it lands or gives up; this is for an answer that never comes (a
         background tab draws no frames, so the player never completes). */
      later(
        () => leave(0),
        INTRO_LATEST_START_MS - now + INTRO_DURATION_MS * MOTION_SPEED_SCALE.slow + HOLD_MS,
      );
      if (current === 'non-blocking') cancelLoad = whenPagePresented(() => leave(0));
    }
    const pending = timers.current;
    return () => {
      cancelLoad();
      for (const id of pending.splice(0)) window.clearTimeout(id);
      leaving.current = false;
    };
  }, [finish, later, leave]);

  const onIntroSettled = useCallback((played: boolean) => leave(played ? HOLD_MS : 0), [leave]);

  if (gone) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="app-splash bg-surface fixed inset-0 z-splash items-center justify-center"
      style={{ '--app-splash-deadline': `${INTRO_LATEST_START_MS}ms` } as CSSProperties}
    >
      {/* The base is `outline-variant` rather than the body's ink: it is a ground for the colour
          trace to be drawn onto, not a wordmark in its own right — at full strength it read as
          the finished logo already being there, which leaves the trace nothing to reveal. Nothing
          to point at on a splash, so no hover cut. */}
      <Logo
        className="h-auto w-32 text-outline-variant"
        interactive={false}
        intro={play}
        onIntroSettled={onIntroSettled}
      />
    </div>
  );
}
