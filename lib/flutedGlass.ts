/**
 * The /about plate: a flowing field seen through a sheet of fluted glass — a port of the
 * shader graph behind the SenseNova U1 Pro card on sensenova.cn, where it runs as a
 * non-interactive Three.js iframe. Each field below quotes its reference value; the few
 * deliberate deviations are argued where they live.
 *
 * The one idea the whole thing rests on: **the glass does not make an image, it slices
 * one.** Displacing a sample across a uniform field or a gentle gradient returns what was
 * already there, so the glass can only show *boundaries* — the field's plateaus are what
 * make its boundaries legible, and every bit of light-and-shade on the plate comes from the
 * field, never from the glass. Which is why the field's colours are the
 * `--md-sys-color-glass-body-*` tokens (see the note beside them in globals.css) and the ink
 * is one hue with a per-direction shade ladder, not a palette of hues.
 *
 * Span and chroma are a floor and a ceiling, not a target: they say the material is not
 * shouting (too much reads as corduroy, edges smoothed away read as brushed metal) and
 * cannot say it is there — the renders say that. This plate targets span 28 / chroma 4.3,
 * above the reference on span (it is half the height on a white page) and level on chroma.
 *
 * **Everything here runs in linear light.** The grain and the specular are additive, and
 * addition is exactly where gamma-space arithmetic diverges; colour uniforms arrive decoded,
 * every term is linear, and the encode happens once per pass. The reference carries P3
 * coordinates with mismatched encoding; this deliberately stays in sRGB.
 *
 * `scripts/probeFlutedGlass.mjs` re-renders the same formulas on the CPU to a PNG — a design
 * instrument, not a shader test: it never compiles the GLSL, so a shader change can only be
 * verified in a browser.
 */

/* --- Swirl: the field behind the glass ---------------------------------------------- */

export interface SwirlConfig {
  /** Intricacy of the domain warp. Reference: 1.7. */
  detail: number;
  /** Flow speed. Reference: 1 (the node default). */
  speed: number;
  /** Skews the ramp toward the first colour (low) or the second (high). Reference: 50. */
  blend: number;
  /**
   * Half-width of the ramp's smoothstep window, around the field's midpoint. Reference: 0.2
   * (a 0.3..0.7 window). Widening it — 0.45 shipped for one release — spreads every boundary
   * in the field into a slope, so the glass bends light with nothing to reveal and the plate
   * reads as brushed metal: the plateaus are not dead area, they are what makes the
   * boundaries between them legible, and boundaries are what the glass slices. Measured,
   * 0.2 vs 0.45 moves span 27.2 → 28.1 and chroma 4.1 → 4.3 — the same light and shade,
   * given a shape. Ramp width and field span must be judged in the same sweep, never one
   * after the other.
   */
  ramp: number;
  /**
   * How far the pattern is stretched along the plate's long axis; not a reference parameter.
   *
   * The reference composes on a ~2:1 card; this plate is a full-bleed band past 4:1, which
   * alone packs five cells across it. The x span is `(width / height) * stretch`, so this
   * number is coupled to the band's height — 384px reads as one broad sweep, calmer than the
   * reference's own composition. For more structure use `detail` (the isotropic lever; the
   * y span is fixed, so `stretch` cannot reach it), not this: raising `stretch` alone buys
   * vertical striping rather than flow.
   */
  stretch: number;
}

export const SWIRL_DEFAULTS: SwirlConfig = {
  detail: 1.7,
  speed: 1,
  blend: 50,
  ramp: 0.2,
  stretch: 0.45,
};

/* --- Fluted glass ------------------------------------------------------------------- */

export interface FluteConfig {
  /**
   * Flutes across one unit of *height* — 5, not the reference's 8. The parameter ports
   * faithfully; the plate's width does not (the reference spends 8 on a card a third of this
   * width, where it reads as corduroy), and this is the axis that pays for it. Two things
   * move the right way with 5: the refraction reach (`refraction × halfFlute`) scales
   * inversely with the pitch, and the wider reed puts room between the three channels'
   * sample points so the prismatic seam is visible instead of sub-pixel.
   */
  frequency: number;
  /** Which way the reeds run, in degrees. Reference: 31. */
  angle: number;
  /** 0 = a flat facet with a hard seam, 1 = a full cylinder. Reference: 1 (exponent 3). */
  softness: number;
  /** Peak deflection, in half-flutes. Reference: 4, the top of its range. */
  refraction: number;
  /** Splits the sample into R/G/B along the deflection. Reference: .61. */
  aberration: number;
  /**
   * Where the light comes from, in degrees. Reference: -90.
   *
   * Reaches the shader as sin/cos of `lightAngle · π / 360` — a **half** angle, so -90
   * resolves to -45°. That divisor is the reference's own, not a slip; its UI bounds the
   * value to ±90 for a usable arc of ±45. Do not "correct" it to /180.
   */
  lightAngle: number;
  /**
   * The specular's peak addition, in linear light.
   *
   * The reference's .12 was a scale on a lobe *times* a Fresnel term that is a constant
   * 0.04 in disguise (see the note above `GrainConfig`), so the value here is their peak
   * product: at the lobe's centre Schlick gives `0.04 + 0.96 · (1 − 1/√2)^5 = 0.042069`,
   * and `0.12 × 0.042069 = 0.005`. Writing `.12` with the Fresnel factor restored is the
   * same number to five decimals over the whole visible lobe and would buy one `pow` per
   * fragment for nothing — but that equivalence holds only because the lobe is *narrow*;
   * widen `highlightSoftness` and Fresnel varies across it, so the two must move together.
   * Only the dark scheme sees it: an addition has no headroom at linear 1.0 (white stays
   * white at any value), while on the dark plate at linear 0.025 it is a 20% lift.
   */
  highlight: number;
  /**
   * Peak transmission loss toward the seam, 0..1. Not a reference parameter — the reed the
   * light scheme can show, since no additive `highlight` can move white at linear 1.0.
   * A linear addition is worth ~7.9x more code values on the dark plate, a linear ratio
   * ~4.6x more on the light one, so each scheme's reed is carried by the term that suits it
   * (see `INK_SIGN`). Keep this a light touch: it is a function of the flute geometry alone,
   * painting the same shading on every reed — run it high and the reeds out-shout the flow
   * (corduroy); the balance to hold is field-dominant.
   */
  flank: number;
  /**
   * 0 = a pin-tight glint (exponent 256), 1 = a broad sheen. Reference: 0, and this is 0.
   *
   * 0 buys the razor-thin bright hairline riding each reed that the reference is
   * recognisable for; a broad lobe measures the same energy and reads as haze. The lobe's
   * device-pixel width is proportional to the pitch (`uResolution.y / frequency`), so any
   * number derived here — 0.35 once was, for scintillation at a 48px pitch — dies with the
   * pitch that produced it. A derived value needs its parent named where the value lives.
   */
  highlightSoftness: number;
  /**
   * Flutes per second the pattern creeps, **down and to the right**. Reference: .15.
   *
   * A positive value means "along the reeds' normal": the normal is `(cos, sin)` of `angle`
   * in a top-left-origin frame, so *adding* the offset sends features up-and-left and
   * *subtracting* is what sends them along the normal. If the motion ever looks inverted,
   * check this sign before touching `angle` — the angle is separately load-bearing (see the
   * uv-frame note in the backdrop shader).
   */
  speed: number;
}

export const FLUTE_DEFAULTS: FluteConfig = {
  frequency: 5,
  angle: 31,
  softness: 1,
  refraction: 4,
  aberration: 0.61,
  lightAngle: -90,
  highlight: 0.005,
  flank: 0.05,
  highlightSoftness: 0,
  speed: 0.15,
};

/** The `rounded` profile's exponent ladder. `bars` runs 16 to 4 and is not used here. */
export function fluteExponent(softness: number): number {
  return 8 + (3 - 8) * clamp01(softness);
}

/** The signed departure from flat at position `r` across a flute, `r` in -1..1. */
export function fluteSlope(r: number, exponent: number): number {
  const d = Math.max(Math.abs(r), 1e-4);
  return Math.sign(r) * Math.pow(d, exponent);
}

/**
 * The reed has two terms, split by parity rather than by taste: `facing` is even in `slope`
 * and `slope` is odd, so the flank is the reed's *shape* and the specular is which *side*
 * the light is on. Together they read as a cylinder; either alone reads as a stripe.
 *
 * **The Fresnel factor came out** because the reference's `facing` is the cosine to the
 * *view*, where Schlick wants the light angle (`incidence`) — with the right angle,
 * `(1 - incidence)^5` is at most 6.9e-10 across the visible lobe, so the term is the
 * constant **0.04** to nine decimal places: a factor of 24 sitting between `uHighlight` and
 * the thing it appears to control. `uHighlight` is the peak itself, in linear light.
 *
 * **`flank`'s mask is `1 - facing`, not Schlick.** Schlick's fifth power is back at its F0
 * floor within 2.4px of the seam at this pitch — one aliased pixel under a JND on the sample
 * grid — while `1 - facing` gives a ~5px soft flank, identical at every device ratio, and is
 * exactly 0 at the crown: the crown is the plate's own colour byte for byte, which the
 * wordmark's halo (drawn in `--md-sys-color-glass-body` over this surface) depends on.
 *
 * **The order is load-bearing.** Multiply the transmitted colour first, add the reflection
 * second — a reflection is the light that did not enter the sheet, so scaling it by the
 * transmission as well counts the same loss twice. This is deliberately *not* an
 * energy-conserving model: `uHighlight` and `uFlank` are two independent artistic scales;
 * only their order is physical. (`highlightSoftness` is 0, as in the reference — see its
 * field note for the scintillation argument that once moved it and the pitch that retired
 * it.)
 */

/* --- Film grain --------------------------------------------------------------------- */

export interface GrainConfig {
  /** Reference: .05. The node's own default is .5, ten times too much here. */
  strength: number;
  /** Concentrates grain in the shadows. Reference: 2 (the node default). */
  bias: number;
}

export const GRAIN_DEFAULTS: GrainConfig = { strength: 0.05, bias: 2 };

/**
 * The grain does not animate — the reference leaves that flag off. Reseeding per frame over
 * a still surface reads as noise rather than grain: the eye integrates a moving field into
 * a haze while a fixed one sits down into the surface and stops being seen.
 */
export const GRAIN_ANIMATED = false;

/* --- The cursor layer ----------------------------------------------------------------
 *
 * The reference's `ChromaFlow`: a velocity field and a density field the pointer stirs,
 * advected and decayed every frame, coloured by the *direction* of the local flow and
 * composited over the swirl in proportion to density — transparent everywhere the cursor
 * has not recently been. Two deposit details carry most of the feel, both the reference's:
 * the blob's radius scales with the *square* of cursor speed while its amplitude scales
 * with speed (a flick lays a wide strong trail, a slow drag a thin faint one), and density
 * is advected along the velocity field, which is what makes a trail curl rather than fade.
 *
 * **Nothing paints but the pointer.** Ambient sources were tried once and produced a mark
 * nobody made, read as a defect; the resting plate — the swirl seen through the glass,
 * a ~4% ripple — is a finished picture, which is precisely what the reference ships.
 */

/** Resolution of the velocity and density fields. The reference's own. */
export const TRAIL_SIZE = 128;

export interface TrailConfig {
  /** Cursor reach, as a fraction of the field. Reference: radius 3.5, scaled by .05. */
  radius: number;
  /** How far density is carried along the velocity each second. Reference: momentum 13. */
  momentum: number;
  /** Deposit strength. Reference: intensity 1. */
  intensity: number;
  /**
   * Density time constant, seconds. Reference: 1 — not 0.4: the reference's node wraps its
   * 0.4 in a `max` against the larger 1, so the 0.4 never applies. Porting 0.4 makes the
   * trail fade too fast to ever curl into anything.
   */
  densityDecay: number;
  /** Velocity time constant, seconds. Reference: 1. */
  velocityDecay: number;
}

export const TRAIL_DEFAULTS: TrailConfig = {
  radius: 3.5,
  momentum: 13,
  intensity: 1,
  densityDecay: 1,
  velocityDecay: 1,
};

/**
 * The low-pass on cursor velocity, as a frame-rate-independent time constant. The reference
 * smooths with a flat 0.85/0.15 weight per frame, so its real time constant is whatever the
 * frame rate happens to be; 0.0984s is the τ for which `1 - exp(-dt / τ)` equals 0.15 at a
 * 16ms step — the reference's own weight at its own rate, now independent of the clock.
 */
export const TRAIL_VELOCITY_TAU = 0.0984;

/**
 * The ink, as five stops on one hue: a base and the four directions of flow.
 *
 * The base is the plate itself and is not in this table. `offset` is how far the stop sits
 * from the plate **in sRGB code values** — not a luminance ratio, which is not comparable
 * between the two schemes (sRGB is steep near black, so one ratio is 68 code values down
 * from white and only 18 up from a near-black plate). Expressed as code values the two
 * schemes take the same numbers and differ only in sign: light subtracts (ink is a shadow),
 * dark adds (ink is light, and the only scheme where the specular has anywhere to be) —
 * `INK_SIGN` is that, and the entire difference between the schemes.
 *
 * `chroma` is a ceiling on (max − min) over the stop's own luminance, rising as the stop
 * moves from the plate at half the reference's own slope — a fold is a fold by being mostly
 * light and shade; full chroma is what a multi-hue palette reads as.
 *
 * The hue is `--md-sys-color-primary`, read off the host, so every palette (including the
 * user's) follows without a `var()` reaching a uniform. Only its *direction* survives
 * `inkColor` — level and chroma come from this table.
 */
export interface InkStop {
  /** Distance from the plate in sRGB code values, before `INK_SIGN`. */
  offset: number;
  /** Ceiling on relative chroma. */
  chroma: number;
}

export const INK_STOPS = {
  left: { offset: 6, chroma: 0.023 },
  down: { offset: 31, chroma: 0.128 },
  right: { offset: 43, chroma: 0.181 },
  up: { offset: 68, chroma: 0.3 },
} as const satisfies Record<string, InkStop>;

export type InkStopName = keyof typeof INK_STOPS | 'base';

export const INK_SIGN = { light: -1, dark: 1 } as const;

/** sRGB transfer curve, both directions. The only two places a value here is not linear. */
export function srgbDecode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function srgbEncode(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : Math.pow(Math.max(v, 0), 1 / 2.4) * 1.055 - 0.055;
}

/** Rec. 709 luminance of a linear-light triple. */
export function linearLuminance(c: readonly number[]): number {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

/**
 * One ink stop, prepared for upload: the hue's direction, at the stop's level and chroma.
 * Shared so the shader and the probe cannot disagree about the one colour decision made on
 * the CPU. `chroma` is a ceiling, not a target — a flatter hue keeps its own rather than
 * being saturated into colour the palette does not have.
 */
export function inkColor(
  plate: readonly number[],
  hue: readonly number[],
  offsetCodes: number,
  chroma: number,
): [number, number, number] {
  const target = srgbDecode(clamp01(srgbEncode(linearLuminance(plate)) + offsetCodes / 255));
  const hueLevel = linearLuminance(hue);
  if (hueLevel <= 1e-6) return [target, target, target];

  /* The hue at unit luminance, so nothing but its direction survives the next step. */
  const unit = hue.map((v) => v / hueLevel);
  const spread = Math.max(...unit) - Math.min(...unit);
  /* Mixing toward the neutral (1, 1, 1) leaves luminance at 1 exactly (luminance is
     linear in the components and both endpoints have it), so chroma and level are set
     independently rather than fighting each other. */
  const k = spread > 1e-6 ? Math.min(1, chroma / spread) : 0;
  return [
    (1 + (unit[0] - 1) * k) * target,
    (1 + (unit[1] - 1) * k) * target,
    (1 + (unit[2] - 1) * k) * target,
  ];
}

/**
 * All five stops, so the shader and the probe read one function. The base **is the plate**,
 * verbatim, rather than an offset of zero through `inkColor` (a neutral at the plate's
 * luminance): the mismatch would put a visible grey edge around the one region that is
 * supposed to be invisible. The reference makes the same identity — its `baseColor` equals
 * its swirl's `colorA`.
 */
export function inkStops(
  plate: readonly number[],
  hue: readonly number[],
  scheme: 'light' | 'dark',
): Record<InkStopName, [number, number, number]> {
  const sign = INK_SIGN[scheme] ?? INK_SIGN.light;
  const out = {
    base: [plate[0], plate[1], plate[2]] as [number, number, number],
  } as Record<InkStopName, [number, number, number]>;
  (Object.keys(INK_STOPS) as (keyof typeof INK_STOPS)[]).forEach((key) => {
    out[key] = inkColor(plate, hue, INK_STOPS[key].offset * sign, INK_STOPS[key].chroma);
  });
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* --- The shaders ---------------------------------------------------------------------
 *
 * Two passes, the reference's own structure (`requiresRTT`): the field behind the glass is
 * rendered once to a texture and the glass samples it three times. Evaluating the
 * procedural field per fragment instead costs ~90 transcendentals a pixel and throws two
 * thirds away. The intermediate is an ordinary 8-bit target holding **sRGB-encoded**
 * values, decoded on the way back in — linear in 8 bits would put the dark scheme's whole
 * plate inside six code values.
 */

export const FLUTED_GLASS_VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Shared by both passes. Linear in, encoded out, exactly once per pass. */
const TRANSFER = `
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(pow(c, vec3(0.4166667)) * 1.055 - 0.055, c * 12.92,
             vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 srgbToLinear(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92,
             vec3(lessThanEqual(c, vec3(0.04045))));
}
`;

/** Pass 1 — the field behind the glass: the swirl, with the cursor's ink over it. */
export const FLUTED_GLASS_BACKDROP_SHADER = `
precision highp float;
${TRANSFER}

uniform vec2  uResolution;
uniform float uSwirlTime;

uniform sampler2D uTrail;   // rg = flow velocity, 0.5-centred; b = density

uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uInkBase;
uniform vec3  uInkLeft;
uniform vec3  uInkRight;
uniform vec3  uInkUp;
uniform vec3  uInkDown;

uniform float uDetail;
uniform float uBlend;
uniform float uRamp;
uniform float uStretch;

/* Swirl, from the reference node's fragment graph: three domain warps at roughly 1x, 2.1x
   and 3.7x the detail frequency, summed 0.45 / 0.35 / 0.20. */
float swirlField(vec2 uv, float t) {
  float s = uDetail;

  vec2 a = vec2(
    uv.x + sin(uv.y * s * 1.7 + t * 0.8) * 0.12 + cos(uv.x * s * 0.9 - t * 0.5) * 0.05,
    uv.y + cos(uv.x * s * 1.3 - t * 0.6) * 0.12 + sin(uv.y * s * 1.1 + t * 0.7) * 0.05
  );
  float o = sin(a.x * s * 2.1 + a.y * s * 1.8 + t * 0.4);

  float u2 = s * 2.1;
  vec2 d = vec2(
    a.x + cos(a.y * u2 * 2.7 - t * 0.45) * 0.07 + sin(a.x * u2 * 1.9 + t * 0.6) * 0.04,
    a.y + sin(a.x * u2 * 2.3 + t * 0.65) * 0.07 + cos(a.y * u2 * 1.6 - t * 0.4) * 0.04
  );
  float h = cos(d.x * u2 * 1.4 - d.y * u2 * 1.9 + t * 0.35);

  float f = s * 3.7;
  vec2 m = vec2(
    d.x + sin(d.y * f * 1.8 + t * 0.85) * 0.04 + cos(d.x * f * 1.3 - t * 0.55) * 0.025
        + sin((d.x + d.y) * f * 0.7 + t * 0.9) * 0.02,
    d.y + cos(d.x * f * 1.6 - t * 0.75) * 0.04 + sin(d.y * f * 1.1 + t * 0.5) * 0.025
        + cos((d.x + d.y) * f * 0.8 - t * 0.95) * 0.02
  );
  float g = sin(m.x * f * 1.1 + m.y * f * 1.5 - t * 0.55);

  return o * 0.45 + h * 0.35 + g * 0.2;
}

/* The trail, blurred the way the reference blurs its own fields before reading them: a
   uniform five-tap cross, enough to take the grid's own steps off the edges. */
vec3 trailAt(vec2 uv) {
  float o = 1.0 / ${TRAIL_SIZE}.0;
  vec3 c = texture2D(uTrail, uv).rgb;
  c += texture2D(uTrail, uv + vec2(o, 0.0)).rgb;
  c += texture2D(uTrail, uv - vec2(o, 0.0)).rgb;
  c += texture2D(uTrail, uv + vec2(0.0, o)).rgb;
  c += texture2D(uTrail, uv - vec2(0.0, o)).rgb;
  return c * 0.2;
}

/* Normalised against the short axis, matching the reference's uv, then stretched because
   this plate is far wider than the canvas that scene was composed on. */
vec2 plateUv(vec2 p) {
  return vec2((p.x / uResolution.y) * uStretch, p.y / uResolution.y);
}

void main() {
  /* Top-left origin, which is the reference's frame rather than WebGL's.

     gl_FragCoord counts up from the bottom; the reference's uv counts down from the top,
     and every angle in its scene is expressed in that frame. Sampling it bottom-up mirrors
     the whole composition, so an angle of 31 came out leaning the wrong way — twice,
     because the first attempt at this fixed the number instead of the frame and then had to
     be undone. Flip once, here, and every parameter ports unchanged. */
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  vec2 uv = plateUv(p);
  float field = swirlField(uv, uSwirlTime);
  float bias = (uBlend - 50.0) * 0.006;
  float y = smoothstep(0.5 - uRamp, 0.5 + uRamp, field * 0.5 + 0.5 + bias);
  vec3 swirl = mix(uColorA, uColorB, y) * (sin(uSwirlTime * 2.5 + field * 8.0) * 0.015 + 1.0);

  /* The ink. Four directional stops blended by how far the local flow points each way, over
     a base that *is* the plate — so where the flow has no direction there is nothing to see,
     which is the state this whole design rests on. This is the reference's own blend; the
     draft that took atan2 into a six-hue ring is what produced the rainbow, and it had a
     150-degree gap in it that made a diagonal drag jump colour. */
  vec3 t = trailAt(clamp(p / uResolution, 0.0, 1.0));
  float cover = smoothstep(0.0, 0.1, t.b);
  vec2 vel = t.rg * 2.0 - 1.0;
  float mag = length(vel);
  vec2 dir = vel / (mag + 0.001);
  float wR = smoothstep(0.0, 0.7, dir.x);
  float wL = smoothstep(0.0, 0.7, -dir.x);
  float wD = smoothstep(0.0, 0.7, dir.y);
  float wU = smoothstep(0.0, 0.7, -dir.y);
  float hw = wL + wR;
  float vw = wU + wD;
  float sw = hw + vw + 0.001;
  vec3 ink = mix(
    uInkBase,
    (uInkLeft * wL + uInkRight * wR) * (hw / sw) + (uInkUp * wU + uInkDown * wD) * (vw / sw),
    smoothstep(0.01, 0.1, mag)
  );

  gl_FragColor = vec4(linearToSrgb(mix(swirl, ink, cover)), 1.0);
}
`;

/** Pass 2 — the sheet itself: refraction, dispersion, the specular, the grain. */
export const FLUTED_GLASS_SHADER = `
precision highp float;
${TRANSFER}

uniform vec2  uResolution;
uniform float uFluteOffset;
uniform float uGrainSeed;

uniform sampler2D uBackdrop;
uniform vec3  uHighlightColor;

uniform float uFrequency;
uniform float uCosA;
uniform float uSinA;
uniform float uExponent;
uniform float uRefraction;
uniform float uAberration;
uniform float uLightX;
uniform float uLightZ;
uniform float uSpecExponent;
uniform float uHighlight;
uniform float uFlank;

uniform float uGrain;
uniform float uGrainBias;

/* The reference's \`edges: mirror\`, done in the shader because WebGL 1 refuses
   MIRRORED_REPEAT on a non-power-of-two texture and this plate is never one. */
vec2 mirrorUv(vec2 uv) {
  return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
}

/* \`p\` is in pixels with a top-left origin; the target was drawn bottom-up, so flip back. */
vec3 backdropAt(vec2 p) {
  vec2 uv = vec2(p.x, uResolution.y - p.y) / uResolution;
  return srgbToLinear(texture2D(uBackdrop, mirrorUv(uv)).rgb);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  /* Distance along the reeds' normal, in units of the plate's height — the reference's own
     coordinate, so its frequency ports unchanged. */
  float across = (p.x * uCosA + p.y * uSinA) / uResolution.y;
  float r = (fract(across * uFrequency - uFluteOffset) - 0.5) * 2.0;
  float slope = sign(r) * pow(max(abs(r), 1e-4), uExponent);

  /* Half a flute in pixels is the deflection's unit. At the reference's refraction of 4 the
     peak reach is twice the pitch, which is what makes the bands read as liquid. */
  float halfFlute = (0.5 / uFrequency) * uResolution.y;
  float shift = -slope * uRefraction * halfFlute;
  float split = shift * uAberration * 0.5;
  vec2 axis = vec2(uCosA, uSinA);

  vec3 col = vec3(
    backdropAt(p + axis * (shift + split)).r,
    backdropAt(p + axis * shift).g,
    backdropAt(p + axis * (shift - split)).b
  );

  /* The facet's normal is the unit vector (slope, facing): straight on at the crown of a
     reed, edge-on at the seam. \`facing\` is even in slope and \`slope\` is odd, and the two
     terms below split along exactly that line — the flank is the reed's shape, the specular
     is which side the light is on. Together they read as a cylinder. */
  float facing = sqrt(max(0.0, 1.0 - min(slope * slope, 1.0)));

  /* Transmission loss toward the flanks, and on a light plate it is the only reed the eye
     can be shown at all. Multiplied *before* the specular is added, because a reflection is
     the light that did not enter the sheet — scaling it by the transmission as well would
     count the same loss twice. */
  col *= 1.0 - uFlank * (1.0 - facing);

  /* The specular. \`uHighlight\` is the peak addition itself, in linear light — see the
     note above \`GrainConfig\` for the factor of 24 that used to sit between them. */
  float incidence = max(slope * uLightX + facing * uLightZ, 0.0);
  col += uHighlightColor * (pow(incidence, uSpecExponent) * uHighlight);

  /* Film grain, weighted into the shadows and sampled on the device pixel. */
  float noise = fract(sin(dot(p, vec2(12.9898, 78.233)) + uGrainSeed) * 43758.5453) * 2.0 - 1.0;
  float lum = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  col += noise * pow(1.0 - lum + 1e-6, uGrainBias) * uGrain * 0.1;

  gl_FragColor = vec4(linearToSrgb(col), 1.0);
}
`;
