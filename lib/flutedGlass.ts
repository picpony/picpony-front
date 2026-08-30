/**
 * The /about plate: a flowing field seen through a sheet of fluted glass.
 *
 * A port of the shader graph behind the SenseNova U1 Pro card on sensenova.cn. That effect
 * is not in the site's own bundle — it is a `pointer-events-none` iframe pointing at
 * `/html/u1-pro.html?backgroundOnly=1`, a single-file Vite app running Three.js r185's
 * WebGPU renderer over a node graph from shaders.com. The scene is four sibling nodes, and
 * every value marked "reference" below is the literal it passes:
 *
 *   Swirl        colorA #ffffff, colorB #f7f5ff, detail 1.7
 *   ChromaFlow   base #ffffff, up #bfb5e5, down #e0ddf7, left #faf8ff, right #d6d0f0,
 *                momentum 13, radius 3.5
 *   FlutedGlass  shape rounded, angle 31, frequency 8, softness 1, speed .15,
 *                refraction 4, aberration .61, lightAngle -90, highlight .12,
 *                highlightSoftness 0, edges mirror
 *   FilmGrain    strength .05
 *
 * All sixteen have been re-checked against the shipped bundle and are correct. Three do not
 * port: `highlight .12` was a scale on a Fresnel term this shader folds into the constant it
 * is, so the value here is their product, `.005`; the swirl's colour span is re-costed for a
 * plate that runs off the edge of the column rather than sitting in a card; and `frequency 8`
 * is the one literal changed purely for how it looks, because the reference's card is a third
 * of this plate's width. Each is argued where it lives. Everything else ports unchanged.
 *
 * **Three of those "everything else" were changed anyway, and have been changed back:**
 * `ramp` (0.2, not 0.45), `highlightSoftness` (0, not 0.35) and `highlight` (.005, not .02).
 * Each had a measurement behind it; each measurement had either been read backwards or been
 * taken against a geometry that later moved. Between them they removed the field's edges, the
 * glint's sharpness and the glint's brightness — which are three of the four things this
 * material is made of — and the plate shipped reading as a brushed metal panel. The reasoning
 * is beside each field. The pattern is in the paragraph below about span and chroma: all
 * three deviations kept the plate inside its measured envelope while taking the material out
 * of it.
 *
 * **The one idea the whole thing rests on: the glass does not make an image, it slices
 * one.** Displacing the sample coordinate on a uniform field returns the same value,
 * splitting three channels of a uniform field gives no fringe, and an additive specular
 * clips against white. So whatever the field behind the sheet is worth, the glass can only
 * spend; it has no contrast of its own to add.
 *
 * That is a statement about the *field*, and it used to be written here as a statement
 * about the *ink* — "every bit of contrast on the plate comes from the cursor's ink" —
 * which followed from the same arithmetic while the field was the reference's own eight
 * code values. It is the reason the plate shipped looking flat. The field is twenty-one code
 * values now (`--md-sys-color-glass-body-b`, both schemes, and the note beside it in
 * globals.css); against eight, that takes the refraction from ~1.5 code values of visible
 * modulation to ~5 and the red-to-blue fringe from ~2 to ~4.
 *
 * **But more contrast is not what makes it read as glass, and getting that backwards cost a
 * round.** The reference was sampled off its own canvas at 1440x760: its *entire* rendered
 * luminance span is **12.3 code values** (242.7..255) at a mean chroma of **3.8**. It is
 * white. What makes it read as flowing silk is not how much light and shade it has but that
 * what little it has is broad, soft, and shaped into reeds — and that it carries almost no
 * colour, so nothing competes with the shading. A draft here answered the flatness with a
 * pink field at thirty-one code values and a strong per-reed shade, and it read as coloured
 * corduroy: correctly contrasty, wrong material. The numbers that matter are therefore
 * *span* and *chroma together*, and `perf:glass` prints both beside the reference's figures
 * on every render. This plate measures span 28 / chroma 4.3 — deliberately above the
 * reference on span, because it is half the height and sits on a white page rather than
 * being a bounded card, and level with it on chroma.
 *
 * **The other end of that failure is a plate with the right numbers and no shape, and it is
 * the one that shipped.** Too much contrast reads as corduroy; light and shade that are
 * broad and soft but have had their *edges* smoothed away read as brushed metal, and both
 * measure whatever you like on span. A release went out at ramp 0.45 with a lobe five times
 * too wide, and the plate measured span 27 / chroma 4.1 — inside every figure this paragraph
 * asks for — while reading as an anodised aluminium panel. So span and chroma are a floor and
 * a ceiling, not a target: they say the material is not shouting, and they cannot say it is
 * there. The renders are what say that, which is what `perf:glass` is for.
 *
 * The ink is still the strongest thing that happens to the plate, and still the only thing
 * the pointer controls. It is no longer the only thing there is to see, which is what lets
 * the resting plate be a finished picture rather than an empty one.
 *
 * **And its four direction colours are a lighting model, not a palette.** That is the part
 * an earlier draft of this file read backwards, at a cost worth recording. Measured, the
 * reference's stops run 0.947 / 0.743 / 0.657 / 0.498 in luminance with relative chroma
 * 0.065 / 0.279 / 0.366 / 0.646 — one pale violet, where direction decides *brightness*
 * first and hue second, and where the further a stop sits from the plate the more colour it
 * carries (chroma tracks 1.2 × (1 − level) across all four). That is what makes it read as
 * folded silk. The draft instead pinned six brand hues to one luminance and one chroma and
 * varied only hue, around a ring with a 150° gap in it, which reads as a rainbow smear and
 * has no fold in it anywhere. `INK_STOPS` is the fix, and it is one hue.
 *
 * **Everything here runs in linear light.** The reference's runtime carries linear values
 * end to end and encodes once on the way to the screen. That is not a detail — this graph's
 * two most visible terms are *additive* (the grain and the specular), and addition is
 * exactly where gamma-space arithmetic diverges: measured against a correct linear add, a
 * peak grain sample on a 0.05 pixel lands 4.16x too small in gamma space and on a 0.80
 * pixel 1.7x too large, so the grain stops being shadow-weighted and flattens into a
 * uniform haze. So colour uniforms arrive already decoded to linear, every term is linear,
 * and the encode happens once per pass.
 *
 * The reference's working primaries are P3, which this deliberately does not follow: that
 * runtime carries P3-linear coordinates and then gamma-encodes them as though they were
 * sRGB-linear, with no primaries conversion. Matching that pixel-for-pixel is worth less
 * than being right; the difference is a slight gain in saturation.
 *
 * `scripts/probeFlutedGlass.mjs` renders the same formulas on the CPU to a PNG, which is
 * how anything here gets judged. It is a design instrument, not a test of the shader.
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
   * Half-width of the ramp's smoothstep window, around the field's midpoint.
   *
   * How much of the field's range is spent *graduating* rather than pinned at one end. The
   * reference's window is 0.3..0.7, i.e. 0.2 here — and measured across this plate that
   * leaves **46.2% of it flat**, 24.6% at `colorA` and 21.6% at `colorB`, with the ten
   * deciles running 33/8/6/6/6/5/5/4/3/26. Nearly half the plate is one of two solid tones.
   *
   * **That measurement is right and the conclusion drawn from it was backwards, which cost
   * the plate its material for a release.** The reading was "displacing a sample inside a
   * flat region returns the same value, so on half the plate the glass has nothing to bend",
   * and 0.45 (a 0.05..0.95 window) was taken instead, which brings the flat fraction to 7.3%
   * and the deciles to 10/10/12/13/12/10/7/6/8/12 — continuous tone essentially everywhere.
   *
   * But a displacement is equally invisible on a *gentle gradient*: shift a smooth ramp by
   * 154px and it returns very nearly the value that was already there. The one thing a
   * displacement can show is a **boundary**. Widening the window did not give the glass
   * something to bend, it spread every boundary in the field into a slope — so the glass bent
   * light and had nothing to reveal. The plateaus were never dead area; they are what makes
   * the boundaries between them legible, and each reed cutting the same boundary at a
   * different offset is exactly the "the glass does not make an image, it slices one" this
   * file opens with. Rendered side by side the difference is not subtle: at 0.45 the reeds
   * are flat slabs and the plate reads as brushed anodised aluminium; at 0.2 every reed is
   * visibly slicing the flow and the seams carry a prismatic fringe.
   *
   * **And it is not bought with contrast**, which is the guard the paragraph above sets:
   * measured light, span goes 27.2 → 28.1 and mean chroma 4.1 → 4.3. The same quantity of
   * light and shade, given a shape.
   *
   * Note 0.45 was reached partly because a render at 0.2 once "read washed"; that render had
   * a *pink* field at thirty-one code values, where washing out is what a wide ramp does to
   * saturated colour — the fault was the field, and the ramp was what got changed. Ramp width
   * and field span have to be judged in the same sweep, never one after the other.
   */
  ramp: number;
  /**
   * How far the pattern is stretched along the plate's long axis.
   *
   * Not a reference parameter, and the one piece of its geometry that does not port
   * directly: its node reads raw 0..1 uv on a canvas that is very nearly 2:1, where this
   * plate is a full-bleed band past 4:1. Left alone the swirl packs five cells across it.
   *
   * Note what it is a fraction *of*: the x span is `(width / height) * stretch`, so this
   * number is not independent of the band's height. Making the plate taller at a fixed width
   * costs horizontal structure — the 320 → 384 change alone divides the span by 1.2 — and
   * holding the previous cell count would mean multiplying here to pay for it. Measured, and
   * deliberately not paid: at 384 the flow reads as one broad sweep, which is calmer than
   * the reference's own composition and is what a sheet of glass over a slow field should
   * look like.
   *
   * `detail` is the isotropic lever if more structure is ever wanted, not this one. The y
   * span is fixed at 1.0 unit and the primary octave crosses it 0.487 times — a figure
   * `stretch` cannot reach at all — so raising `stretch` alone buys vertical striping rather
   * than flow. Rendered at `detail` 2.6 and 3.6 the plate reads as marbled paper.
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
   * Flutes across one unit of *height*.
   *
   * The reference's own parameter in its own units rather than a pixel pitch: its shader
   * normalises x by the aspect ratio and y by 1, so the flute period is a fraction of the
   * plate's height — at 5 and a 384px band, a 77px pitch, so about nineteen reeds cross a
   * 1440-wide plate.
   *
   * **5, not the reference's 8.** This is the one reference literal changed for how it looks
   * rather than for an arithmetic defect: at 8 the reeds were reported as too fine, and the
   * measurement agrees with the eye — 8 on a band this wide is thirty-odd reeds at a 48px
   * pitch, which reads as corduroy, where the reference spends the same 8 on a card about a
   * third the width and gets a dozen. The parameter ports faithfully; what does not port is
   * the plate's width, and this is the axis that pays for it.
   *
   * Note the two things that move with it, both in the right direction. The refraction reach
   * is `refraction × halfFlute`, so it scales *inversely* — 154px at 5 against 96px at 8,
   * still two pitches either way, and a fatter cylinder bending light further is what a
   * fatter cylinder does. And the dispersion is proportional to the local displacement, so a
   * wider reed puts more room between the three channels' sample points: the prismatic seam
   * is visible at 5 where at 8 it was a sub-pixel suggestion. 4 was rendered too and is a
   * step too far — fifteen reeds across the band stops reading as a reeded sheet and starts
   * reading as diagonal panels.
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
   * It reaches the shader as sin/cos of `lightAngle · π / 360` — a **half** angle, so -90
   * resolves to -45°. That divisor is the reference's own, not a porting slip, and its UI
   * bounds the value to ±90 so the usable arc is ±45. It has been "corrected" to /180 once
   * already and had to be undone; leave it.
   */
  lightAngle: number;
  /**
   * The specular's peak addition, in linear light. Reference: .12 — but see below.
   *
   * The reference's number does not port, because it was a scale on a lobe *times* a
   * Fresnel term that is a constant 0.04 in disguise (the note above `GrainConfig`).
   * Its effective peak was .00505, and this is that quantity named directly.
   *
   * **So the value is that peak, and the arithmetic is worth spelling out** — it shipped at
   * .02 for a release, four times too high, and the excess was invisible rather than bright
   * because it was spread across a lobe five times too wide (see `highlightSoftness`). The
   * lobe peaks where the half-vector meets the normal, at `slope = -1/√2`, `facing = 1/√2`;
   * there Schlick gives `0.04 + 0.96 · (1 − 0.70711)^5 = 0.042069`, and `0.12 × 0.042069 =
   * 0.005048`.
   *
   * **Which is also why the Fresnel factor stays out.** Restoring it and writing `.12` here
   * is arithmetically the same number to five decimal places over the whole visible lobe, so
   * it would buy one `pow` per fragment and nothing else. That equivalence is a property of
   * the *narrow* lobe, though: widen `highlightSoftness` and Fresnel stops being constant
   * across the lobe (at `facing` 0.4 it is 0.115, 2.9x its 0.04 floor), so the two must move
   * together or not at all.
   *
   * One scheme uses it. An addition has no headroom on a plate at linear 1.0 — the note
   * above `GrainConfig` measures `highlight` at 2.0 still leaving white at code 255 — so on
   * the light plate this is inert at any value and `flank` is what draws the reed. On the
   * dark plate, at linear 0.025, .005 is a 20% lift.
   */
  highlight: number;
  /**
   * Peak transmission loss toward the seam, 0..1. Not a reference parameter.
   *
   * The reed the *light* scheme can show. An additive specular has no headroom on a plate
   * at linear 1.0 — no value of `highlight` moves white — where a multiplicative loss is a
   * ratio and cuts as deep as it is asked to. The two levers skew opposite ways: a linear
   * addition is worth ~7.9x more code values on the dark plate, a linear ratio ~4.6x more
   * on the light one, so each scheme's reed is carried by the term that suits it and one
   * number serves both. That is `INK_SIGN`'s argument in the other currency.
   *
   * **0.05 is deliberately a light touch, and the reason is what it competes with.** This
   * term is a function of the flute geometry alone, so it paints the *same* shading on every
   * reed — it gives the sheet its ribs, and nothing about it flows. The flow is the field's,
   * seen through the refraction. Run this high (0.16 was shipped for a round) and each reed
   * reads as its own shaded object, which is corduroy; the reference's silk is broad soft
   * regions sweeping *across* several reeds with the reeds only lightly drawn on top. So the
   * balance to hold is field-dominant: enough here that the ribs exist, not so much that
   * they out-shout the flow.
   */
  flank: number;
  /**
   * 0 = a pin-tight glint (exponent 256), 1 = a broad sheen. Reference: 0, and this is 0.
   *
   * **It was 0.35, on a pitch that no longer exists.** The argument was a sampling one and it
   * was sound at the time: at a 48px pitch the exponent-256 lobe is 1.05 device pixels wide
   * at dpr 1 while `speed` creeps the pattern 7.2px a second, so the glint's sub-pixel phase
   * turned over seven times a second and the line scintillated in place instead of
   * travelling. Then `frequency` went 8 → 5 in a later pass and the pitch became **76.8px**.
   * The lobe is proportional to the pitch, so it went with it, and nobody went back for it:
   *
   *     softness   exponent   48px pitch   76.8px pitch   at dpr 2
   *     0            256        1.05px       1.68px         3.36px
   *     0.1          158        1.34px       2.14px         4.28px
   *     0.35          47        2.45px       3.91px         7.83px
   *
   * At 76.8px the creep is 11.5px/s, so the glint takes **146ms** — about nine frames at
   * 60Hz — to travel its own width. That is a line moving, not a line flickering. 1.05px was
   * the defect; 1.68px is not. Confirmed in a browser rather than left as arithmetic, since
   * it overturns a measurement: cross-correlating presented compositor frames of the shipped
   * plate at **dpr 1**, the worst case, the pattern drifts **12.6px/s** against the 13.4px/s
   * the creep predicts along x, monotone over eleven consecutive samples.
   *
   * What 0 buys is the thing the reference is recognisable for: a razor-thin bright hairline
   * riding each reed, rather than a broad dim wash that measures the same energy and reads as
   * haze. It has to be spent together with `highlight`, since widening the lobe five times
   * while raising the peak four times is what made the term invisible.
   *
   * **The general lesson, because the app has now been bitten by it twice.** A number derived
   * from another number needs the derivation written beside it, or the next change to the
   * thing it was derived from orphans it silently — the other instance is `Textarea`'s 10px
   * block padding, correct against a 48dp field and left behind when the field became 56dp.
   * Here the parent is the pitch, and the pitch is `uResolution.y / frequency`. Note the
   * parenthesis recording the 8 → 5 change was already in this file and was not enough: a
   * derived value needs its parent named where the *value* is, not a note that the parent
   * moved.
   */
  highlightSoftness: number;
  /**
   * Flutes per second the pattern creeps, **down and to the right**. Reference: .15.
   *
   * The direction is the sign of the offset in the shader, and it shipped inverted once. The
   * reeds' normal is `(cos, sin)` of `angle` in a **top-left-origin** frame, so it points
   * right and *down*; a feature sits at a fixed `across · frequency ∓ offset`, which means
   * **adding** the offset makes features travel toward *decreasing* `across` — up and to the
   * left. Subtracting is what sends them along the normal. Measured on the shipped values,
   * a crest moves 19.7px right and 11.9px down over two seconds.
   *
   * So a positive `speed` means "along the reeds' normal", which is the reading the name
   * invites. If this ever looks wrong again, check the sign here before touching the angle:
   * the angle is what the reeds *lean*, and it is separately load-bearing (see the uv-frame
   * note in the backdrop shader, which has been "corrected" and reverted twice).
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
 * The reed has two terms, and they are split by parity rather than by taste.
 *
 * `facing` is even in `slope` and `slope` is odd, so the flank is the reed's *shape* and the
 * specular is which *side* the light is on. Together they read as a cylinder; either one
 * alone reads as a stripe.
 *
 * **The Fresnel factor came out, and the reason is not that it is anticorrelated with the
 * lobe.** That objection invites the correct reply — anticorrelation is what Fresnel *is*,
 * since reflectance peaks at grazing and a specular lobe peaks at the mirror direction. The
 * actual defect was the **angle**: `facing` is the cosine to the *view*, where Schlick wants
 * the light (or half-vector) angle, which here is `incidence`. Take the right one and across
 * the whole visible lobe `incidence` stays inside [0.985, 1], so `(1 - incidence)^5` is at
 * most 6.9e-10 — the correctly-angled term is the constant **0.04** to nine decimal places.
 * It was never a term. It was a factor of 24 sitting between `highlight` and the thing
 * `highlight` appears to control, which is why the reference's `.12` produced a peak of
 * 0.00505 in a band 0.87px wide. `uHighlight` is now that peak itself, in linear light.
 *
 * **`flank` is the reed the light scheme can show, and it exists because no value of
 * `highlight` can.** A plate at linear 1.0 has no headroom for an addition — measured, even
 * `highlight` at 2.0 leaves white at code 255 — where a multiplicative loss is a ratio and
 * cuts as deep as it is asked to. The two levers skew opposite ways, so one number serves
 * both schemes: a linear addition is worth ~7.9x more code values on the dark plate, a
 * linear ratio ~4.6x more on the light one. That is `INK_SIGN`'s light-subtracts /
 * dark-adds arrangement arrived at from the other direction, and it is why there is no
 * per-scheme table here.
 *
 * **Its mask is `1 - facing`, not Schlick.** Schlick's fifth power is back at its F0 floor
 * within 2.4px of the seam at this pitch, so box-filtered onto the sample grid it is one
 * pixel at 0.22 of full depth and the next at 0.04 — under a JND, and it aliases. `1 -
 * facing` gives 0.68 on the seam pixel and 0.32 at 2.4px: a ~5px soft flank that renders the
 * same at every device ratio. It is also exactly 0 at the crown, so **the crown is the
 * plate's own colour byte for byte** — the invariant the wordmark's halo depends on, since
 * that halo is drawn in `--md-sys-color-glass-body` directly over this surface.
 *
 * **The order is load-bearing.** Multiply the transmitted colour first, add the reflection
 * second: a reflection is the light that did not enter the sheet, so scaling it by the
 * transmission as well counts the same loss twice. Note this is deliberately *not* an
 * energy-conserving model — `uHighlight` and `uFlank` are two independent artistic scales,
 * and only their order is physical.
 *
 * **And `highlightSoftness` is back at the reference's 0**, which is the whole of why there is
 * a visible glint to talk about. It left it once for a sampling reason measured at a 48px
 * pitch, and the pitch is 76.8px — this very paragraph used to record that in a parenthesis
 * and not act on it. The recomputed table, and the general lesson about a derived number
 * outliving what it was derived from, are in the field's own docstring.
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
 * The grain does not animate — the reference leaves that flag off.
 *
 * Reseeding per frame is what a projector does; over a still surface it reads as noise
 * rather than grain, because the eye integrates a moving field into a haze while a fixed
 * one sits down into the surface and stops being seen.
 */
export const GRAIN_ANIMATED = false;

/* --- The cursor layer ----------------------------------------------------------------
 *
 * The reference's `ChromaFlow`: a velocity field and a density field the pointer stirs,
 * advected and decayed every frame, coloured by the *direction* of the local flow and
 * composited over the swirl in proportion to density. It is transparent everywhere the
 * cursor has not recently been — which, given the note at the top of this file, is what
 * decides whether the glass is visible at all.
 *
 * Two details of the deposit carry most of the feel, and both are the reference's: the
 * blob's radius scales with the *square* of cursor speed while its amplitude scales with
 * speed, so a flick lays a wide strong trail and a slow drag lays a thin faint one; and
 * density is advected along the velocity field, which is what makes a trail curl rather
 * than merely fade.
 *
 * **Nothing paints but the pointer**, which is the reference's own arrangement and was
 * arrived at here the hard way. Two orbiting "ambient" sources were added on the argument
 * that the plate is above the fold on /about and a touch screen has no pointer, so the glass
 * should always have something to find. What that actually produces is a dark smudge
 * wandering the plate on its own, and a mark nobody made is read as a defect rather than as
 * life — it was reported as one the first time it became visible. The resting plate is the
 * swirl seen through the glass, a 3.7% ripple, and that is a finished picture: it is
 * precisely what the reference ships, since the iframe it lives in is `pointer-events:
 * none` and its own interactive layer never receives a single event.
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
   * Density time constant, seconds. Reference: 1.
   *
   * Its node reads `1 - dt / Math.max(0.4, 1)`, which is `1 - dt / 1` — the 0.4 sits inside
   * a `max` against a larger constant and never applies. This was ported as 0.4, so the
   * trail faded two and a half times too fast to ever curl into anything.
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
 * The low-pass on cursor velocity, as a time constant rather than a per-sample weight.
 *
 * The reference smooths with a flat `v = v * 0.85 + raw * 0.15` once per frame. Expressed
 * that way the filter's real time constant is whatever the frame rate happens to be, so the
 * same gesture reads differently at 60Hz and 120Hz; and an earlier draft here ran it per
 * *pointer event*, which makes it a function of the mouse's polling rate instead. 0.0984s
 * is the constant for which `1 - exp(-dt / τ)` equals 0.15 at a 16ms step — the reference's
 * own weight at the rate it runs at, and now independent of both clocks.
 */
export const TRAIL_VELOCITY_TAU = 0.0984;

/**
 * The ink, as five stops on one hue: a base and the four directions of flow.
 *
 * The base is the plate itself and is not in this table; these are the four directions.
 * `offset` is how far the stop sits from the plate **in sRGB code values**, and that unit is
 * the whole point of the table. The obvious formulation is a luminance *ratio*, and it is
 * not comparable between the two schemes: sRGB is steep near black, so the reference's own
 * 2:1 ratio is 68 code values down from white and only 18 up from a near-black plate. An
 * earlier draft spent four paragraphs arguing about why its two schemes needed different
 * numbers; expressed this way they take the same numbers and differ only in sign.
 *
 * Light subtracts — ink is a shadow on a bright plate. Dark adds — ink is light on a dark
 * one, which is also the only scheme where the specular has anywhere to be. `INK_SIGN` is
 * that, and it is the entire difference between the two.
 *
 * `chroma` is a ceiling on (max − min) over the stop's own luminance, and it *rises as the
 * stop moves away from the plate*: `0.30 · |ln level| / |ln 0.498|`, which is the
 * reference's own relationship at half its strength (it measures 0.065 / 0.279 / 0.366 /
 * 0.646 where this gives 0.023 / 0.128 / 0.181 / 0.300). Half, because a fold is a fold by
 * being mostly light and shade; full chroma on six hues is what the rainbow draft was.
 *
 * The hue is `--md-sys-color-primary`, read off the host, so all eleven palettes follow —
 * including the user's own — and a `var()` never has to reach a uniform. Only its *direction*
 * survives `inkColor` — level and chroma come from this table — so a gold palette and a violet
 * one land on the same fold, in their own colour.
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
 *
 * Shared so the shader and the probe cannot disagree about the one colour decision that is
 * made on the CPU. `chroma` is a ceiling rather than a target — a hue flatter than the
 * figure keeps its own, since saturating it would be inventing colour the palette does not
 * have.
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
  /* Mixing toward the neutral (1, 1, 1) leaves luminance at 1 exactly, because luminance is
     linear in the components and both endpoints have it — so chroma and level are set
     independently rather than fighting each other. */
  const k = spread > 1e-6 ? Math.min(1, chroma / spread) : 0;
  return [
    (1 + (unit[0] - 1) * k) * target,
    (1 + (unit[1] - 1) * k) * target,
    (1 + (unit[2] - 1) * k) * target,
  ];
}

/**
 * All five stops, so the shader and the probe read one function.
 *
 * The base **is the plate**, verbatim, rather than an offset of zero through `inkColor` —
 * which returns a neutral at the plate's luminance, and so came out as `#2c2c2c` under a
 * plate of `#312a2d`. The result was a grey patch wherever the flow had no direction, i.e.
 * a visible edge around the one region that is supposed to be invisible. The reference has
 * the same identity: its `baseColor` is `#ffffff`, which is its swirl's `colorA`.
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
 * Two passes, which is the reference's own structure rather than an optimisation invented
 * here: its `FlutedGlass` node declares `requiresRTT`, so the field behind the glass is
 * rendered once to a texture and the glass reads that texture three times. Evaluating the
 * procedural field three times per fragment instead — which the first draft did — costs
 * about ninety transcendentals a pixel and throws two thirds of them away, since each call
 * keeps one channel. It also happens to be what a real sheet does: sampling a rasterised
 * image bilinearly softens the refraction slightly, and a perfectly crisp warp does not
 * read as glass.
 *
 * The intermediate is an ordinary 8-bit target holding **sRGB-encoded** values, decoded on
 * the way back in. Linear in 8 bits would put the dark scheme's entire plate inside six code
 * values; encoding spends the precision where the eye is, and it is what any ordinary
 * texture would have carried anyway.
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
