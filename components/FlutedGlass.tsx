'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FLUTED_GLASS_BACKDROP_SHADER,
  FLUTED_GLASS_SHADER,
  FLUTED_GLASS_VERTEX_SHADER,
  FLUTE_DEFAULTS,
  GRAIN_ANIMATED,
  GRAIN_DEFAULTS,
  SWIRL_DEFAULTS,
  inkStops,
  TRAIL_SIZE,
  fluteExponent,
} from '@/lib/flutedGlass';
import { FlutedGlassTrail } from '@/lib/flutedGlassTrail';
import {
  MOTION_SPEED_SCALE,
  useCustomSeed,
  useMotionSpeed,
  useMotionTier,
  usePalette,
  useScheme,
} from '@/lib/appearance';
import { cn } from '@/lib/utils';

/**
 * The /about plate — a flowing field seen through fluted glass.
 *
 * All of the maths, and every number behind how it looks, is in `lib/flutedGlass.ts`; this
 * file is only the WebGL plumbing and the preference gates. It is an `absolute inset-0`
 * decorative layer that its parent centres content over.
 *
 * **Why WebGL and not a canvas 2D blit.** The reeds run at an angle, so the deflection is a
 * function of both axes with no per-column table to precompute; and the procedural behind
 * them costs about thirty transcendentals a sample — tens of millions a second on a plate
 * this size, one triangle on a GPU. No library; the shader strings compile against a raw
 * context.
 *
 * **Two passes, not one** — the reference's own arrangement (`requiresRTT`): the field is
 * rendered once into a texture and the glass reads it three times for dispersion.
 * Evaluating the procedural three times per fragment is ~90 transcendentals a pixel with
 * two thirds wasted, and it is what kept this at 30fps.
 *
 * **Why this does not reintroduce the backdrop-filter cost.** It does not sample what is
 * behind it — everything the plate refracts it draws; one opaque surface, no readback, no
 * compositor work beyond presenting a single texture.
 */

/**
 * Cap on the backing store's long edge, in device pixels — otherwise a 4K monitor asks
 * for a 5120-wide surface for a decorative band. The plate is soft and low-frequency, so
 * the resample is not visible.
 *
 * It bounds the **width** only, so the cost scales with the band's height at every device
 * ratio. If a device ever regresses, the lever is turning this into a pixel budget
 * (`dpr = min(2, dpr, sqrt(BUDGET / (cssW * cssH)))`).
 */
const MAX_DEVICE_WIDTH = 2400;

/** Seconds into the flow the still frame is taken at, for the two lower motion tiers. */
const STILL_TIME = 7;

/**
 * Frame budget in milliseconds. 60fps, not 30: the flow's fastest term turns over in
 * seconds, but direct-manipulation feedback (the cursor trail) at 30fps reads as lag,
 * and the trail only advanced on gated frames. The two-pass split pays for this.
 */
const FRAME_MS = 16;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    /* Dev only, and worth the branch: a failed compile takes the whole plate and
       leaves a plain coloured band, which reads as a design choice rather than a bug. */
    if (process.env.NODE_ENV !== 'production') {
      console.error('FlutedGlass shader:', gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('FlutedGlass link:', gl.getProgramInfoLog(program));
    }
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * A CSS colour to **linear-light** 0..1 RGB, via the canvas parser.
 *
 * Assigning to `fillStyle` and reading back normalises any colour syntax into
 * `#rrggbb` — more robust than parsing the token text (`getPropertyValue` on a custom
 * property returns the token *stream*, so a `color-mix()` value would come back
 * unevaluated). An invalid assignment is silently ignored, hence the sentinel.
 *
 * The sRGB decode is the important half: every uniform the shader reads is linear —
 * see the note at the top of `lib/flutedGlass.ts`.
 */
function parseColor(probe: CanvasRenderingContext2D, value: string): [number, number, number] {
  probe.fillStyle = '#000000';
  probe.fillStyle = value.trim();
  const hex = probe.fillStyle as string;
  if (typeof hex !== 'string' || hex[0] !== '#') return [0, 0, 0];
  const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return [
    decode(parseInt(hex.slice(1, 3), 16) / 255),
    decode(parseInt(hex.slice(3, 5), 16) / 255),
    decode(parseInt(hex.slice(5, 7), 16) / 255),
  ];
}

export default function FlutedGlass({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  /* Bumped by `webglcontextrestored`, so a real loss comes back instead of leaving
     the band a flat colour for the session. */
  const [generation, setGeneration] = useState(0);

  /* Reactive, not a one-shot read: read once, the branch is decided at mount, and
     flipping the preference mid-session left the loop running. */
  const tier = useMotionTier();
  const scheme = useScheme();
  /* Not read directly — they are here so the drawing effect re-runs when the palette
     moves: the plate samples the primary token through `getComputedStyle`, which no
     dependency array can see. `useCustomSeed` is the second half — the custom
     palette's id never changes, so only its seed reports that its colour did. */
  const palette = usePalette();
  const customSeed = useCustomSeed();
  const speed = useMotionSpeed();

  /* The live speed, in a ref, so changing it does not re-arm the loop and reset the
     phase. Written from an effect rather than render (a render-phase ref write is
     the compiler's bailout pattern); a one-frame-late speed change is unobservable. */
  const scaleRef = useRef(1);
  useEffect(() => {
    scaleRef.current = MOTION_SPEED_SCALE[speed] ?? 1;
  }, [speed]);

  /* Measure. The DPR watcher has to re-arm: a window dragged between a Retina and a 1x
     display changes the backing-store requirement without changing the box (so the
     ResizeObserver never fires), and a query pinned at build time goes false after one
     transition and fires nothing more. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const raw = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const dpr = Math.min(raw, MAX_DEVICE_WIDTH / Math.max(rect.width, 1));
      setBox((prev) => {
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        return prev.w === w && prev.h === h ? prev : { w, h };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    let live = true;
    let ratio: MediaQueryList | null = null;
    const onRatio = () => {
      measure();
      if (live) watchRatio();
    };
    const watchRatio = () => {
      ratio?.removeEventListener('change', onRatio);
      ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratio.addEventListener('change', onRatio, { once: true });
    };
    watchRatio();
    return () => {
      live = false;
      observer.disconnect();
      ratio?.removeEventListener('change', onRatio);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host || box.w === 0 || box.h === 0) return;

    /**
     * The context is created once per canvas and cached — not an optimisation but a bug
     * fix: `getContext` returns the *same* context object for a canvas, and this canvas
     * never remounts (the effect re-runs on scheme change/resize/drawer toggle, React
     * keeps the element). A teardown that called `loseContext()` was killing the context
     * the next run would be handed back — and the failures are mute (`getShaderParameter`
     * and `getShaderInfoLog` both return null on a lost context, so the console read
     * `FlutedGlass shader: null`, which looks like a GLSL error and is not one).
     *
     * So the per-run teardown deletes objects only; the context is released on unmount
     * by the effect below this one.
     */
    const gl =
      glRef.current ??
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        /* Drawn every frame while visible and never read back, so there is nothing
           to preserve and preserving it costs a copy. */
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
    /* No WebGL is not a failure state worth branching the UI on: the band already
       carries the page's own tone, so what is left is a plain coloured block. */
    if (!gl) return;
    glRef.current = gl;
    /* A genuine loss (GPU reset, driver update) cannot be recovered on this canvas
       without a restore event; `generation` is what re-runs this when one arrives. */
    if (gl.isContextLost()) return;

    const vs = compile(gl, gl.VERTEX_SHADER, FLUTED_GLASS_VERTEX_SHADER);
    const backdropFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_BACKDROP_SHADER);
    const glassFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_SHADER);
    if (!vs || !backdropFs || !glassFs) return;
    const backdropProgram = link(gl, vs, backdropFs);
    const glassProgram = backdropProgram ? link(gl, vs, glassFs) : null;
    if (!backdropProgram || !glassProgram) return;

    /* One triangle covering the clip cube, not two making a quad: no interior edge
       for the rasteriser to walk twice, no index buffer. Both programs bind the same
       buffer and declare `aPos` at whatever slot the linker gave them. */
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const bindGeometry = (program: WebGLProgram) => {
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    };

    /* Read the tokens off the host, so the plate follows the scheme like everything
       else; `scheme` in this effect's deps re-runs it all on a theme change. */
    const style = getComputedStyle(host);
    const probe = document.createElement('canvas').getContext('2d');
    const colour = (value: string): [number, number, number] =>
      probe ? parseColor(probe, value) : [0, 0, 0];
    const token = (name: string, fallback: string) =>
      colour(style.getPropertyValue(name) || fallback);

    /* The glass body is a token pair rather than a literal, so the band's own
       background and the wordmark's keyline can be painted the same colour —
       a literal halo around the mark read as a visible outline instead. */
    const bodyA = token('--md-sys-color-glass-body', '#ffffff');
    const bodyB = token('--md-sys-color-glass-body-b', '#f0e8ea');
    const hue = token('--md-sys-color-primary', '#e06c9f');

    canvas.width = box.w;
    canvas.height = box.h;

    /* Pass 1's target. sRGB-encoded 8-bit — see `lib/flutedGlass.ts`: linear in eight
       bits would put the dark scheme's whole plate inside six code values. LINEAR
       filtering because the glass samples it at three displaced points per fragment;
       CLAMP_TO_EDGE because the reference's mirror is done in the shader (WebGL 1
       refuses mirrored repeat on a non-power-of-two texture). */
    const backdropTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdropTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, box.w, box.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backdropTexture, 0,
    );
    const framebufferOk =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!framebufferOk) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('FlutedGlass: incomplete framebuffer');
      }
      return;
    }

    /* The cursor's ink, as a texture. Linear filtering: the grid is 128 across a band
       that can be 2400 device pixels wide, and nearest would show every cell. */
    const trail = new FlutedGlassTrail();
    trail.setAspect(box.w / box.h);
    const trailTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* --- Pass 1's constants ------------------------------------------------------- */
    gl.useProgram(backdropProgram);
    bindGeometry(backdropProgram);
    const bu = (name: string) => gl.getUniformLocation(backdropProgram, name);
    gl.uniform2f(bu('uResolution'), box.w, box.h);
    gl.uniform1i(bu('uTrail'), 0);
    gl.uniform3fv(bu('uColorA'), bodyA);
    gl.uniform3fv(bu('uColorB'), bodyB);

    /* The five stops are prepared here rather than in the shader, so `INK_STOPS`' two
       restraints are applied once at upload instead of once per fragment. */
    const stops = inkStops(bodyA, hue, scheme);
    gl.uniform3fv(bu('uInkBase'), stops.base);
    gl.uniform3fv(bu('uInkLeft'), stops.left);
    gl.uniform3fv(bu('uInkRight'), stops.right);
    gl.uniform3fv(bu('uInkUp'), stops.up);
    gl.uniform3fv(bu('uInkDown'), stops.down);

    gl.uniform1f(bu('uDetail'), SWIRL_DEFAULTS.detail);
    gl.uniform1f(bu('uBlend'), SWIRL_DEFAULTS.blend);
    gl.uniform1f(bu('uRamp'), SWIRL_DEFAULTS.ramp);
    gl.uniform1f(bu('uStretch'), SWIRL_DEFAULTS.stretch);
    const uSwirlTime = bu('uSwirlTime');

    /* --- Pass 2's constants ------------------------------------------------------- */
    /* Nothing here is in CSS pixels: the reeds are a fraction of the plate's height
       and the trail is plate-relative, so the backing-store ratio only decides how
       many samples the same picture is drawn with. */
    const rad = (FLUTE_DEFAULTS.angle * Math.PI) / 180;
    /* /360, not /180 — see `FluteConfig.lightAngle`. It is the reference's own half-angle. */
    const theta = (FLUTE_DEFAULTS.lightAngle * Math.PI) / 360;

    gl.useProgram(glassProgram);
    bindGeometry(glassProgram);
    const gu = (name: string) => gl.getUniformLocation(glassProgram, name);
    gl.uniform2f(gu('uResolution'), box.w, box.h);
    gl.uniform1i(gu('uBackdrop'), 1);
    gl.uniform3fv(gu('uHighlightColor'), token('--md-sys-color-glass-sheen', '#ffffff'));

    gl.uniform1f(gu('uFrequency'), FLUTE_DEFAULTS.frequency);
    gl.uniform1f(gu('uCosA'), Math.cos(rad));
    gl.uniform1f(gu('uSinA'), Math.sin(rad));
    gl.uniform1f(gu('uExponent'), fluteExponent(FLUTE_DEFAULTS.softness));
    gl.uniform1f(gu('uRefraction'), FLUTE_DEFAULTS.refraction);
    gl.uniform1f(gu('uAberration'), FLUTE_DEFAULTS.aberration);
    gl.uniform1f(gu('uLightX'), Math.sin(theta));
    gl.uniform1f(gu('uLightZ'), Math.cos(theta));
    gl.uniform1f(gu('uSpecExponent'), Math.pow(2, 8 - FLUTE_DEFAULTS.highlightSoftness * 7));
    gl.uniform1f(gu('uHighlight'), FLUTE_DEFAULTS.highlight);
    gl.uniform1f(gu('uFlank'), FLUTE_DEFAULTS.flank);
    gl.uniform1f(gu('uGrain'), GRAIN_DEFAULTS.strength);
    gl.uniform1f(gu('uGrainBias'), GRAIN_DEFAULTS.bias);
    const uFluteOffset = gu('uFluteOffset');
    const uGrainSeed = gu('uGrainSeed');

    gl.viewport(0, 0, box.w, box.h);

    const paint = (seconds: number) => {
      /* Pass 1 — the field, into the target. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.useProgram(backdropProgram);
      bindGeometry(backdropProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, TRAIL_SIZE, TRAIL_SIZE, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, trail.pixels,
      );
      gl.uniform1f(uSwirlTime, seconds * SWIRL_DEFAULTS.speed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* Pass 2 — the sheet, onto the screen. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(glassProgram);
      bindGeometry(glassProgram);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, backdropTexture);
      gl.uniform1f(uFluteOffset, seconds * FLUTE_DEFAULTS.speed);
      /* Static by default: a grain that changes every frame reads as noise rather than as
         a surface. See GRAIN_ANIMATED. */
      gl.uniform1f(uGrainSeed, GRAIN_ANIMATED ? seconds * 10 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const teardown = () => {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(backdropTexture);
      gl.deleteTexture(trailTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(backdropProgram);
      gl.deleteProgram(glassProgram);
      gl.deleteShader(vs);
      gl.deleteShader(backdropFs);
      gl.deleteShader(glassFs);
    };

    /* A decorative ambient loop is standard-tier only. Both lower tiers still get the
       whole picture, drawn once — an empty box would be less content, not less motion. */
    if (tier !== 'standard') {
      /* No warm-up: nothing but the pointer paints ink, and there is no pointer on
         this branch. The still frame is a finished picture, not an empty one — see
         the note in `lib/flutedGlass.ts`. */
      paint(STILL_TIME);
      return teardown;
    }

    let frame = 0;
    let elapsed = STILL_TIME;
    let last = 0;
    let visible = true;

    /* The pointer's position in client coordinates, converted once per frame rather
       than once per event: `getBoundingClientRect` forces layout, and a high-poll
       mouse fires well over a hundred times a second. */
    let pointerClientX = 0;
    let pointerClientY = 0;
    let pointerDirty = false;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last && now - last < FRAME_MS) return;
      /* A capped delta, or a backgrounded tab returns as one enormous jump through the
         flow. The scale divides rather than multiplies: the speed factor is on
         durations, so a longer duration is a slower advance. */
      const delta = last ? Math.min(now - last, 200) : 0;
      last = now;
      const scaled = delta / 1000 / Math.max(scaleRef.current, 0.01);
      elapsed += scaled;
      if (pointerDirty) {
        const rect = canvas.getBoundingClientRect();
        trail.move(
          (pointerClientX - rect.left) / Math.max(rect.width, 1),
          (pointerClientY - rect.top) / Math.max(rect.height, 1),
        );
        pointerDirty = false;
      }
      /* The sim advances on the same scaled clock, so the speed preference reaches
         the ink as well as the flow. */
      trail.step(scaled);
      paint(elapsed);
    };

    /* The plate is pointer-events-none, so the listener goes on the band — the
       element the pointer is actually over. */
    const surface = host.parentElement ?? host;
    const onMove = (event: PointerEvent) => {
      pointerClientX = event.clientX;
      pointerClientY = event.clientY;
      pointerDirty = true;
    };
    const onLeave = () => {
      pointerDirty = false;
      trail.leave();
    };
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('pointercancel', onLeave);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry?.isIntersecting ?? true;
        if (next === visible) return;
        visible = next;
        if (visible) {
          last = 0;
          frame = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      },
      { rootMargin: '96px' },
    );
    observer.observe(host);

    paint(elapsed);
    frame = requestAnimationFrame(tick);

    return () => {
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerleave', onLeave);
      surface.removeEventListener('pointercancel', onLeave);
      observer.disconnect();
      cancelAnimationFrame(frame);
      teardown();
    };
  }, [box.w, box.h, scheme, palette, customSeed, tier, generation]);

  /**
   * Context loss, and the release on unmount.
   *
   * Declared *after* the drawing effect so its cleanup runs last: the object deletes
   * have to happen while the context is still alive.
   *
   * `preventDefault` on `webglcontextlost` is what makes the browser willing to
   * restore at all — without it the loss is final. The restore needs the whole setup
   * to re-run (`generation`), since every program, texture and buffer belonged to the
   * dead context.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
    };
    const onRestored = () => setGeneration((n) => n + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      glRef.current?.getExtension('WEBGL_lose_context')?.loseContext();
      glRef.current = null;
    };
  }, []);

  return (
    <div ref={hostRef} aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
