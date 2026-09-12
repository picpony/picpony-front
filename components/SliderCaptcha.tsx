'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { api } from '@/lib/api';
import { encodeTrack, clamp, clamp01 } from '@/lib/utils';
import { gsap, spring } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
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
  const [sliderX, setSliderX] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [keyboardRejected, setKeyboardRejected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const instructionsId = useId();

  const sliderXRef = useRef(0);
  const sliderBtnRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const trackRefElement = useRef<HTMLDivElement>(null);
  const snapTweenRef = useRef<gsap.core.Tween | null>(null);
  const fetchedRef = useRef(false);
  const trackRef = useRef<[number, number, number][]>([]);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const loadingRef = useRef(true);
  const verifyingRef = useRef(false);
  const challengeReadyRef = useRef(false);
  const draggingRef = useRef(false);
  const keyboardRef = useRef(false);
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
  // Latest callbacks for document-level listeners (avoid stale closures /
  // re-binding mid-gesture when handleStart identity changes).
  const onVerifyRef = useRef(onVerify);

  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);

  const measureLayout = useCallback(() => {
    const imageWidth = imageRef.current?.clientWidth || puzzleWidth;
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

  useEffect(() => {
    if (!bgImage) return;
    measureLayout();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measureLayout);
    if (imageRef.current) observer.observe(imageRef.current);
    if (trackRefElement.current) observer.observe(trackRefElement.current);
    return () => observer.disconnect();
  }, [bgImage, measureLayout]);

  /** Glide the knob (and piece) home instead of teleporting after a miss. */
  const snapBack = useCallback(() => {
    snapTweenRef.current?.kill();
    const from = sliderXRef.current;
    sliderXRef.current = 0;
    /* Only `off`. The knob returning home is the control reporting that the
       attempt was rejected — a value snapping back with no travel reads as the
       input never having been registered — so `reduced` keeps the glide. */
    if (from <= 0 || motionTier() === 'off') {
      setSliderX(0);
      return;
    }
    const proxy = { x: from };
    snapTweenRef.current = gsap.to(proxy, {
      x: 0,
      /* `fast-spatial`, the spring `Switch.kt` gives a handle. */
      ...spring('fastSpatial'),
      onUpdate: () => {
        sliderXRef.current = proxy.x;
        setSliderX(proxy.x);
      },
      onComplete: () => {
        sliderXRef.current = 0;
      },
    });
  }, []);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        requestRef.current += 1;
        snapTweenRef.current?.kill();
        removeDragListenersRef.current?.();
      };
    },
    [],
  );

  // Physical feedback on failure: shake the puzzle while the error overlay
  // fades in.
  useEffect(() => {
    /* The shake is pure feedback with no state in it, so both non-standard tiers
        drop it and the error overlay's own fade carries the message. */
    if (!errorMsg || motionTier() !== 'standard') return;
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
    });
    return () => {
      tween.kill();
    };
  }, [errorMsg]);

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

  const fetchCaptcha = useCallback(async () => {
    const request = ++requestRef.current;
    removeDragListenersRef.current?.();
    snapTweenRef.current?.kill();
    setLoading(true);
    setVerifying(false);
    verifyingRef.current = false;
    loadingRef.current = true;
    challengeReadyRef.current = false;
    setSliderX(0);
    sliderXRef.current = 0;
    setErrorMsg('');
    setKeyboardRejected(false);
    trackRef.current = [];
    draggingRef.current = false;
    keyboardRef.current = false;
    setIsDragging(false);
    setBgImage('');
    setPieceImage('');
    try {
      const data = await api.captchaGet();
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      if (data.success && data.bg && data.piece && Number.isFinite(data.y)) {
        challengeReadyRef.current = true;
        setBgImage(data.bg);
        setPieceImage(data.piece);
        setPieceY(data.y);
      } else {
        setErrorMsg('获取验证码失败');
      }
    } catch {
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      setErrorMsg('网络错误，请稍后再试');
    }
    setLoading(false);
    loadingRef.current = false;
  }, []);

  useEffect(() => {
    if (!active) {
      requestRef.current += 1;
      challengeReadyRef.current = false;
      removeDragListenersRef.current?.();
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchCaptcha();
    return () => { fetchedRef.current = false; };
  }, [active, fetchCaptcha]);

  // Both input methods send only actual movement samples in the existing
  // logical coordinate space. Keyboard input does not synthesize mouse events
  // or add random motion to imitate a pointer; the server still decides validity.
  const submitTrack = useCallback(async () => {
    if (!challengeReadyRef.current || loadingRef.current || verifyingRef.current || !trackRef.current.length) return;
    const finalX = sliderXRef.current;
    if (finalX < 5) {
      snapBack();
      keyboardRef.current = false;
      trackRef.current = [];
      return;
    }
    const request = requestRef.current;
    const keyboardAttempt = keyboardRef.current;
    setVerifying(true);
    verifyingRef.current = true;
    challengeReadyRef.current = false;
    keyboardRef.current = false;
    try {
      const data = await api.captchaVerify(finalX, encodeTrack(trackRef.current));
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      if (data.success && data.token) {
        onVerifyRef.current(data.token);
      } else {
        snapBack();
        trackRef.current = [];
        const fail = data as { error?: string; message?: string };
        setKeyboardRejected(keyboardAttempt);
        setErrorMsg(fail.error || fail.message || '验证失败，请重试');
      }
    } catch {
      if (!mountedRef.current || !activeRef.current || request !== requestRef.current) return;
      snapBack();
      trackRef.current = [];
      setErrorMsg('网络错误，请稍后再试');
    } finally {
      if (mountedRef.current && activeRef.current && request === requestRef.current) {
        setVerifying(false);
        verifyingRef.current = false;
      }
    }
  }, [snapBack]);

  const startDrag = useCallback(
    (e: MouseEvent | TouchEvent) => {
      // A rejected challenge is refreshed explicitly; the error stays visible
      // until the user is ready to retry, instead of disappearing on a timer.
      if (!challengeReadyRef.current || loadingRef.current || verifyingRef.current || draggingRef.current) return;
      if ('cancelable' in e && e.cancelable) e.preventDefault();

      draggingRef.current = true;
      keyboardRef.current = false;
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
        setSliderX(x);

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
    [maxSliderX, snapBack, submitTrack],
  );

  // Native non-passive touchstart, re-bound when the knob mounts (after bgImage).
  useEffect(() => {
    if (!bgImage) return;
    const btn = sliderBtnRef.current;
    if (!btn) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      startDrag(e);
    };
    btn.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => btn.removeEventListener('touchstart', onTouchStart);
  }, [bgImage, startDrag]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      startDrag(e.nativeEvent);
    },
    [startDrag],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!challengeReadyRef.current || loadingRef.current || verifyingRef.current || draggingRef.current) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (keyboardRef.current) {
        const last = trackRef.current.at(-1);
        const sample: [number, number, number] = [Math.round(sliderXRef.current), 0, Date.now() - startTimeRef.current];
        if (!last || last[2] !== sample[2]) {
          if (trackRef.current.length < 150) trackRef.current.push(sample);
          else trackRef.current[149] = sample;
        }
        void submitTrack();
      }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    if (!keyboardRef.current) {
      snapTweenRef.current?.kill();
      keyboardRef.current = true;
      sliderXRef.current = 0;
      startTimeRef.current = Date.now();
      trackRef.current = [[0, 0, 0]];
      setErrorMsg('');
    }
    const step = event.shiftKey || event.key.startsWith('Page') ? 10 : 1;
    const direction = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? maxSliderX :
      clamp(sliderXRef.current + direction * step, 0, maxSliderX);
    if (next === sliderXRef.current) return;
    sliderXRef.current = next;
    setSliderX(next);
    const sample: [number, number, number] = [next, 0, Date.now() - startTimeRef.current];
    if (trackRef.current.length < 150) trackRef.current.push(sample);
    else trackRef.current[149] = sample;
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div ref={containerRef} className="relative w-full max-w-78">
        {loading && !bgImage && (
          /* A `Skeleton` in the puzzle's own box, not a `Spinner` inside it: the
             box is already reserved at the exact aspect ratio, so there is a
             destination shape to load into. */
          <Skeleton
            className="w-full rounded-md"
            style={{ aspectRatio: `${puzzleWidth} / ${puzzleHeight}` }}
          />
        )}

        {bgImage && (
          <div
            ref={imageRef}
            className="relative w-full bg-surface-container-highest rounded-md overflow-hidden animate-fade-in"
            style={{ aspectRatio: `${puzzleWidth} / ${puzzleHeight}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bgImage} alt="验证码背景" className="w-full h-full block" draggable={false} />
            {pieceImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pieceImage}
                alt="滑动拼图"
                className="absolute pointer-events-none drop-shadow-[var(--md-sys-elevation-drop-1)]"
                style={{
                  top: `${(pieceY * layout.imageWidth) / puzzleWidth}px`,
                  left: `${(sliderX * layout.imageMaxX) / maxSliderX}px`,
                  width: `${layout.imagePieceSize}px`,
                  height: `${layout.imagePieceSize}px`,
                }}
                draggable={false}
              />
            )}
            {verifying && (
              <div className="bg-media-plate animate-fade-in absolute inset-0 z-20 flex items-center justify-center">
                <Spinner size="lg" tone="on-primary" />
              </div>
            )}
          </div>
        )}
      </div>

      {bgImage && (
        <div
          ref={trackRefElement}
          className="relative w-full max-w-78 h-10 bg-surface-container-high rounded-full border border-outline-variant mt-2"
          style={{ touchAction: 'none' }}
        >
          <div
            className="bg-success-container h-full rounded-full transition-none"
            style={{
              width: `${(sliderX / maxSliderX) * layout.barMaxX + layout.barButtonWidth}px`,
            }}
          />

          <div
            ref={sliderBtnRef}
            role="slider"
            tabIndex={loading || verifying || Boolean(errorMsg) ? -1 : 0}
            aria-label="拼图位置"
            aria-describedby={instructionsId}
            aria-valuemin={0}
            aria-valuemax={maxSliderX}
            aria-valuenow={Math.round(sliderX)}
            aria-valuetext={`${Math.round(sliderX)} / ${maxSliderX}`}
            aria-disabled={loading || verifying || Boolean(errorMsg)}
            /* `duration-press` + `standard`, the motion table's press row:
               grabbing the handle is a press, and the fill must keep up with the
               handle under the finger.

               No scale on grab, no elevation at all — a slider handle is level 0
               (the primitive gives its handle no shadow either), and the state
               layer is what reports the press. */
            className={`bg-surface-raised text-title-m state-layer focus-ring outline-none focus-visible:ring-2 absolute -top-px z-10 flex h-10 items-center justify-center rounded-full border border-outline transition-[color,background-color,border-color] duration-press ease-[var(--ease-standard)] select-none ${
              isDragging
                ? 'cursor-grabbing bg-success-fill text-on-fill border-success-fill'
                : 'cursor-grab text-on-surface-variant'
            } ${verifying ? 'pointer-events-none disabled-content' : ''}`}
            style={{
              left: `${(sliderX / maxSliderX) * layout.barMaxX}px`,
              width: `${layout.barButtonWidth}px`,
              touchAction: 'none',
            }}
            onMouseDown={onMouseDown}
            onKeyDown={onKeyDown}
          >
            &rarr;
          </div>
        </div>
      )}
      <p id={instructionsId} className="text-body-s text-on-surface-variant max-w-78 text-center">
        拖动拼图对齐缺口。也可用方向键微调，按住 Shift 快移，按 Enter 提交。
      </p>
      {errorMsg && !loading && !verifying && (
        <div role="alert" className="w-full max-w-78">
          <ErrorRetry size="inline" title={errorMsg}
            message={keyboardRejected ? '这次键盘操作未通过校验。重试仍失败时，可通过运营团队入口寻求帮助。' : undefined}
            onRetry={() => void fetchCaptcha()} retryLabel="重新获取验证码" />
        </div>
      )}
      <p className="text-body-s text-on-surface-variant max-w-78 text-center">
        无法完成拼图时，可查看{' '}
        <a href="/about" target="_blank" rel="noreferrer" className="text-primary-ink underline underline-offset-2">
          运营团队的联系入口（新窗口）
        </a>。
      </p>
    </div>
  );
}
