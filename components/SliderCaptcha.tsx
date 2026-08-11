'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { encodeTrack } from '@/lib/utils';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import Spinner from './Spinner';
import Skeleton from './Skeleton';

interface SliderCaptchaProps {
  onVerify: (token: string) => void;
  onClose: () => void;
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
export default function SliderCaptcha({ onVerify }: SliderCaptchaProps) {
  const puzzleWidth = 310;
  const puzzleHeight = 155;
  const pieceSize = 50;
  const maxSliderX = puzzleWidth - pieceSize;

  const [bgImage, setBgImage] = useState('');
  const [pieceImage, setPieceImage] = useState('');
  const [pieceY, setPieceY] = useState(0);
  const [sliderX, setSliderX] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);

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
  const draggingRef = useRef(false);
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
  const fetchCaptchaRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);

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
    if (from <= 0 || prefersReducedMotion()) {
      setSliderX(0);
      return;
    }
    const proxy = { x: from };
    snapTweenRef.current = gsap.to(proxy, {
      x: 0,
      duration: 0.5,
      ease: 'expo.out',
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
    () => () => {
      snapTweenRef.current?.kill();
    },
    [],
  );

  // Physical feedback on failure: shake the puzzle while the error overlay
  // fades in.
  useEffect(() => {
    if (!errorMsg || prefersReducedMotion()) return;
    const el = containerRef.current;
    if (!el) return;
    const tween = gsap.to(el, {
      keyframes: { x: [0, -9, 8, -5, 3, 0] },
      duration: 0.45,
      ease: 'power2.out',
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
    setLoading(true);
    loadingRef.current = true;
    setSliderX(0);
    sliderXRef.current = 0;
    setErrorMsg('');
    trackRef.current = [];
    draggingRef.current = false;
    try {
      const data = await api.captchaGet();
      if (data.success) {
        setBgImage(data.bg);
        setPieceImage(data.piece);
        setPieceY(data.y);
      } else {
        setErrorMsg('获取验证码失败');
      }
    } catch {
      setErrorMsg('网络错误，请重试');
    }
    setLoading(false);
    loadingRef.current = false;
  }, []);

  useEffect(() => {
    fetchCaptchaRef.current = fetchCaptcha;
  }, [fetchCaptcha]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchCaptcha();
  }, [fetchCaptcha]);

  const startDrag = useCallback(
    (e: MouseEvent | TouchEvent) => {
      // Mirror production gates, but do NOT lock on errorMsg — a failed attempt
      // must remain re-draggable once the soft error is showing.
      if (loadingRef.current || verifyingRef.current || draggingRef.current) return;
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
          ? Math.max(0, Math.min(1, (clientX - buttonRect.left) / buttonRect.width))
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
        x = Math.max(0, Math.min(maxSliderX, x));

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
      };

      const cancelDrag = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setIsDragging(false);
        removeDragListeners();
        trackRef.current = [];
        snapBack();
      };

      const stopDrag = async (endEvent: MouseEvent | TouchEvent) => {
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
        if (finalX < 5) {
          snapBack();
          trackRef.current = [];
          return;
        }

        setVerifying(true);
        verifyingRef.current = true;
        try {
          const encodedTrack = encodeTrack(trackRef.current);
          const data = await api.captchaVerify(finalX, encodedTrack);
          if (data.success && data.token) {
            onVerifyRef.current(data.token);
          } else {
            snapBack();
            trackRef.current = [];
            // Surface the backend reason (production does the same with n.error).
            // Helps distinguish "对齐" vs "异常拖动" vs "非人类" on mobile.
            const fail = data as { error?: string; message?: string };
            setErrorMsg(fail.error || fail.message || '验证失败，请重试');
            setTimeout(() => {
              void fetchCaptchaRef.current();
            }, 500);
          }
        } catch {
          snapBack();
          trackRef.current = [];
          setErrorMsg('网络错误，请重试');
          setTimeout(() => {
            void fetchCaptchaRef.current();
          }, 500);
        }
        setVerifying(false);
        verifyingRef.current = false;
      };

      document.addEventListener('mousemove', onDrag);
      // passive:false so touch scrolling doesn't steal the gesture on mobile
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchend', stopDrag);
      document.addEventListener('touchcancel', cancelDrag);
    },
    [maxSliderX, snapBack],
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

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex justify-center items-center w-full">
        <span className="text-title-s text-on-surface">请完成安全验证</span>
      </div>
      <div ref={containerRef} className="relative w-full max-w-[310px]">
        {loading && !bgImage && (
          /* A `Skeleton` in the puzzle's own box, not a `Spinner` inside it. The
             box is already reserved at the exact aspect ratio, so there is a
             destination shape to load into — which is the whole test for which
             of the two to use. A spinner here said "something is happening"
             inside a frame that was already telling you where. */
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
                className="absolute drop-shadow-[0_0_5px_color-mix(in_oklab,var(--md-sys-color-scrim)_50%,transparent)] pointer-events-none"
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
                <Spinner size="lg" white />
              </div>
            )}
            {errorMsg && !verifying && (
              <div className="bg-error-container text-on-error-container animate-fade-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 px-3">
                <svg
                  viewBox="0 0 24 24"
                  className="w-12 h-12 text-error shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {/* Backend error string — same as production captcha (n.error). */}
                <span className="text-body-s text-error text-center break-words max-w-full">
                  {errorMsg}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {bgImage && (
        <div
          ref={trackRefElement}
          className="relative w-full max-w-[310px] h-10 bg-surface-container-high rounded-full border border-outline-variant mt-2"
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
            /* `duration-120` + `standard`, i.e. the motion table's press row.
               Grabbing the handle is a press, and the 200ms this carried — with
               no curve at all, so it fell through to the default — left the
               fill and the scale still catching up after the handle had already
               moved under the finger. */
            className={`bg-surface-raised text-title-m absolute -top-px z-10 flex h-10 items-center justify-center rounded-full border border-outline shadow-e2 transition-[color,background-color,border-color,scale,box-shadow] duration-120 ease-[var(--ease-standard)] select-none ${
              isDragging
                ? 'cursor-grabbing bg-success-fill text-on-fill border-success-fill scale-110 shadow-e3'
                : 'cursor-grab text-on-surface-variant'
            } ${verifying ? 'pointer-events-none disabled-content' : ''}`}
            style={{
              left: `${(sliderX / maxSliderX) * layout.barMaxX}px`,
              width: `${layout.barButtonWidth}px`,
              touchAction: 'none',
            }}
            onMouseDown={onMouseDown}
          >
            &rarr;
          </div>
        </div>
      )}
    </div>
  );
}
