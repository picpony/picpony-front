'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { MdArrowForward } from 'react-icons/md';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api/errors';
import { envelopeMessage } from '@/lib/api/http';
import { encodeTrack, clamp, clamp01, cn } from '@/lib/utils';
import { gsap, spring } from '@/lib/motion';
import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import Spinner from './Spinner';
import Skeleton from './Skeleton';
import ErrorRetry from './ErrorRetry';

interface SliderCaptchaProps {
  onVerify: (token: string) => void;
  /** A closing Modal keeps its contents mounted for the exit animation. */
  active: boolean;
}

/**
 * Drag / track logic mirrors the production Vue captcha on picpony.top
 * (assets/main-*.js → startDrag / onDrag / stopDrag), which is known to
 * pass backend checks on both desktop and mobile:
 *
 *   start:  track = [[0, 0, 0]]
 *   move:   visual knob position is normalized to logical x in [0, 260]
 *           relY = clientY - startY
 *           track.push([round(x), round(relY), elapsed])  // max 150 pts
 *   submit: { x: sliderX, track: xor90_btoa(JSON(track)) }
 *
 * The backend always receives the 310px logical coordinate space. The visual
 * track can be narrower on mobile, so pointer movement is converted back to
 * that space before samples and the final x are submitted. The event model
 * remains the production-compatible document-level mouse/touch path.
 *
 * **One box for every state.** The widget has its own width (the puzzle's 310
 * logical pixels, capped by the dialog), so the dialog it sits in — which is as
 * wide as its content — is the same size loading, loaded and failed: the loading
 * skeleton used to have no width of its own, so every open showed a narrow card
 * that jumped wider when the challenge arrived. The puzzle box keeps its aspect
 * ratio in all three states, the track is always drawn, and a failure is reported
 * in the hint line under it rather than in a block that grew the card.
 *
 * **A drag writes transforms, not React state.** The knob, the fill behind it and
 * the puzzle piece are moved with `translateX` through refs on every pointer
 * frame and every frame of the snap-back; nothing re-renders until the drag ends.
 */
export default function SliderCaptcha({ onVerify, active }: SliderCaptchaProps) {
  const puzzleWidth = 310;
  const puzzleHeight = 155;
  const pieceSize = 50;
  const maxSliderX = puzzleWidth - pieceSize;
  /** `long1` on M3's scale — the shake is a pre-sampled keyframe track, so this
   *  is its whole clock and the curve is `none`. */
  const SHAKE_SECONDS = 0.45;

  const [bgImage, setBgImage] = useState('');
  const [pieceImage, setPieceImage] = useState('');
  const [pieceY, setPieceY] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  /** A challenge is on screen and accepts a drag. */
  const [ready, setReady] = useState(false);
  /** Why the last attempt failed — printed in the hint line until the next drag. */
  const [errorMsg, setErrorMsg] = useState('');
  /** The challenge itself could not be loaded; the box offers a retry. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const sliderXRef = useRef(0);
  const sliderBtnRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const pieceRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const trackRefElement = useRef<HTMLDivElement>(null);
  const snapTweenRef = useRef<gsap.core.Tween | null>(null);
  const refetchTimerRef = useRef(0);
  const fetchedRef = useRef(false);
  const trackRef = useRef<[number, number, number][]>([]);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const loadingRef = useRef(true);
  const verifyingRef = useRef(false);
  const challengeReadyRef = useRef(false);
  const draggingRef = useRef(false);
  const mountedRef = useRef(false);
  const activeRef = useRef(active);
  const requestRef = useRef(0);
  const removeDragListenersRef = useRef<(() => void) | null>(null);
  const grabRatioRef = useRef(0.5);
  const [layout, setLayout] = useState({
    imageWidth: puzzleWidth,
    imagePieceSize: pieceSize,
    imageMaxX: maxSliderX,
    barWidth: puzzleWidth,
    barButtonWidth: pieceSize,
    barMaxX: maxSliderX,
  });
  const layoutRef = useRef(layout);
  // Latest callbacks for document-level listeners (avoid stale closures /
  // re-binding mid-gesture when handleStart identity changes).
  const onVerifyRef = useRef(onVerify);

  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);

  const setChallengeReady = useCallback((value: boolean) => {
    challengeReadyRef.current = value;
    setReady(value);
  }, []);

  /** Put the knob, its fill and the piece at logical `x` — a style write, no render. */
  const paint = useCallback(
    (x: number) => {
      const { imageMaxX, barMaxX, barButtonWidth, barWidth } = layoutRef.current;
      const knobX = (x / maxSliderX) * barMaxX;
      if (sliderBtnRef.current) sliderBtnRef.current.style.transform = `translateX(${knobX}px)`;
      /* The fill is a full-width pill whose trailing cap rides under the knob's; the
         track clips what lies before its own leading edge. */
      if (fillRef.current) {
        fillRef.current.style.transform = `translateX(${knobX + barButtonWidth - barWidth}px)`;
      }
      if (pieceRef.current) pieceRef.current.style.transform = `translateX(${(x * imageMaxX) / maxSliderX}px)`;
    },
    [maxSliderX],
  );

  const measureLayout = useCallback(() => {
    const imageWidth = imageRef.current?.clientWidth || containerRef.current?.clientWidth || puzzleWidth;
    const barWidth = trackRefElement.current?.clientWidth || puzzleWidth;
    const nextLayout = {
      imageWidth,
      imagePieceSize: (imageWidth * pieceSize) / puzzleWidth,
      imageMaxX: (imageWidth * maxSliderX) / puzzleWidth,
      barWidth,
      barButtonWidth: (barWidth * pieceSize) / puzzleWidth,
      barMaxX: (barWidth * maxSliderX) / puzzleWidth,
    };

    setLayout((previous) => {
      const changed = Object.keys(nextLayout).some((key) => {
        const field = key as keyof typeof nextLayout;
        return Math.abs(nextLayout[field] - previous[field]) > 0.5;
      });
      return changed ? nextLayout : previous;
    });
  }, [maxSliderX, pieceSize, puzzleWidth]);

  // The box and the track are always drawn, so they are measured from the first frame.
  useLayoutEffect(() => {
    measureLayout();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureLayout);
    if (containerRef.current) observer.observe(containerRef.current);
    if (trackRefElement.current) observer.observe(trackRefElement.current);
    return () => observer.disconnect();
  }, [measureLayout]);

  // A new geometry, or a new piece: repaint the current position into it.
  useLayoutEffect(() => {
    layoutRef.current = layout;
    paint(sliderXRef.current);
  }, [layout, pieceImage, paint]);

  /** Glide the knob (and piece) home instead of teleporting after a miss. */
  const snapBack = useCallback(() => {
    snapTweenRef.current?.kill();
    const from = sliderXRef.current;
    sliderXRef.current = 0;
    /* Only `off`. The knob returning home is the control reporting that the
       attempt was rejected — a value snapping back with no travel reads as the
       input never having been registered — so `reduced` keeps the glide. */
    if (from <= 0 || motionTier() === 'off') {
      paint(0);
      return;
    }
    const proxy = { x: from };
    snapTweenRef.current = gsap.to(proxy, {
      x: 0,
      /* `fast-spatial`, the spring `Switch.kt` gives a handle. */
      ...spring('fastSpatial'),
      onUpdate: () => {
        sliderXRef.current = proxy.x;
        paint(proxy.x);
      },
      onComplete: () => {
        sliderXRef.current = 0;
        paint(0);
      },
    });
  }, [paint]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        requestRef.current += 1;
        snapTweenRef.current?.kill();
        window.clearTimeout(refetchTimerRef.current);
        removeDragListenersRef.current?.();
      };
    },
    [],
  );

  // Physical feedback on failure: shake the puzzle while the message appears.
  useEffect(() => {
    /* The shake is pure feedback with no state in it, so both non-standard tiers
        drop it and the message under the track carries the failure alone. */
    if (!errorMsg || loadFailed || motionTier() !== 'standard') return;
    const el = containerRef.current;
    if (!el) return;
    const tween = gsap.to(el, {
      keyframes: { x: [0, -9, 8, -5, 3, 0] },
      duration: SHAKE_SECONDS,
      /* `none`, because the amplitudes are already in the keyframe list: laying a
          curve over an explicit track re-shapes the whole shake, so the numbers
          were not the ones that played. The pre-sampled-track case the motion
          rules allow `linear` for. */
      ease: 'none',
      clearProps: 'transform',
    });
    return () => {
      tween.kill();
      gsap.set(el, { clearProps: 'transform' });
    };
  }, [errorMsg, loadFailed]);

  const getClientX = (e: MouseEvent | TouchEvent): number => {
    if ('touches' in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return t ? t.clientX : 0;
    }
    return e.clientX;
  };

  const getClientY = (e: MouseEvent | TouchEvent): number => {
    if ('touches' in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return t ? t.clientY : 0;
    }
    return e.clientY;
  };

  /**
   * Load a challenge. `keepError` leaves the last attempt's message on screen: a
   * rejected attempt is followed by a fresh challenge at once (the old one is spent
   * server-side), and the reason it failed must stay readable while it loads.
   */
  const fetchCaptcha = useCallback(async ({ keepError = false }: { keepError?: boolean } = {}) => {
    const request = ++requestRef.current;
    window.clearTimeout(refetchTimerRef.current);
    removeDragListenersRef.current?.();
    snapTweenRef.current?.kill();
    setLoading(true);
    setVerifying(false);
    verifyingRef.current = false;
    loadingRef.current = true;
    setChallengeReady(false);
    sliderXRef.current = 0;
    paint(0);
    if (!keepError) setErrorMsg('');
    setLoadFailed(false);
    trackRef.current = [];
    draggingRef.current = false;
    setIsDragging(false);
    setBgImage('');
    setPieceImage('');
    try {
      const data = await api.captchaGet();
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      if (data.success && data.bg && data.piece && Number.isFinite(data.y)) {
        setChallengeReady(true);
        setBgImage(data.bg);
        setPieceImage(data.piece);
        setPieceY(data.y);
      } else {
        setLoadFailed(true);
        setErrorMsg(envelopeMessage(data) ?? '请稍后再试');
      }
    } catch (err) {
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      setLoadFailed(true);
      setErrorMsg(apiErrorMessage(err));
    }
    setLoading(false);
    loadingRef.current = false;
  }, [paint, setChallengeReady]);

  useEffect(() => {
    if (!active) {
      requestRef.current += 1;
      window.clearTimeout(refetchTimerRef.current);
      // The ref alone: a leaving dialog's knob does not need to redraw, and a reopen fetches anew.
      challengeReadyRef.current = false;
      removeDragListenersRef.current?.();
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchCaptcha();
    return () => { fetchedRef.current = false; };
  }, [active, fetchCaptcha]);

  /**
   * A rejected attempt: report it, glide the knob home, and — once the shake has
   * played — load the next challenge, so the knob works again without a detour
   * through a retry button. A wall-clock bound on a GSAP animation, so it takes the
   * slowest speed's scale (see AGENTS.md on timers that outlast motion).
   */
  const rejectAttempt = useCallback(
    (message: string) => {
      snapBack();
      trackRef.current = [];
      setErrorMsg(message);
      window.clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current && activeRef.current) void fetchCaptcha({ keepError: true });
      }, SHAKE_SECONDS * 1000 * MOTION_SPEED_SCALE.slow);
    },
    [fetchCaptcha, snapBack],
  );

  // Mouse and touch drags send their actual movement in the backend's logical coordinates.
  const submitTrack = useCallback(async () => {
    if (!challengeReadyRef.current || loadingRef.current || verifyingRef.current || !trackRef.current.length) return;
    const finalX = sliderXRef.current;
    if (finalX < 5) {
      snapBack();
      trackRef.current = [];
      return;
    }
    const request = requestRef.current;
    setVerifying(true);
    verifyingRef.current = true;
    setChallengeReady(false);
    try {
      const data = await api.captchaVerify(finalX, encodeTrack(trackRef.current));
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      if (data.success && data.token) {
        onVerifyRef.current(data.token);
      } else {
        rejectAttempt(envelopeMessage(data) ?? '验证失败，请重试');
      }
    } catch (err) {
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      rejectAttempt(apiErrorMessage(err));
    } finally {
      if (mountedRef.current && activeRef.current && request === requestRef.current) {
        setVerifying(false);
        verifyingRef.current = false;
      }
    }
  }, [rejectAttempt, setChallengeReady, snapBack]);

  const startDrag = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!challengeReadyRef.current || loadingRef.current || verifyingRef.current || draggingRef.current) return;
      if ('cancelable' in e && e.cancelable) e.preventDefault();

      draggingRef.current = true;
      setIsDragging(true);
      setErrorMsg('');
      snapTweenRef.current?.kill();

      const clientX = getClientX(e);
      const clientY = getClientY(e);
      const bar = trackRefElement.current;
      const button = sliderBtnRef.current;
      const buttonRect = button?.getBoundingClientRect();
      grabRatioRef.current =
        buttonRect && buttonRect.width > 0
          ? clamp01((clientX - buttonRect.left) / buttonRect.width)
          : 0.5;
      startXRef.current = clientX;
      startYRef.current = clientY;
      startTimeRef.current = Date.now();
      // Production always seeds with [0, 0, 0] (relative coordinates).
      trackRef.current = [[0, 0, 0]];

      const onDrag = (moveEvent: MouseEvent | TouchEvent) => {
        if (!draggingRef.current) return;
        if ('cancelable' in moveEvent && moveEvent.cancelable) moveEvent.preventDefault();

        const currentBarRect = bar?.getBoundingClientRect();
        let x = getClientX(moveEvent) - startXRef.current;
        if (bar && button && currentBarRect && bar.offsetWidth > 0) {
          const transformScale = currentBarRect.width / bar.offsetWidth;
          const contentLeft = currentBarRect.left + bar.clientLeft * transformScale;
          const contentWidth = bar.clientWidth * transformScale;
          const buttonWidth = button.offsetWidth * transformScale;
          const visualMaxX = Math.max(1, contentWidth - buttonWidth);
          const visualLeft =
            getClientX(moveEvent) - contentLeft - buttonWidth * grabRatioRef.current;
          x = (visualLeft / visualMaxX) * maxSliderX;
        }
        x = clamp(x, 0, maxSliderX);

        sliderXRef.current = x;
        paint(x);

        const relY = getClientY(moveEvent) - startYRef.current;
        const elapsed = Date.now() - startTimeRef.current;

        if (trackRef.current.length < 150) {
          const last = trackRef.current[trackRef.current.length - 1];
          const sx = Math.round(x);
          const sy = Math.round(relY);
          if (!last || last[0] !== sx || last[1] !== sy || last[2] !== elapsed) {
            trackRef.current.push([sx, sy, elapsed]);
          }
        }
      };

      const removeDragListeners = () => {
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('touchmove', onDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchend', stopDrag);
        document.removeEventListener('touchcancel', cancelDrag);
        removeDragListenersRef.current = null;
      };

      const cancelDrag = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setIsDragging(false);
        removeDragListeners();
        trackRef.current = [];
        snapBack();
      };

      const stopDrag = (endEvent: MouseEvent | TouchEvent) => {
        if (!draggingRef.current) return;
        onDrag(endEvent);
        draggingRef.current = false;
        setIsDragging(false);
        removeDragListeners();

        const finalX = sliderXRef.current;
        const finalSample: [number, number, number] = [
          Math.round(finalX),
          Math.round(getClientY(endEvent) - startYRef.current),
          Date.now() - startTimeRef.current,
        ];
        const lastSample = trackRef.current[trackRef.current.length - 1];
        if (
          !lastSample ||
          lastSample[0] !== finalSample[0] ||
          lastSample[1] !== finalSample[1] ||
          lastSample[2] !== finalSample[2]
        ) {
          if (trackRef.current.length < 150) trackRef.current.push(finalSample);
          else trackRef.current[trackRef.current.length - 1] = finalSample;
        }
        void submitTrack();
      };

      removeDragListenersRef.current = removeDragListeners;
      document.addEventListener('mousemove', onDrag);
      // passive:false so touch scrolling doesn't steal the gesture on mobile
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchend', stopDrag);
      document.addEventListener('touchcancel', cancelDrag);
    },
    [maxSliderX, paint, snapBack, submitTrack],
  );

  // Native non-passive touchstart on the knob, which is drawn from the first frame.
  useEffect(() => {
    const btn = sliderBtnRef.current;
    if (!btn) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      startDrag(e);
    };
    btn.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => btn.removeEventListener('touchstart', onTouchStart);
  }, [startDrag]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      startDrag(e.nativeEvent);
    },
    [startDrag],
  );

  return (
    /* The puzzle's own width (310 logical pixels, within the 4dp grid's 312), capped
       by whatever the dialog can give on a narrow phone. */
    <div className="flex w-78 max-w-full flex-col items-center gap-4">
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ aspectRatio: `${puzzleWidth} / ${puzzleHeight}` }}
      >
        {bgImage ? (
          <div
            ref={imageRef}
            className="relative h-full w-full bg-surface-container-highest rounded-md overflow-hidden animate-fade-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bgImage} alt="验证码背景" className="w-full h-full block" draggable={false} />
            {pieceImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={pieceRef}
                src={pieceImage}
                alt="滑动拼图"
                className="absolute left-0 pointer-events-none drop-shadow-[var(--md-sys-elevation-drop-1)]"
                style={{
                  top: `${(pieceY * layout.imageWidth) / puzzleWidth}px`,
                  width: `${layout.imagePieceSize}px`,
                  height: `${layout.imagePieceSize}px`,
                }}
                draggable={false}
              />
            )}
            {verifying && (
              <div className="bg-media-plate text-on-media animate-fade-in absolute inset-0 z-20 flex items-center justify-center">
                <Spinner size="lg" tone="inherit" />
              </div>
            )}
          </div>
        ) : loadFailed && !loading ? (
          <div className="bg-surface-container-highest flex h-full w-full items-center justify-center rounded-md">
            <ErrorRetry
              size="inline"
              title="验证码加载失败"
              onRetry={() => void fetchCaptcha()}
              retryLabel="重新获取验证码"
            />
          </div>
        ) : (
          /* A `Skeleton` in the puzzle's own box, not a `Spinner` inside it: the
             box is already reserved at the exact aspect ratio, so there is a
             destination shape to load into. */
          <Skeleton className="h-full w-full rounded-md" />
        )}
      </div>

      <div
        ref={trackRefElement}
        /* The disabled treatment is on the whole track, not the knob: faded as one group,
           the knob still hides the fill under it — a translucent knob showed the fill
           through it as a stray green disc. */
        className={cn(
          'relative w-full h-10 bg-surface-container-high rounded-full border border-outline-variant mt-2 touch-none',
          !ready && 'disabled-content',
        )}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
          <div ref={fillRef} className="bg-success-container h-full w-full rounded-full" />
        </div>

        <div
          ref={sliderBtnRef}
          /* `duration-press` + `standard`, the motion table's press row:
             grabbing the handle is a press, and the fill must keep up with the
             handle under the finger.

             No scale on grab, no elevation at all — a slider handle is level 0
             (the primitive gives its handle no shadow either), and the state
             layer is what reports the press. While there is no challenge to
             solve (loading, checking, or failed) the track wears the disabled
             treatment once, rather than blinking between attempts. */
          className={cn(
            'state-layer absolute -top-px left-0 z-10 flex h-10 items-center justify-center rounded-full border touch-none select-none transition-[color,background-color,border-color] duration-press ease-[var(--ease-standard)]',
            isDragging
              ? 'cursor-grabbing bg-success-fill text-on-fill border-success-fill'
              : 'cursor-grab bg-surface-raised text-on-surface-variant border-outline',
            !ready && 'pointer-events-none',
          )}
          style={{ width: `${layout.barButtonWidth}px` }}
          onMouseDown={onMouseDown}
        >
          <MdArrowForward size={ICON.control} aria-hidden="true" />
        </div>
      </div>
      {/* The hint, or why the last attempt failed — one line in one place, so a
          failure neither grows the card nor needs a second control to recover from. */}
      <p className={cn('text-body-s text-center', errorMsg ? 'text-error' : 'text-on-surface-variant')}>
        {/* Only the failure is announced; the hint coming back after it is not news. */}
        <span aria-live="polite">{errorMsg}</span>
        {!errorMsg && '拖动拼图对齐缺口。'}
      </p>
    </div>
  );
}
