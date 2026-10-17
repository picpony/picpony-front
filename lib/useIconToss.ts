'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { motionTier, scaledMs, subscribeAppearance } from '@/lib/appearance';

/** A reaction's filled glyph leaves on a press, never on hydration or a cache update. */
export function useIconToss(identity: string | number) {
  const ref = useRef<HTMLButtonElement>(null);
  const flights = useRef(new Set<() => void>());

  useLayoutEffect(() => {
    const active = flights.current;
    const clear = () => { for (const stop of active) stop(); };
    const unsubscribe = subscribeAppearance(clear);
    // A viewport-fixed decoration must not outlive its source's position or screen.
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    return () => {
      clear();
      unsubscribe();
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('resize', clear);
    };
  }, [identity]);

  const toss = useCallback(() => {
    const source = ref.current?.querySelector<SVGSVGElement>(':scope > svg');
    // Reduced motion keeps the button's ordinary state feedback, without the
    // decorative flight across the viewport. Off likewise creates no decoration.
    if (!source || motionTier() !== 'standard') return;
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const color = getComputedStyle(source).color;
    const glyph = source.cloneNode(true) as SVGSVGElement;
    // The copy keeps the filled path and ink, but not the star's arrival animation.
    glyph.removeAttribute('class');
    glyph.removeAttribute('style');
    glyph.setAttribute('focusable', 'false');
    Object.assign(glyph.style, { display: 'block', width: '100%', height: '100%' });
    const flyer = document.createElement('span');
    flyer.dataset.iconToss = '';
    flyer.setAttribute('aria-hidden', 'true');
    flyer.className = 'absolute';
    Object.assign(flyer.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, color,
    });
    flyer.append(glyph);
    // Clip at the viewport, never at the button/card, and never grow a scrollbar.
    // Share the detail's layer, above its content and below app chrome and dialogs.
    const layer = document.createElement('div');
    layer.className = 'pointer-events-none fixed inset-0 overflow-hidden z-detail-overlay';
    layer.setAttribute('aria-hidden', 'true');
    layer.append(flyer);
    document.body.append(layer);

    // A free body, not a spring: x = vx*t, y = vy*t + g*t²/2. Gravity is shared
    // by both glyphs; only the upward impulse and angular velocity vary per press.
    // Near a screen edge, launch inward so the upward arc remains visible.
    const center = rect.left + rect.width / 2;
    const viewportWidth = document.documentElement.clientWidth;
    const direction = center < viewportWidth * 0.2 ? 1
      : center > viewportWidth * 0.8 ? -1 : Math.random() < 0.5 ? -1 : 1;
    const angle = direction * (15 + Math.random() * 35) * Math.PI / 180;
    const impulse = 360 + Math.random() * 100;
    const vx = Math.sin(angle) * impulse;
    const vy = -Math.cos(angle) * impulse;
    const gravity = 1600;
    // Include the diagonal: even the topmost corner of a rotating glyph must
    // clear the bottom before removal. There is no fade or shrink at any point.
    const drop = window.innerHeight - rect.top + Math.hypot(rect.width, rect.height);
    const seconds = (-vy + Math.sqrt(vy * vy + 2 * gravity * drop)) / gravity;
    const spin = direction * (160 + Math.random() * 200);
    const samples = Math.ceil(seconds * 60);
    const frames = Array.from({ length: samples + 1 }, (_, index) => {
      const offset = index / samples;
      const t = seconds * offset;
      return {
        offset,
        transform: `translate3d(${vx * t}px, ${vy * t + gravity * t * t / 2}px, 0) rotate(${spin * t}deg)`,
      };
    });
    // The clock comes from the physical flight time, scaled as a whole by the
    // speed preference. Linear playback preserves the already sampled parabola.
    const travel = flyer.animate(frames, {
      duration: scaledMs(seconds * 1000), easing: 'linear', fill: 'forwards',
    });
    const stop = () => {
      flights.current.delete(stop);
      layer.remove();
      travel.cancel();
    };
    flights.current.add(stop);
    // Both completion and cancellation release the DOM and compositor animations.
    void travel.finished.then(stop, stop);
    return stop;
  }, []);

  return { ref, toss };
}
