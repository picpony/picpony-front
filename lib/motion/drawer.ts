'use client';
/* useGSAP owns dependency cleanup; preserve its existing compiler boundary. */
'use no memo';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { motionTier } from '@/lib/appearance';
import { gsap, Observer, spring, useGSAP } from './engine';

export interface DrawerSwipeOptions {
  /** The sliding panel. Assumed to sit at `translateX(-width)` when closed. */
  drawerRef: RefObject<HTMLElement | null>;
  /** The dimming layer behind it; its opacity tracks the drag. */
  scrimRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Turn the whole gesture off — e.g. on desktop, where the drawer is docked. */
  enabled?: boolean;
}

/** Fraction of the drawer's width you must cross for a slow drag to commit. */
const DRAWER_COMMIT_RATIO = 0.4;
/** px/s past which a flick commits regardless of how far it travelled. */
const DRAWER_FLICK_VELOCITY = 450;

/**
 * Swipe an open navigation drawer closed. (Opening by edge-swipe does not exist: a
 * left-edge gesture is claimed by the browser's back navigation on iOS and Android,
 * so the menu button is the way in and this is only the way out.)
 *
 * The drawer tracks the finger for the whole gesture rather than waiting for a flick
 * to complete — a drawer that only responds on release gives no way to change your
 * mind halfway. On release it commits past 40% of its width, or on a fast flick.
 * During a drag the panel and scrim are driven inline with their CSS transitions
 * suppressed — the shell styles them with an all-properties transition and a
 * full-width negative translate, which would put lag between the finger and the
 * panel — both handed back to CSS once the settle tween lands, when the inline and
 * class positions agree.
 *
 * **Every way a gesture ends hands both back**, not only a release: a close from
 * elsewhere while a finger or a release owns the panel (Back — on a phone the edge
 * Back gesture is itself a touch on the open drawer, delivered before the system takes
 * it — Esc, a drawer row, a route change), `enabled` flipping (a picture's route, the
 * docked breakpoint) and unmount. Before, a Back during the drag was undone by the
 * drag's own release, which reopened the drawer and pushed its history entry again; a
 * finger that never ended left the scrim at its inline opacity over a closed drawer;
 * and a revert left GSAP's resting transform (`translate3d(0,0,0)` with `translate:
 * none`) inline, so a closed drawer stood on screen, inert, until a reload.
 */
export function useDrawerSwipe({
  drawerRef,
  scrimRef,
  open,
  onOpenChange,
  enabled = true,
}: DrawerSwipeOptions) {
  /* `open` and `onOpenChange` are read through refs rather than declared as
   * dependencies: `useGSAP` only tears its context down on unmount unless
   * `revertOnUpdate` is set, so a dependency flipping on every drawer toggle added a
   * *second* Observer holding a captured `open === true` forever — survivors read
   * `pending` as true for drags starting within a drawer's width of the left edge
   * and dragged the *closed* drawer into view. With refs the dependency list is just
   * `enabled`: one Observer at a time, disposed by `revertOnUpdate`.
   *
   * Written in a layout effect, in the commit that changes them, so no touch handled
   * after a close can read the drawer as still open; and a change made elsewhere is
   * handed to the gesture there (`interrupt`), before the frame that shows it. */
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const interrupt = useRef<((openNow: boolean) => void) | null>(null);
  useLayoutEffect(() => {
    const changed = openRef.current !== open;
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
    if (changed) interrupt.current?.(open);
  });

  useGSAP(
    (_context, contextSafe) => {
      if (!enabled) return;

      // `width` is read per gesture: the panel is 288dp, capped at the viewport less
      // 56dp on a narrow phone, so a rotation or a resize can change it between drags.
      let width = 0;
      let startOffset = 0;
      let active = false;
      // Set at press when the start point qualifies, cleared once the axis is
      // known: `onDragStart` fires before `lockAxis` has decided, so a vertical
      // scroll that happens to begin at the screen edge must be able to back out.
      let pending = false;
      /** Where a release's spring is taking the drawer while it owns the panel, else null. */
      let settling: boolean | null = null;

      const drawer = () => drawerRef.current;
      const scrim = () => scrimRef.current;

      /* The panel and the scrim back to their classes: every inline property the gesture
         wrote comes off — `clearProps: 'transform'` takes GSAP's individual `translate`,
         `rotate` and `scale` with it — and a forced style read commits that with the
         transitions still off, so nothing animates the hand-back; only then are the
         transitions given back. */
      const handBack = () => {
        const d = drawer();
        const s = scrim();
        if (d) gsap.set(d, { clearProps: 'transform' });
        if (s) gsap.set(s, { clearProps: 'opacity' });
        if (d) void getComputedStyle(d).translate;
        if (s) void getComputedStyle(s).opacity;
        if (d) d.style.transition = '';
        if (s) {
          s.style.transition = '';
          s.style.pointerEvents = '';
        }
      };

      /** Places the panel at `x` ∈ [-width, 0] and fades the scrim to match.
       *  `contextSafe` throughout: these writes happen from Observer callbacks,
       *  after useGSAP's own callback returned — without it the inline transforms
       *  are invisible to `revert()` and an interrupted drag strands the panel. */
      const place = contextSafe!((x: number) => {
        const d = drawer();
        if (d) gsap.set(d, { x, xPercent: 0 });
        const s = scrim();
        if (s) gsap.set(s, { opacity: width > 0 ? (x + width) / width : 0 });
      });

      const begin = () => {
        const d = drawer();
        if (!d) return false;
        width = d.offsetWidth;
        if (width <= 0) return false;

        /* Take the pose that is actually on screen, including Tailwind's
         * individual translate during a tap-driven transition. A new drag can
         * catch either that transition or a previous GSAP release; using the
         * boolean endpoint snapped both of them home under the finger. */
        const pose = getComputedStyle(d);
        const translate = pose.translate.split(' ')[0];
        const independentX = (parseFloat(translate) || 0) * (translate.endsWith('%') ? width / 100 : 1);
        const transformX = pose.transform === 'none' ? 0 : new DOMMatrixReadOnly(pose.transform).m41;
        startOffset = gsap.utils.clamp(-width, 0, independentX + transformX);
        gsap.killTweensOf(d);
        const s = scrim();
        if (s) gsap.killTweensOf(s);
        // A release caught by this finger is over: its spring will not finish.
        settling = null;
        active = true;
        // Suppress the class-level transitions for the duration of the drag.
        d.style.transition = 'none';
        if (s) {
          s.style.transition = 'none';
          // The scrim is `pointer-events-none` while closed; it must not start
          // swallowing taps just because it became visible mid-drag.
          s.style.pointerEvents = 'none';
        }
        place(startOffset);
        return true;
      };

      const settle = contextSafe!((toOpen: boolean) => {
        active = false;
        pending = false;
        const d = drawer();
        const s = scrim();

        /* The hand-back from the inline pose to the class pose, and **all of it in one
           synchronous block with transitions still off**. The state change used to be a
           scheduled React update while the inline transform was cleared at once: for a frame
           the panel stood at its *old* class pose (open), and when the class caught up the
           restored transition ran it shut a second time — a committed swipe that bounced back
           open for a frame. `flushSync` puts the new class on first; the inline transform then
           comes off onto a class pose that already agrees with it (`handBack`). */
        const release = () => {
          settling = null;
          flushSync(() => onOpenChangeRef.current(toOpen));
          handBack();
        };

        /* The drag itself is never gated — direct manipulation is not an animation —
         * so a tier affects only the *release*. Off snaps to the committed end;
         * reduced and standard both spring: the finger has already put the panel
         * most of the way there, and cutting the last few pixels reads as the
         * gesture being dropped, not as less motion. */
        if (!d || motionTier('overlay') === 'off') {
          release();
          return;
        }

        const target = toOpen ? 0 : -width;
        /* The panel's own springs, the same ones the tap-driven transition uses:
         * `DefaultSpatial` open, `FastEffects` shut, as `NavigationDrawer.kt`
         * assigns them — a gesture and a tap must not land differently. No velocity
         * scaling: a duration scaled by distance double-counts; a spring already
         * covers a shorter remaining distance in less time. */
        const spec = toOpen ? spring('defaultSpatial', 'overlay') : spring('fastEffects', 'overlay');

        settling = toOpen;
        if (s)
          gsap.to(s, {
            opacity: toOpen ? 1 : 0,
            ...spec,
            overwrite: true,
          });
        gsap.to(d, {
          x: target,
          ...spec,
          overwrite: true,
          onComplete: release,
        });
      });

      /* **Opened or closed from elsewhere while the gesture owns the panel** — Back (on a
         phone the edge Back gesture arrives as this very drag before the system takes it),
         Esc, a row, a route change; or the menu button during a release. React's state
         stands: the panel goes from where it is to that state on the drawer's own spring for
         the direction, and the drag's release, when the finger lifts, finds nothing to do. A
         release already springing the other way is turned round. React already has the state,
         so nothing is told; the class takes over at the end. A release's own state change
         never lands here: it clears `settling` before it tells React. */
      interrupt.current = contextSafe!((openNow: boolean) => {
        pending = false;
        if (!active && settling === null) return;
        if (!active && settling === openNow) return;
        active = false;
        const d = drawer();
        const s = scrim();
        if (!d || width <= 0 || motionTier('overlay') === 'off') {
          settling = null;
          if (d) gsap.killTweensOf(d);
          if (s) gsap.killTweensOf(s);
          handBack();
          return;
        }
        settling = openNow;
        const spec = openNow ? spring('defaultSpatial', 'overlay') : spring('fastEffects', 'overlay');
        if (s) gsap.to(s, { opacity: openNow ? 1 : 0, ...spec, overwrite: true });
        gsap.to(d, {
          x: openNow ? 0 : -width,
          ...spec,
          overwrite: true,
          onComplete: () => {
            settling = null;
            handBack();
          },
        });
      });

      const observer = Observer.create({
        target: document.body,
        // Touch only. Hijacking a left-drag from a desktop pointer would break
        // text selection near the window edge, and those users have the header
        // button anyway.
        type: 'touch',
        dragMinimum: 8,
        lockAxis: true,
        tolerance: 4,
        ignore: '[data-no-drawer-swipe]',
        onDragStart: (self) => {
          const startX = self.startX ?? 0;
          // Opening is anchored to the screen edge; closing can start anywhere on
          // the panel, which is the only thing under the finger while it is open.
          // Only a drag that starts on the open panel counts.
          pending = openRef.current && startX <= (drawer()?.offsetWidth ?? 0);
        },
        onDrag: (self) => {
          if (pending) {
            if (self.axis === 'y') {
              pending = false;
              return;
            }
            if (self.axis !== 'x' || !begin()) return;
            pending = false;
          }
          if (!active) return;
          place(gsap.utils.clamp(-width, 0, startOffset + (self.x ?? 0) - (self.startX ?? 0)));
        },
        onDragEnd: (self) => {
          pending = false;
          if (!active) return;
          const d = drawer();
          const x = d ? (gsap.getProperty(d, 'x') as number) : startOffset;
          const flick = Math.abs(self.velocityX) > DRAWER_FLICK_VELOCITY;
          /* `(x + width) / width` is the fraction still *visible*, so the drawer stays open
             only while more than 1 − ratio of it is on screen: a slow drag commits once it
             has travelled the ratio. (Compared against the ratio itself, a half-way drag —
             which closes every native drawer — sprang back open.) */
          settle(
            flick ? self.velocityX > 0 : (x + width) / width > 1 - DRAWER_COMMIT_RATIO,
          );
        },
      });

      /* `enabled` flipping (a picture's route, the docked breakpoint) or unmount, mid-gesture
       * or not. `context.revert()` has already run the gesture's tweens back by the time this
       * is called — and for a transform that leaves GSAP's own resting pose inline
       * (`translate3d(0,0,0)` with `translate: none`), which outranks the class: a closed
       * drawer stood on screen, inert, until a reload. So everything comes off here, the raw
       * writes `begin()` makes included (`element.style`, which no revert sees). A gesture cut
       * short is not finished by a spring that will never run: a release that was taking the
       * drawer shut still shuts it, and a finger's drag ends with the drawer as React has it. */
      return () => {
        observer.kill();
        interrupt.current = null;
        const closing = settling === false;
        active = false;
        pending = false;
        settling = null;
        handBack();
        if (closing && openRef.current) onOpenChangeRef.current(false);
      };
    },
    { dependencies: [enabled], revertOnUpdate: true },
  );
}

/**
 * `useDrawerSwipe` as a component that renders nothing — what `lib/motionLazy.tsx` mounts once
 * the engine is resident. The hook is called here, by name; handed across the import boundary as
 * a value, it made the React Compiler skip the component calling it.
 */
export function DrawerSwipeHost(options: DrawerSwipeOptions) {
  useDrawerSwipe(options);
  return null;
}
