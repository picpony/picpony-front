"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { encodeTrack } from "@/lib/utils";
import { gsap, prefersReducedMotion } from "@/lib/motion";
import Spinner from "./Spinner";

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
 *   move:   x = clamp(clientX - startX, 0, 260)   // kept as float on sliderX
 *           relY = clientY - startY
 *           track.push([round(x), round(relY), elapsed])  // max 150 pts
 *   submit: { x: sliderX, track: xor90_btoa(JSON(track)) }
 *
 * Desktop-only mouse path already worked; mobile failed with the same API,
 * so the difference has to be in how touch samples the track — keep the
 * event model identical to production (document-level mouse/touch listeners,
 * not PointerEvent).
 */
export default function SliderCaptcha({ onVerify }: SliderCaptchaProps) {
  const [bgImage, setBgImage] = useState("");
  const [pieceImage, setPieceImage] = useState("");
  const [pieceY, setPieceY] = useState(0);
  const [sliderX, setSliderX] = useState(0);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const sliderXRef = useRef(0);
  const sliderBtnRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const snapTweenRef = useRef<gsap.core.Tween | null>(null);
  const fetchedRef = useRef(false);
  const trackRef = useRef<[number, number, number][]>([]);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const loadingRef = useRef(true);
  const verifyingRef = useRef(false);
  const draggingRef = useRef(false);
  // Latest callbacks for document-level listeners (avoid stale closures /
  // re-binding mid-gesture when handleStart identity changes).
  const onVerifyRef = useRef(onVerify);
  const fetchCaptchaRef = useRef<() => Promise<void>>(async () => {});

  const maxSliderX = 260;
  const btnWidth = 50;

  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);

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
      onUpdate: () => setSliderX(proxy.x),
    });
  }, []);

  useEffect(() => () => { snapTweenRef.current?.kill(); }, []);

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
    return () => { tween.kill(); };
  }, [errorMsg]);

  const getClientX = (e: MouseEvent | TouchEvent): number => {
    if ("touches" in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return t ? t.clientX : 0;
    }
    return e.clientX;
  };

  const getClientY = (e: MouseEvent | TouchEvent): number => {
    if ("touches" in e) {
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
    setErrorMsg("");
    trackRef.current = [];
    draggingRef.current = false;
    try {
      const data = await api.captchaGet();
      if (data.success) {
        setBgImage(data.bg);
        setPieceImage(data.piece);
        setPieceY(data.y);
      } else {
        setErrorMsg("获取验证码失败");
      }
    } catch {
      setErrorMsg("网络错误，请重试");
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

  const startDrag = useCallback((e: MouseEvent | TouchEvent) => {
    // Mirror production gates, but do NOT lock on errorMsg — a failed attempt
    // must remain re-draggable once the soft error is showing.
    if (loadingRef.current || verifyingRef.current || draggingRef.current) return;
    if ("cancelable" in e && e.cancelable) e.preventDefault();

    draggingRef.current = true;
    setIsDragging(true);
    setErrorMsg("");
    snapTweenRef.current?.kill();

    const clientX = getClientX(e);
    const clientY = getClientY(e);
    startXRef.current = clientX;
    startYRef.current = clientY;
    startTimeRef.current = Date.now();
    sliderXRef.current = 0;
    setSliderX(0);
    // Production always seeds with [0, 0, 0] (relative coordinates).
    trackRef.current = [[0, 0, 0]];

    const onDrag = (moveEvent: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      if ("cancelable" in moveEvent && moveEvent.cancelable) moveEvent.preventDefault();

      const xRaw = getClientX(moveEvent) - startXRef.current;
      let x = xRaw;
      if (x < 0) x = 0;
      if (x > maxSliderX) x = maxSliderX;

      // Production keeps sliderX as a float; only the track samples are rounded.
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

    const stopDrag = async () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);

      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("touchmove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
      document.removeEventListener("touchend", stopDrag);
      document.removeEventListener("touchcancel", stopDrag);

      // Production submits sliderX as-is (float) with no extra end sample.
      const finalX = sliderXRef.current;
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
          setErrorMsg(fail.error || fail.message || "验证失败，请重试");
          setTimeout(() => {
            void fetchCaptchaRef.current();
          }, 500);
        }
      } catch {
        snapBack();
        trackRef.current = [];
        setErrorMsg("网络错误，请重试");
        setTimeout(() => {
          void fetchCaptchaRef.current();
        }, 500);
      }
      setVerifying(false);
      verifyingRef.current = false;
    };

    document.addEventListener("mousemove", onDrag);
    // passive:false so touch scrolling doesn't steal the gesture on mobile
    document.addEventListener("touchmove", onDrag, { passive: false });
    document.addEventListener("mouseup", stopDrag);
    document.addEventListener("touchend", stopDrag);
    document.addEventListener("touchcancel", stopDrag);
  }, [maxSliderX, snapBack]);

  // Native non-passive touchstart, re-bound when the knob mounts (after bgImage).
  useEffect(() => {
    if (!bgImage) return;
    const btn = sliderBtnRef.current;
    if (!btn) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      startDrag(e);
    };
    btn.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => btn.removeEventListener("touchstart", onTouchStart);
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
        <span className="font-semibold text-slate-800 dark:text-slate-100">请完成安全验证</span>
      </div>
      <div ref={containerRef} className="relative w-[310px]">
        {loading && !bgImage && (
          <div className="w-[310px] h-[155px] flex items-center justify-center bg-white/80 dark:bg-slate-800/80 rounded-md">
            <Spinner size="lg" />
          </div>
        )}

        {bgImage && (
          <div className="relative w-[310px] h-[155px] bg-slate-200 dark:bg-slate-600 rounded-md overflow-hidden animate-fade-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={bgImage}
              alt="验证码背景"
              className="w-full h-full block"
              draggable={false}
            />
            {pieceImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pieceImage}
                alt="滑动拼图"
                className="absolute w-[50px] h-[50px] drop-shadow-[0_0_5px_rgba(0,0,0,0.5)] pointer-events-none"
                style={{ top: `${pieceY}px`, left: `${sliderX}px` }}
                draggable={false}
              />
            )}
            {verifying && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/50 z-20 animate-fade-in">
                <Spinner size="lg" />
              </div>
            )}
            {errorMsg && !verifying && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-500/15 dark:bg-red-900/40 z-20 animate-fade-in px-3">
                <svg viewBox="0 0 24 24" className="w-12 h-12 text-red-500 drop-shadow-md shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {/* Backend error string — same as production captcha (n.error). */}
                <span className="text-xs text-red-600 dark:text-red-300 text-center break-words max-w-full">
                  {errorMsg}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {bgImage && (
        <div
          className="relative w-[310px] h-10 bg-slate-100 dark:bg-slate-700 rounded-full border border-slate-200 dark:border-slate-600 mt-2"
          style={{ touchAction: "none" }}
        >
          <div
            className="h-full bg-emerald-500/20 rounded-full transition-none"
            style={{ width: `${sliderX + btnWidth}px` }}
          />

          <div
            ref={sliderBtnRef}
            className={`absolute top-[-1px] w-[50px] h-10 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 rounded-full flex items-center justify-center shadow-md select-none z-10 text-lg transition-[color,background-color,border-color,scale,box-shadow] duration-200 ${
              isDragging
                ? "cursor-grabbing bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-600 dark:border-emerald-600 scale-110 shadow-lg"
                : "cursor-grab text-slate-600 dark:text-slate-300"
            } ${verifying ? "pointer-events-none opacity-70" : ""}`}
            style={{ left: `${sliderX}px`, touchAction: "none" }}
            onMouseDown={onMouseDown}
          >
            &rarr;
          </div>
        </div>
      )}
    </div>
  );
}
