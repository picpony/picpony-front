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
  type MotionTier,
} from '@/lib/appearance';
import { clamp, cn } from '@/lib/utils';

/**
 * The /about plate — a flowing field seen through fluted glass.
 *
 * All of the maths, and every number behind how it looks, is in `lib/flutedGlass.ts`; this
 * file is only the WebGL plumbing, the scheduling and the preference gates. It is an
 * full-bleed decorative layer that its parent centres content over.
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
 *
 * **Built once, adjusted after** (R7-032). The programs, buffers and textures belong to the
 * context and are made once per context; a size change resizes the canvas and the one
 * texture whose size it is, a theme change re-uploads five colours, a tier change starts or
 * stops the loop. Nothing recompiles short of a lost context.
 *
 * **It idles** (R7-033). The flow runs while something is happening — for a few seconds after
 * the plate comes into view or the page comes back, and while a pointer moves over the band —
 * then slows to rest and the loop stops on the last frame. The ink simulation stops as soon as
 * its last trail has faded, and so does its upload. A pointer wakes it from where it stopped.
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
 * The frame rate the plate is drawn at: 60fps. The flow's fastest term turns over in seconds,
 * but direct-manipulation feedback (the cursor trail) at 30fps reads as lag.
 *
 * Reached as **every Nth display frame** (R7-040), N from the display's own measured interval —
 * not a millisecond gate. A gate of 16ms dropped a frame at 60Hz whenever a timestamp came in
 * early, and on a 90 or 144Hz panel it painted on alternating long and short intervals.
 */
const TARGET_FRAME_MS = 1000 / 60;

/** How long the flow keeps running after the last thing that woke it. */
const IDLE_AFTER_MS = 8000;

/**
 * Time constants of the flow's rate, in seconds of the motion-speed-scaled clock: coming to
 * rest is a slow exhale, waking is quicker — the pointer is waiting for it.
 */
const REST_TAU_S = 0.45;
const WAKE_TAU_S = 0.25;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    /* Dev only, and worth the branch: a failed compile takes the whole plate and
       leaves a plain coloured band, which reads as a design choice rather than a bug. */
    if (process.env.NODE_ENV !== 'production' && !gl.isContextLost()) {
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
    if (process.env.NODE_ENV !== 'production' && !gl.isContextLost()) {
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

interface PlateColours {
  bodyA: [number, number, number];
  bodyB: [number, number, number];
  hue: [number, number, number];
  sheen: [number, number, number];
  scheme: 'light' | 'dark';
}

/** The tokens the plate paints with, read off the element it sits in — so it follows the theme. */
function readColours(host: HTMLElement, scheme: 'light' | 'dark'): PlateColours {
  const style = getComputedStyle(host);
  const probe = document.createElement('canvas').getContext('2d');
  const token = (name: string, fallback: string) =>
    probe ? parseColor(probe, style.getPropertyValue(name) || fallback) : ([0, 0, 0] as [number, number, number]);
  /* The glass body is a token pair rather than a literal, so the band's own background and
     the wordmark's keyline can be painted the same colour — a literal halo around the mark
     read as a visible outline instead. */
  return {
    bodyA: token('--md-sys-color-glass-body', '#ffffff'),
    bodyB: token('--md-sys-color-glass-body-b', '#f0e8ea'),
    hue: token('--md-sys-color-primary', '#fdcad3'),
    sheen: token('--md-sys-color-glass-sheen', '#ffffff'),
    scheme,
  };
}

/**
 * Everything the plate draws with, for one context: both programs, the triangle, the trail
 * texture and the field's target. Made once; `resize`, `setColours` and `paint` are all that
 * happen after.
 */
class GlassPlate {
  private readonly backdropProgram: WebGLProgram;
  private readonly glassProgram: WebGLProgram;
  private readonly shaders: WebGLShader[];
  private readonly buffer: WebGLBuffer | null;
  private readonly trailTexture: WebGLTexture | null;
  private readonly backdropTexture: WebGLTexture | null;
  private readonly framebuffer: WebGLFramebuffer | null;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private width = 0;
  private height = 0;
  /** Whether the field's target is complete at the current size; nothing is drawn otherwise. */
  private complete = false;

  static create(gl: WebGLRenderingContext, neutral: Uint8Array): GlassPlate | null {
    const vs = compile(gl, gl.VERTEX_SHADER, FLUTED_GLASS_VERTEX_SHADER);
    const backdropFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_BACKDROP_SHADER);
    const glassFs = compile(gl, gl.FRAGMENT_SHADER, FLUTED_GLASS_SHADER);
    const shaders = [vs, backdropFs, glassFs].filter((shader): shader is WebGLShader => shader !== null);
    const backdropProgram = vs && backdropFs ? link(gl, vs, backdropFs) : null;
    const glassProgram = vs && glassFs && backdropProgram ? link(gl, vs, glassFs) : null;
    if (!backdropProgram || !glassProgram) {
      if (backdropProgram) gl.deleteProgram(backdropProgram);
      for (const shader of shaders) gl.deleteShader(shader);
      return null;
    }
    return new GlassPlate(gl, backdropProgram, glassProgram, shaders, neutral);
  }

  private constructor(
    private readonly gl: WebGLRenderingContext,
    backdropProgram: WebGLProgram,
    glassProgram: WebGLProgram,
    shaders: WebGLShader[],
    neutral: Uint8Array,
  ) {
    this.backdropProgram = backdropProgram;
    this.glassProgram = glassProgram;
    this.shaders = shaders;

    /* One triangle covering the clip cube, not two making a quad: no interior edge for the
       rasteriser to walk twice, no index buffer. Both programs bind the same buffer and
       declare `aPos` at whatever slot the linker gave them. */
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    /* The cursor's ink, as a texture. Linear filtering: the grid is 128 across a band that can
       be 2400 device pixels wide, and nearest would show every cell. Seeded with the neutral
       field, so pass 1 reads something defined before the first ink arrives. */
    this.trailTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TRAIL_SIZE, TRAIL_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, neutral);

    /* Pass 1's target. sRGB-encoded 8-bit — see `lib/flutedGlass.ts`: linear in eight bits
       would put the dark scheme's whole plate inside six code values. LINEAR filtering because
       the glass samples it at three displaced points per fragment; CLAMP_TO_EDGE because the
       reference's mirror is done in the shader (WebGL 1 refuses mirrored repeat on a
       non-power-of-two texture). Its storage is allocated by `resize`. */
    this.backdropTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.framebuffer = gl.createFramebuffer();

    const names = [
      'uResolution', 'uTrail', 'uColorA', 'uColorB', 'uInkBase', 'uInkLeft', 'uInkRight', 'uInkUp',
      'uInkDown', 'uDetail', 'uBlend', 'uRamp', 'uStretch', 'uSwirlTime',
    ];
    const glassNames = [
      'uResolution', 'uBackdrop', 'uHighlightColor', 'uFrequency', 'uCosA', 'uSinA', 'uExponent',
      'uRefraction', 'uAberration', 'uLightX', 'uLightZ', 'uSpecExponent', 'uHighlight', 'uFlank',
      'uGrain', 'uGrainBias', 'uFluteOffset', 'uGrainSeed',
    ];
    this.uniforms = {};
    for (const name of names) this.uniforms[`b.${name}`] = gl.getUniformLocation(backdropProgram, name);
    for (const name of glassNames) this.uniforms[`g.${name}`] = gl.getUniformLocation(glassProgram, name);
    const u = this.uniforms;

    /* --- Pass 1's constants ------------------------------------------------------------ */
    gl.useProgram(backdropProgram);
    gl.uniform1i(u['b.uTrail'], 0);
    gl.uniform1f(u['b.uDetail'], SWIRL_DEFAULTS.detail);
    gl.uniform1f(u['b.uBlend'], SWIRL_DEFAULTS.blend);
    gl.uniform1f(u['b.uRamp'], SWIRL_DEFAULTS.ramp);
    gl.uniform1f(u['b.uStretch'], SWIRL_DEFAULTS.stretch);

    /* --- Pass 2's constants ------------------------------------------------------------ */
    /* Nothing here is in CSS pixels: the reeds are a fraction of the plate's height and the
       trail is plate-relative, so the backing-store ratio only decides how many samples the
       same picture is drawn with. */
    const rad = (FLUTE_DEFAULTS.angle * Math.PI) / 180;
    /* /360, not /180 — see `FluteConfig.lightAngle`. It is the reference's own half-angle. */
    const theta = (FLUTE_DEFAULTS.lightAngle * Math.PI) / 360;
    gl.useProgram(glassProgram);
    gl.uniform1i(u['g.uBackdrop'], 1);
    gl.uniform1f(u['g.uFrequency'], FLUTE_DEFAULTS.frequency);
    gl.uniform1f(u['g.uCosA'], Math.cos(rad));
    gl.uniform1f(u['g.uSinA'], Math.sin(rad));
    gl.uniform1f(u['g.uExponent'], fluteExponent(FLUTE_DEFAULTS.softness));
    gl.uniform1f(u['g.uRefraction'], FLUTE_DEFAULTS.refraction);
    gl.uniform1f(u['g.uAberration'], FLUTE_DEFAULTS.aberration);
    gl.uniform1f(u['g.uLightX'], Math.sin(theta));
    gl.uniform1f(u['g.uLightZ'], Math.cos(theta));
    gl.uniform1f(u['g.uSpecExponent'], Math.pow(2, 8 - FLUTE_DEFAULTS.highlightSoftness * 7));
    gl.uniform1f(u['g.uHighlight'], FLUTE_DEFAULTS.highlight);
    gl.uniform1f(u['g.uFlank'], FLUTE_DEFAULTS.flank);
    gl.uniform1f(u['g.uGrain'], GRAIN_DEFAULTS.strength);
    gl.uniform1f(u['g.uGrainBias'], GRAIN_DEFAULTS.bias);
  }

  private bindGeometry(program: WebGLProgram) {
    const { gl } = this;
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * A new backing-store size: the canvas, the field's target and the two resolution uniforms.
   * Assigning the canvas size clears what it shows, so the caller paints in the same frame.
   */
  resize(canvas: HTMLCanvasElement, width: number, height: number): boolean {
    if (width === this.width && height === this.height) return false;
    const { gl, uniforms: u } = this;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.backdropTexture, 0);
    this.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.complete && process.env.NODE_ENV !== 'production' && !gl.isContextLost()) {
      console.error('FlutedGlass: incomplete framebuffer');
    }
    gl.useProgram(this.backdropProgram);
    gl.uniform2f(u['b.uResolution'], width, height);
    gl.useProgram(this.glassProgram);
    gl.uniform2f(u['g.uResolution'], width, height);
    gl.viewport(0, 0, width, height);
    return true;
  }

  /** The theme's five ink stops, the field's two ends and the sheen. */
  setColours({ bodyA, bodyB, hue, sheen, scheme }: PlateColours) {
    const { gl, uniforms: u } = this;
    gl.useProgram(this.backdropProgram);
    gl.uniform3fv(u['b.uColorA'], bodyA);
    gl.uniform3fv(u['b.uColorB'], bodyB);
    /* The five stops are prepared here rather than in the shader, so `INK_STOPS`' two
       restraints are applied once at upload instead of once per fragment. */
    const stops = inkStops(bodyA, hue, scheme);
    gl.uniform3fv(u['b.uInkBase'], stops.base);
    gl.uniform3fv(u['b.uInkLeft'], stops.left);
    gl.uniform3fv(u['b.uInkRight'], stops.right);
    gl.uniform3fv(u['b.uInkUp'], stops.up);
    gl.uniform3fv(u['b.uInkDown'], stops.down);
    gl.useProgram(this.glassProgram);
    gl.uniform3fv(u['g.uHighlightColor'], sheen);
  }

  /** Both passes at `seconds` into the flow. `trail` is uploaded first when it changed. */
  paint(seconds: number, trail: Uint8Array | null) {
    if (!this.complete) return;
    const { gl, uniforms: u } = this;
    /* Pass 1 — the field, into the target. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.useProgram(this.backdropProgram);
    this.bindGeometry(this.backdropProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTexture);
    if (trail) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TRAIL_SIZE, TRAIL_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, trail);
    }
    gl.uniform1f(u['b.uSwirlTime'], seconds * SWIRL_DEFAULTS.speed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* Pass 2 — the sheet, onto the screen. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.glassProgram);
    this.bindGeometry(this.glassProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTexture);
    gl.uniform1f(u['g.uFluteOffset'], seconds * FLUTE_DEFAULTS.speed);
    /* Static by default: a grain that changes every frame reads as noise rather than as a
       surface. See GRAIN_ANIMATED. */
    gl.uniform1f(u['g.uGrainSeed'], GRAIN_ANIMATED ? seconds * 10 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const { gl } = this;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.backdropTexture);
    gl.deleteTexture(this.trailTexture);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.backdropProgram);
    gl.deleteProgram(this.glassProgram);
    for (const shader of this.shaders) gl.deleteShader(shader);
  }
}

/** What the long-lived drawing effect exposes to the effects that follow the preferences. */
interface PlateHandle {
  setColours: (scheme: 'light' | 'dark') => void;
  setTier: (tier: MotionTier) => void;
}

/** `navigator.connection.saveData`: the visitor asked for less, and an ambient loop is optional. */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

export default function FlutedGlass({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const handleRef = useRef<PlateHandle | null>(null);
  /* Bumped by `webglcontextrestored`, so a real loss comes back instead of leaving the band
     a flat colour for the session. The only thing that rebuilds the plate. */
  const [generation, setGeneration] = useState(0);

  /* Reactive, not a one-shot read: read once, the branch is decided at mount, and flipping
     the preference mid-session left the loop running. */
  const tier = useMotionTier();
  const scheme = useScheme();
  /* Not read directly — they are here so the colours are read again when the palette moves:
     the plate samples the primary token through `getComputedStyle`, which no dependency
     array can see. `useCustomSeed` is the second half — the custom palette's id never
     changes, so only its seed reports that its colour did. */
  const palette = usePalette();
  const customSeed = useCustomSeed();
  const speed = useMotionSpeed();

  /* The live preferences, in refs, for a loop that outlives renders: changing the speed must
     not re-arm it and reset the phase, and a rebuilt plate starts from the current tier and
     scheme. Written from effects rather than render (a render-phase ref write is the
     compiler's bailout pattern); a one-frame-late change is unobservable. */
  const scaleRef = useRef(1);
  const tierRef = useRef(tier);
  const schemeRef = useRef(scheme);
  useEffect(() => {
    scaleRef.current = MOTION_SPEED_SCALE[speed] ?? 1;
  }, [speed]);

  /* The plate's whole life on one context: built once, then sized, coloured and scheduled. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    /**
     * The context is created once per canvas and cached — not an optimisation but a bug fix:
     * `getContext` returns the *same* context object for a canvas, and this canvas never
     * remounts. A teardown that called `loseContext()` was killing the context the next run
     * would be handed back — and the failures are mute (`getShaderParameter` and
     * `getShaderInfoLog` both return null on a lost context).
     *
     * So this teardown deletes objects only; the context is released on unmount by the
     * effect below this one.
     */
    const gl =
      glRef.current ??
      canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        /* Never read back, so there is nothing to preserve and preserving it costs a copy. */
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
    /* No WebGL is not a failure state worth branching the UI on: the band already carries
       the page's own tone, so what is left is a plain coloured block. */
    if (!gl) return;
    glRef.current = gl;
    /* A genuine loss (GPU reset, driver update) cannot be recovered on this canvas without a
       restore event; `generation` is what re-runs this when one arrives. */
    if (gl.isContextLost()) return;

    const trail = new FlutedGlassTrail();
    const plate = GlassPlate.create(gl, trail.pixels);
    if (!plate) return;

    /* --- Scheduling ------------------------------------------------------------------- */
    let disposed = false;
    let lost = false;
    let still = true;
    let visible = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let frame = 0;
    let running = false;
    let lastFrameAt = 0;
    let lastPaintAt = 0;
    /* The display's frame interval, learnt from the loop's own timestamps. */
    let interval = TARGET_FRAME_MS;
    let sinceDraw = 0;
    let elapsed = STILL_TIME;
    /* The flow's rate, 0 (at rest) to 1, eased so it neither starts nor stops in a frame. */
    let rate = 0;
    let wakeUntil = 0;

    /* The pointer's position in client coordinates, converted once per frame rather than once
       per event: `getBoundingClientRect` forces layout, and a high-poll mouse fires well over a
       hundred times a second. */
    let pointerClientX = 0;
    let pointerClientY = 0;
    let pointerDirty = false;

    const paintNow = () => {
      if (disposed || lost || gl.isContextLost()) return;
      plate.paint(still ? STILL_TIME : elapsed, null);
    };

    const stop = () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const tick = (now: number) => {
      frame = 0;
      if (!running || disposed) return;
      if (lost || gl.isContextLost()) {
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
      if (lastFrameAt) {
        const gap = now - lastFrameAt;
        if (gap > 0 && gap < 100) interval += (gap - interval) * 0.1;
      }
      lastFrameAt = now;
      /* Every Nth display frame: 1 at 60Hz, 2 at 120 and 144Hz, never a frame dropped for a
         timestamp that came in a little early. */
      const stride = Math.max(1, Math.floor(TARGET_FRAME_MS / interval + 0.25));
      sinceDraw += 1;
      if (lastPaintAt && sinceDraw < stride) return;
      sinceDraw = 0;
      /* A capped delta, or a backgrounded tab returns as one enormous jump through the flow.
         The scale divides rather than multiplies: the speed factor is on durations, so a
         longer duration is a slower advance. */
      const delta = lastPaintAt ? Math.min(now - lastPaintAt, 200) : 0;
      lastPaintAt = now;
      const seconds = delta / 1000 / Math.max(scaleRef.current, 0.01);
      const awake = performance.now() < wakeUntil;
      const target = awake ? 1 : 0;
      rate += (target - rate) * (1 - Math.exp(-seconds / (target > rate ? WAKE_TAU_S : REST_TAU_S)));
      if (!awake && rate < 0.002) rate = 0;
      elapsed += seconds * rate;
      if (pointerDirty) {
        const rect = canvas.getBoundingClientRect();
        trail.move(
          (pointerClientX - rect.left) / Math.max(rect.width, 1),
          (pointerClientY - rect.top) / Math.max(rect.height, 1),
        );
        pointerDirty = false;
      }
      /* The sim advances on the same scaled clock, so the speed preference reaches the ink as
         well as the flow; at rest it does no work and nothing is uploaded. */
      const inked = trail.step(seconds);
      if (seconds > 0 || inked) plate.paint(elapsed, inked ? trail.pixels : null);
      /* At rest, with no ink left: the last frame stays on the canvas and the loop ends. */
      if (!awake && rate === 0 && trail.resting) stop();
    };

    const start = () => {
      if (running || disposed || lost || still || !visible || !pageVisible) return;
      running = true;
      lastFrameAt = 0;
      lastPaintAt = 0;
      sinceDraw = 0;
      frame = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (still || lost) return;
      wakeUntil = performance.now() + IDLE_AFTER_MS;
      start();
    };

    /* --- Size ------------------------------------------------------------------------- */
    /* Measured at once on build, then once per frame at most while the box or the device
       ratio changes — a window being dragged, or the drawer's own transition. */
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const raw = clamp(window.devicePixelRatio || 1, 1, 2);
      const dpr = Math.min(raw, MAX_DEVICE_WIDTH / Math.max(rect.width, 1));
      return { w: Math.max(1, Math.round(rect.width * dpr)), h: Math.max(1, Math.round(rect.height * dpr)) };
    };
    const applySize = () => {
      const { w, h } = measure();
      if (!plate.resize(canvas, w, h)) return;
      trail.setAspect(w / h);
      /* The resize cleared the canvas. Paint now even if this display frame's regular draw
         already ran, or the next frame could present a cleared backing store. */
      paintNow();
    };
    let sizeFrame = 0;
    const scheduleSize = () => {
      if (sizeFrame) return;
      sizeFrame = requestAnimationFrame(() => {
        sizeFrame = 0;
        if (!disposed && !lost) applySize();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleSize);
    resizeObserver.observe(host);
    /* The DPR watcher has to re-arm: a window dragged between a Retina and a 1x display
       changes the backing-store requirement without changing the box (so the ResizeObserver
       never fires), and a query pinned at build time goes false after one transition. */
    let ratio: MediaQueryList | null = null;
    const onRatio = () => {
      scheduleSize();
      if (!disposed) watchRatio();
    };
    const watchRatio = () => {
      ratio?.removeEventListener('change', onRatio);
      ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratio.addEventListener('change', onRatio, { once: true });
    };
    watchRatio();

    /* --- Input and visibility ---------------------------------------------------------- */
    /* The plate ignores pointer hit testing, so the listeners go on the band — the element the
       pointer is actually over. A press counts as well as a move: a finger's first contact
       is where a touch screen says it is there. */
    const surface = host.parentElement ?? host;
    const onMove = (event: PointerEvent) => {
      pointerClientX = event.clientX;
      pointerClientY = event.clientY;
      pointerDirty = true;
      wake();
    };
    const onLeave = () => {
      pointerDirty = false;
      trail.leave();
    };
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerdown', onMove);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('pointercancel', onLeave);

    const intersection = new IntersectionObserver(
      ([entry]) => {
        const next = entry?.isIntersecting ?? true;
        if (next === visible) return;
        visible = next;
        if (visible) wake();
        else stop();
      },
      { rootMargin: '96px' },
    );
    intersection.observe(host);

    const onPageVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden';
      if (pageVisible) wake();
      else stop();
    };
    document.addEventListener('visibilitychange', onPageVisibility);

    /* A lost context stops the loop at once; drawing into it is wasted work until the
       restore rebuilds the plate (the listener below this effect keeps the restore possible). */
    const onLost = () => {
      lost = true;
      stop();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    /* --- The preferences ------------------------------------------------------------- */
    const handle: PlateHandle = {
      setColours: (next) => {
        if (disposed || lost) return;
        plate.setColours(readColours(host, next));
        if (!running) paintNow();
      },
      setTier: (next) => {
        if (disposed || lost) return;
        /* A decorative ambient loop is standard-tier only, and stands down for data saver.
           Both lower tiers still get the whole picture, drawn once — an empty box would be
           less content, not less motion. No ink: nothing but the pointer paints it, and there
           is no pointer on this branch. */
        const nextStill = next !== 'standard' || savesData();
        if (nextStill === still) return;
        still = nextStill;
        if (still) {
          stop();
          rate = 0;
          elapsed = STILL_TIME;
          trail.clear();
          plate.paint(STILL_TIME, trail.pixels);
        } else {
          wake();
        }
      },
    };
    handleRef.current = handle;

    applySize();
    handle.setColours(schemeRef.current);
    handle.setTier(tierRef.current);
    if (still) paintNow();

    return () => {
      disposed = true;
      stop();
      if (sizeFrame) cancelAnimationFrame(sizeFrame);
      resizeObserver.disconnect();
      ratio?.removeEventListener('change', onRatio);
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onPageVisibility);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerdown', onMove);
      surface.removeEventListener('pointerleave', onLeave);
      surface.removeEventListener('pointercancel', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (handleRef.current === handle) handleRef.current = null;
      /* Objects of a context that was lost belong to nothing any more; only a live one's are deleted. */
      if (!lost && !gl.isContextLost()) plate.dispose();
    };
  }, [generation]);

  /* A theme or palette change re-reads five colours; nothing is rebuilt. */
  useEffect(() => {
    schemeRef.current = scheme;
    handleRef.current?.setColours(scheme);
  }, [scheme, palette, customSeed]);

  /* A tier change starts the loop, or stops it on the still frame. */
  useEffect(() => {
    tierRef.current = tier;
    handleRef.current?.setTier(tier);
  }, [tier]);

  /* So does data saver, which is a preference too and can change while the page is open — it was
     sampled only when the tier moved (G4-026). The connection reports any change of its own, and
     `setTier` reads `saveData` afresh each time and does nothing when the answer is the same. */
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (!connection || typeof connection.addEventListener !== 'function') return;
    const onChange = () => handleRef.current?.setTier(tierRef.current);
    connection.addEventListener('change', onChange);
    return () => connection.removeEventListener('change', onChange);
  }, []);

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
   *
   * **The release waits a task, and stands down if the canvas mounted again meanwhile.** A
   * development double mount runs this cleanup on the very element that is about to be used
   * again, and a context lost through the extension stays lost: the plate came back as a flat
   * band. A real unmount has nothing mounting after it, so the context goes a task later.
   */
  const mountsRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    mountsRef.current += 1;
    const mount = mountsRef.current;
    const onLost = (event: Event) => {
      event.preventDefault();
    };
    const onRestored = () => setGeneration((n) => n + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      const gl = glRef.current;
      setTimeout(() => {
        if (mountsRef.current !== mount) return;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        if (glRef.current === gl) glRef.current = null;
      }, 0);
    };
  }, []);

  return (
    <div ref={hostRef} aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
