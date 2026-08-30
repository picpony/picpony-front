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
 * file is only the WebGL plumbing and the preference gates. It replaced a 764-line ASCII
 * character field, which is why the shape of the props is the same: an `absolute inset-0`
 * decorative layer that its parent centres content over.
 *
 * **Why WebGL and not a canvas 2D blit.** Two properties of the effect rule 2D out. The
 * reeds run at an angle, so the deflection is a function of both axes and there is no
 * per-column table to precompute; and the thing behind them is a per-pixel procedural
 * whose three domain warps cost about thirty transcendentals a sample, which is tens of
 * millions a second on a plate this size. On a GPU it is one triangle. There is no
 * three.js and no library — the shader strings are compiled against a raw context.
 *
 * **Two passes, not one**, which is the reference's own arrangement rather than a local
 * optimisation: its glass node declares `requiresRTT`, so the field is rendered once into a
 * texture and the glass reads that texture three times for its dispersion. Evaluating the
 * procedural three times per fragment instead is about ninety transcendentals a pixel with
 * two thirds of the result thrown away, and it is what kept this at 30fps.
 *
 * **Why this does not reintroduce the backdrop-filter cost.** It does not sample what is
 * behind it. Everything the plate refracts, it draws; the whole effect is one opaque
 * surface with no readback, no `getImageData`, and no compositor work beyond presenting a
 * single texture. The measured objection in globals.css is to ~150 regions each
 * re-sampling a moving backdrop, which is a different thing entirely.
 */

/**
 * Cap on the backing store's long edge, in device pixels.
 *
 * Without it a 4K monitor asks for a 5120-wide surface for a decorative band. The plate is
 * a soft, low-frequency image — its finest real feature is the prismatic seam, a few
 * pixels wide — so the resample from a capped buffer is not visible.
 *
 * It bounds the **width** only, so the cost is a function of the band's height at every
 * device ratio: the 320 → 384px change carried straight through as a uniform +20% (a
 * 1440 band at dpr 2 goes 1.28 → 1.54 Mpx per pass, and there are two). That is the same
 * regime rather than a new one — still low-power, still IntersectionObserver-gated, still
 * off entirely below the standard motion tier — but if a device ever regresses, the lever
 * is turning this into a pixel budget (`dpr = min(2, dpr, sqrt(BUDGET / (cssW * cssH)))`),
 * which at 1.3 Mpx pulls that same band from 1.667 to 1.53.
 */
const MAX_DEVICE_WIDTH = 2400;

/** Seconds into the flow the still frame is taken at, for the two lower motion tiers. */
const STILL_TIME = 7;

/**
 * Frame budget in milliseconds. 60fps.
 *
 * It was 33, on the argument that the flow's fastest term turns over in seconds. That is
 * true of the flow and false of the cursor: direct-manipulation feedback at 30fps reads as
 * lag however correct the maths underneath it is, and the trail's position only advanced on
 * those gated frames. The two-pass split is what pays for this.
 */
const FRAME_MS = 16;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    /* Dev only, and worth the branch: a shader that fails to compile takes the whole plate
       with it and leaves a plain coloured band, which looks like a design choice rather
       than a bug. The one that shipped this way was two variables sharing a name. */
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
 * Assigning to `fillStyle` and reading it back is what normalises any colour syntax the
 * browser understands into `#rrggbb`, which is more robust than parsing the token text:
 * `getPropertyValue` on a custom property returns the token *stream*, so a value that is
 * ever written as `color-mix()` would come back unevaluated. An invalid assignment is
 * silently ignored rather than throwing, hence the sentinel.
 *
 * The sRGB decode is the important half. Every uniform the shader reads is linear, because
 * the whole graph is — see the note at the top of `lib/flutedGlass.ts` for what doing it in
 * gamma space costs.
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
  /* Bumped by `webglcontextrestored`, so a real loss comes back instead of leaving the
     band a flat colour for the rest of the session. */
  const [generation, setGeneration] = useState(0);

  /* Reactive, not a one-shot read. The component this replaced shipped the other choice and
     recorded the bug: read once, the branch is decided at mount, so flipping the preference
     mid-session left the loop running until something else re-rendered the page. */
  const tier = useMotionTier();
  const scheme = useScheme();
  /* Not read directly — they are here so the drawing effect below re-runs when the palette
     moves. The plate samples `--md-sys-color-primary` through `getComputedStyle`, which no
     dependency array can see, so before this the /about glass kept the hue of whatever theme
     was in force when it mounted. The custom palette made that visible; it was wrong for the
     ten as well. `useCustomSeed` is the second half: the custom palette's id never changes,
     so only its seed reports that its colour did. */
  const palette = usePalette();
  const customSeed = useCustomSeed();
  const speed = useMotionSpeed();

  /* The live speed, in a ref, so changing it does not re-arm the loop and reset the phase.
     Written from an effect rather than during render: a render-phase ref write is the
     pattern the compiler's own bailout rules call out, and this one has no reason to be
     synchronous — a speed change that lands one frame late is not observable. */
  const scaleRef = useRef(1);
  useEffect(() => {
    scaleRef.current = MOTION_SPEED_SCALE[speed] ?? 1;
  }, [speed]);

  /* Measure. The DPR watcher has to re-arm: a window dragged between a Retina and a 1x
     display changes the backing-store requirement without changing the box, so the
     ResizeObserver never fires — and the query is pinned to the ratio it was built at, so
     after one transition it is false and a second change fires nothing. */
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
     * The context is created once per canvas and cached, and that is not an optimisation —
     * it is the whole of a bug worth stating, because the symptom pointed nowhere near it.
     *
     * `getContext` returns the *same* context object for a given canvas and type, and this
     * canvas never remounts: the effect re-runs on a scheme change, a resize and a drawer
     * toggle, but React keeps the element. So a teardown that called
     * `WEBGL_lose_context.loseContext()` was killing the context the *next* run would be
     * handed back. Every call on it then fails, and the failures are mute — a lost context
     * returns null from `getShaderParameter` and null from `getShaderInfoLog`, so the
     * console read `FlutedGlass shader: null` with no compiler message, which reads like a
     * GLSL error and is not one. Measured: `isContextLost()` false after load, true after
     * one resize, and the plate dead from then until a full navigation.
     *
     * So the per-run teardown deletes objects only, and the context is released on unmount
     * by the effect below this one.
     */
    const gl =
      glRef.current ??
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        /* The plate is drawn every frame it is visible and never read back, so there is
           nothing to preserve and preserving it costs a copy. */
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
    /* No WebGL is not a failure state worth branching the UI on: the band already carries
       the page's own glass-body tone, so what is left is a plain coloured block. */
    if (!gl) return;
    glRef.current = gl;
    /* A genuine loss — a GPU reset, a driver update — cannot be recovered on this canvas
       without a restore event, and `generation` is what re-runs this when one arrives.
       Bailing silently is the same fallback as no WebGL at all. */
    if (gl.isContextLost()) return;

    const vs = compile(gl, gl.VERTEX_SHADER, FLUTED_GLASS_VERTEX_SHADER);
    const backdropFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_BACKDROP_SHADER);
    const glassFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_SHADER);
    if (!vs || !backdropFs || !glassFs) return;
    const backdropProgram = link(gl, vs, backdropFs);
    const glassProgram = backdropProgram ? link(gl, vs, glassFs) : null;
    if (!backdropProgram || !glassProgram) return;

    /* One triangle covering the clip cube, not two making a quad: it has no interior edge
       for the rasteriser to walk twice, and it needs no index buffer. Both programs bind
       the same buffer, and both declare `aPos` at whatever slot the linker gave them. */
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const bindGeometry = (program: WebGLProgram) => {
      const aPos = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    };

    /* Read the tokens off the host, so the plate follows the scheme the way everything
       else does. `scheme` is in this effect's deps, and it is a `useSyncExternalStore`
       subscription, so a theme change re-runs all of this with the new values. */
    const style = getComputedStyle(host);
    const probe = document.createElement('canvas').getContext('2d');
    const colour = (value: string): [number, number, number] =>
      probe ? parseColor(probe, value) : [0, 0, 0];
    const token = (name: string, fallback: string) =>
      colour(style.getPropertyValue(name) || fallback);

    /* The glass body is a token pair rather than a literal here, so the band's own
       background and the wordmark's keyline can be painted the same colour — before this
       they were `surface-container-highest` against a plate of pure white, which turned a
       halo meant to knock the mark out of the texture into a visible pink-grey outline. */
    const bodyA = token('--md-sys-color-glass-body', '#ffffff');
    const bodyB = token('--md-sys-color-glass-body-b', '#f0e8ea');
    const hue = token('--md-sys-color-primary', '#e06c9f');

    canvas.width = box.w;
    canvas.height = box.h;

    /* Pass 1's target. sRGB-encoded 8-bit — see the note in `lib/flutedGlass.ts`: linear in
       eight bits would put the dark scheme's whole plate inside six code values. LINEAR
       filtering because the glass samples it at three displaced points per fragment, and
       CLAMP_TO_EDGE because the mirror the reference specifies is done in the shader
       (WebGL 1 refuses MIRRORED_REPEAT on a non-power-of-two texture). */
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

    /* The cursor's ink, as a texture. Linear filtering, because the grid is 128 across a
       band that can be 2400 device pixels wide and nearest would show every cell. */
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
    /* Nothing here is in CSS pixels: the reeds are a fraction of the plate's height and the
       trail is in plate-relative coordinates, so the backing-store ratio only decides how
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
       whole picture, drawn once — this is the container's only texture and it is above
       the fold, so an empty box would be less content rather than less motion. */
    if (tier !== 'standard') {
      /* No warm-up: nothing but the pointer paints ink, and there is no pointer on this
         branch. The still frame is the swirl seen through the glass, which is a finished
         picture rather than an empty one — see the note in `lib/flutedGlass.ts`. */
      paint(STILL_TIME);
      return teardown;
    }

    let frame = 0;
    let elapsed = STILL_TIME;
    let last = 0;
    let visible = true;

    /* The pointer's position in client coordinates, converted once per frame rather than
       once per event: `getBoundingClientRect` forces layout, and a high-poll mouse fires
       well over a hundred times a second. */
    let pointerClientX = 0;
    let pointerClientY = 0;
    let pointerDirty = false;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last && now - last < FRAME_MS) return;
      /* A capped delta, or a backgrounded tab returns as one enormous jump through the
         flow. The scale divides rather than multiplies: `--motion-scale` is a factor on
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
      /* The sim advances on the same scaled clock, so the speed preference reaches the ink
         as well as the flow — which it did not while the sim clamped its own delta. */
      trail.step(scaled);
      paint(elapsed);
    };

    /* The plate is pointer-events-none, so the listener goes on the band — the element the
       pointer is actually over. */
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
   * Declared *after* the drawing effect so its cleanup runs last: on unmount React runs
   * cleanups in declaration order, and the object deletes have to happen while the context
   * is still alive.
   *
   * `preventDefault` on `webglcontextlost` is what makes the browser willing to restore at
   * all — without it the loss is final. The restore then needs the whole setup to re-run,
   * hence `generation`, since every program, texture and buffer belonged to the dead
   * context.
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
