/**
 * `npm run hero:path` — the hero flight's standing checks, over a matrix of realistic box pairs
 * in both directions, exiting non-zero. Asserts: per-decile monotonicity of every rendered edge,
 * exact landing, crop retrace inside its budget, the flight curve leaving from rest, table
 * fidelity at the shipped sample count, and the container transform — accumulated content scale
 * isotropic and equal to the cover fit, clip ∘ compensator ∘ counter == identity parsed from the
 * emitted strings, the reconstructed box == the arc rect, corner containment under the browser's
 * radius clamp, exact unproject, and containment of the picture by the window at the window's own
 * bow. Prints everything else.
 *
 * Imports the app's own modules through `scripts/tsResolve.mjs`. `lib/hero/motion.ts` stays out
 * of reach: it pulls `@/lib/motion`, which wants `matchMedia`.
 */
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('hero:path');

const geometry = await import('../lib/hero/geometry.ts');
const { createHeroRectArc, lerpHeroRectArc, getHeroMediaRenderedWidth } = geometry;
const { progressAt, sampleProgress, velocityAt } = await import('../lib/hero/progress.ts');
const constants = await import('../lib/hero/constants.ts');
const { HERO_FLIGHT_CURVE, HERO_FLIGHT_PROGRESS, HERO_PROGRESS_SAMPLES } = constants;
const {
  formatHeroContainerCompensator,
  formatHeroContainerCounter,
  formatHeroContainerRadius,
  formatHeroTransform,
  getHeroContainerPose,
  unprojectHeroContainerRect,
} = geometry;
const { HERO_CONTAINER_SHAPE, HERO_TARGET_RADIUS_PX } = constants;
const { intervalProgress } = await import('../lib/hero/progress.ts');
const { interpolate } = await import('../lib/hero/spring.ts');

/**
 * The matrix — every box measured, not derived: card rects and host boxes come out of a browser
 * on the fixture gallery at three viewports, and the well is derived from the host the way the
 * layout derives it (centred, less the scrollbar gutter, below the measured chrome). Destination
 * widths come from the app's own `getHeroMediaRenderedWidth`. 1920 is in the matrix because it is
 * the one geometry where an outer-column flight is a long, mostly horizontal move into a box that
 * straddles the card vertically — where the two corner arcs bow in opposite screen directions.
 * `chrome` is the overlay-top-to-media-top distance, matching `HERO_MEDIA_VIEWPORT_CHROME_PX`.
 */
const DESKTOP = {
  label: '1440', width: 1440, height: 900,
  host: { left: 300, top: 120, width: 1128, height: 768 },
  chrome: 101, gutter: 8,
};
const WIDE = {
  label: '1920', width: 1920, height: 1080,
  host: { left: 300, top: 120, width: 1608, height: 948 },
  chrome: 101, gutter: 8,
};
const PHONE = {
  label: '390', width: 390, height: 844,
  host: { left: 0, top: 108, width: 390, height: 736 },
  chrome: 118, gutter: 0,
};

/** The media well: the app's own width helper, placed the way the layout places it. */
function destination(image, viewport) {
  const width = getHeroMediaRenderedWidth(image, viewport);
  return {
    left: viewport.host.left + (viewport.host.width - viewport.gutter - width) / 2,
    top: viewport.host.top + viewport.chrome,
    width,
    height: width * (image.height / image.width),
  };
}

const LANDSCAPE = { width: 1600, height: 900 };
const WIDESCREEN = { width: 2000, height: 1100 };
const PANORAMA = { width: 2400, height: 800 };
const TALL = { width: 800, height: 2000 };
const PORTRAIT = { width: 900, height: 1600 };
const SQUARE = { width: 1400, height: 1400 };

/** Sources are real card boxes at the row's viewport. The featured banner is the one synthetic
 *  pair — in view and at a negative `top`, the case that found the inset-clamp bug; the fixture
 *  gallery has no banner to measure. */
const CASES = [
  ['masonry mid-column', { left: 324, top: 144, width: 256, height: 144 }, LANDSCAPE, DESKTOP],
  ['masonry below fold', { left: 324, top: 490, width: 256, height: 141 }, WIDESCREEN, DESKTOP],
  ['tile far right low', { left: 1139, top: 581, width: 256, height: 197 }, LANDSCAPE, DESKTOP],
  ['tile top-left tall', { left: 324, top: 770, width: 256, height: 606 }, TALL, DESKTOP],
  ['tall tile far left', { left: 596, top: 144, width: 256, height: 454 }, PORTRAIT, DESKTOP],
  ['same row, sideways', { left: 1139, top: 144, width: 256, height: 85 }, PANORAMA, DESKTOP],
  ['banner, in view', { left: 324, top: 40, width: 1071, height: 376 }, LANDSCAPE, DESKTOP],
  ['banner, above fold', { left: 324, top: -116, width: 1071, height: 376 }, LANDSCAPE, DESKTOP],
  ['square to portrait', { left: 867, top: 144, width: 256, height: 256 }, SQUARE, DESKTOP],
  ['portrait tile', { left: 867, top: 416, width: 256, height: 639 }, TALL, DESKTOP],
  ['wide, left column', { left: 459, top: 144, width: 308, height: 173 }, LANDSCAPE, WIDE],
  ['wide, left, tall', { left: 459, top: 886, width: 308, height: 730 }, TALL, WIDE],
  ['wide, middle column', { left: 1107, top: 468, width: 308, height: 770 }, TALL, WIDE],
  ['wide, right column', { left: 1431, top: 664, width: 308, height: 237 }, LANDSCAPE, WIDE],
  ['wide, right, pano', { left: 1431, top: 144, width: 308, height: 103 }, PANORAMA, WIDE],
  ['phone tile', { left: 16, top: 124, width: 175, height: 98 }, LANDSCAPE, PHONE],
  ['phone tile, tall', { left: 16, top: 604, width: 175, height: 438 }, TALL, PHONE],
  ['phone, 2nd column', { left: 199, top: 124, width: 175, height: 311 }, PORTRAIT, PHONE],
];


// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const EDGES = ['left', 'top', 'right', 'bottom'];
const edgeOf = (rect, edge) =>
  edge === 'left' ? rect.left
  : edge === 'top' ? rect.top
  : edge === 'right' ? rect.left + rect.width
  : rect.top + rect.height;

const failures = [];
function fail(check, message) {
  failures.push(`${check}: ${message}`);
}

/* The crop metric is `geometry.ts`'s, not a copy. This audits at 401 points against the solver's
   own 65, hence `HERO_ARC_CROP_TOLERANCE` on the assertion: the coarser solver view can miss the
   peak by up to a third of a point. */
const AUDIT_SAMPLES = 401;

function auditPath(from, to, baseAspect, arc, samples = AUDIT_SAMPLES) {
  const direction = {};
  for (const edge of EDGES) direction[edge] = Math.sign(edgeOf(to, edge) - edgeOf(from, edge));
  let previous = lerpHeroRectArc(arc, 0);
  let reversals = 0;
  let worstReversal = 0;
  let pastLanding = 0;
  let pastEdge = '';
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const rect = lerpHeroRectArc(arc, progressAt(HERO_FLIGHT_PROGRESS.forward, t));
    for (const edge of EDGES) {
      if (!direction[edge]) continue;
      const step = edgeOf(rect, edge) - edgeOf(previous, edge);
      if (Math.sign(step) && Math.sign(step) !== direction[edge] && Math.abs(step) > 1e-9) {
        reversals += 1;
        worstReversal = Math.max(worstReversal, Math.abs(step));
      }
      const past = (edgeOf(rect, edge) - edgeOf(to, edge)) * direction[edge];
      if (past > pastLanding) {
        pastLanding = past;
        pastEdge = edge;
      }
    }
    previous = rect;
  }
  const landed = lerpHeroRectArc(arc, 1);
  let landingError = 0;
  for (const edge of EDGES) {
    landingError = Math.max(landingError, Math.abs(edgeOf(landed, edge) - edgeOf(to, edge)));
  }
  const crop = geometry.heroArcCropRetrace(arc, baseAspect, AUDIT_SAMPLES);
  return { reversals, worstReversal, pastLanding, pastEdge, landingError, crop };
}

// ---------------------------------------------------------------------------
// (a) edges, (a') landing, (b) crop
// ---------------------------------------------------------------------------

const BUDGET = constants.HERO_ARC_CROP_BUDGET;
const CEILING = BUDGET + constants.HERO_ARC_CROP_TOLERANCE;

console.log(
  `\nhero path — ${HERO_FLIGHT_CURVE.css}, ${HERO_PROGRESS_SAMPLES} samples, ` +
    `crop budget ${(BUDGET * 100).toFixed(1)}% (ceiling ${(CEILING * 100).toFixed(1)}% at ` +
    `${AUDIT_SAMPLES} audit points against the solver's ${constants.HERO_ARC_SOLVE_SAMPLES})`,
);
console.log(
  '\n' +
    'case                 dir   edges      past-landing   crop    bow',
);
for (const [name, from, image, viewport] of CASES) {
  const to = destination(image, viewport);
  // `flight.base` is the detail box in both directions, so both legs share its aspect.
  const baseAspect = to.width / to.height;
  for (const dir of ['fwd', 'back']) {
    const a = dir === 'fwd' ? from : to;
    const b = dir === 'fwd' ? to : from;
    const bow = geometry.solveHeroArcBow(a, b, baseAspect);
    const audit = auditPath(a, b, baseAspect, createHeroRectArc(a, b, bow));
    const edges =
      audit.reversals === 0 ? 'monotone ' : `FAIL ${String(audit.reversals).padStart(3)}`;
    const past = audit.pastLanding > 0.05 ? `${audit.pastEdge} +${audit.pastLanding.toFixed(1)}px` : 'none';
    const retrace = `${(audit.crop * 100).toFixed(1)}%`;
    console.log(
      `${name.padEnd(20)} ${dir.padEnd(5)} ${edges}  ${past.padEnd(14)} ${retrace.padStart(6)}  ${bow.toFixed(2)}`,
    );
    if (audit.reversals > 0) {
      fail('a/edges', `${name} ${dir} reverses ${audit.reversals}x, worst ${audit.worstReversal.toFixed(2)}px`);
    }
    if (audit.pastLanding > 0.05) {
      fail('a/edges', `${name} ${dir} drives ${audit.pastEdge} ${audit.pastLanding.toFixed(1)}px past its landing value`);
    }
    if (audit.landingError > 1e-6) {
      fail("a'/landing", `${name} ${dir} lands ${audit.landingError.toExponential(2)}px off`);
    }
    if (audit.crop > CEILING) {
      fail(
        'b/crop',
        `${name} ${dir} retraces ${(audit.crop * 100).toFixed(1)}% of the picture, over the ` +
          `${(CEILING * 100).toFixed(1)}% ceiling`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (c) table fidelity, (d) model sanity
// ---------------------------------------------------------------------------

const TABLE_TOLERANCE = 0.004;
const MODELS = [
  ['HERO_FLIGHT_CURVE', HERO_FLIGHT_PROGRESS.forward],
  ...[-0.5, 0, 1, 2, 2.5].map((velocity) => [
    `spring v=${velocity}`,
    { kind: 'spring', response: { ...constants.HERO_FLIGHT_RESPONSE.forward, velocity } },
  ]),
];

function tableError(model, samples) {
  const table = sampleProgress(model, samples);
  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i <= 20000; i += 1) {
    const t = i / 20000;
    let segment = 0;
    while (segment < table.length - 2 && table[segment + 1].offset < t) segment += 1;
    const a = table[segment];
    const b = table[segment + 1];
    const span = b.offset - a.offset;
    const lerp = span > 0 ? a.progress + (b.progress - a.progress) * ((t - a.offset) / span) : a.progress;
    const error = Math.abs(lerp - progressAt(model, t));
    if (error > worst) {
      worst = error;
      worstAt = t;
    }
  }
  return { worst, worstAt };
}

console.log('\nmodel               p(0) p(1) monotone  v(0)      table@24   table@32');
for (const [label, model] of MODELS) {
  const zero = progressAt(model, 0);
  const one = progressAt(model, 1);
  let monotone = true;
  let previous = 0;
  for (let i = 1; i <= 401; i += 1) {
    const value = progressAt(model, i / 401);
    if (value < previous - 1e-9) monotone = false;
    previous = value;
  }
  const at24 = tableError(model, 24);
  const at32 = tableError(model, 32);
  const launch = velocityAt(model, 0);
  console.log(
    `${label.padEnd(19)} ${zero.toFixed(1)}  ${one.toFixed(1)}  ${(monotone ? 'yes' : 'dips').padEnd(8)} ` +
      `${launch.toFixed(4).padStart(8)}  ${(at24.worst * 100).toFixed(3)}%    ${(at32.worst * 100).toFixed(3)}%`,
  );
  if (zero !== 0 || one !== 1) fail('d/model', `${label} does not span [0, 1] exactly`);
  /* A negative-velocity leg is expected to dip below 0 before recovering — that dip is the
     catch, not a bug. Monotonicity is required of the from-rest models only. */
  const launchesBackwards = model.kind === 'spring' && model.response.velocity < 0;
  if (!monotone && !launchesBackwards) fail('d/model', `${label} is not monotone on [0, 1]`);
  const shipped = tableError(model, HERO_PROGRESS_SAMPLES);
  if (shipped.worst > TABLE_TOLERANCE) {
    fail(
      'c/table',
      `${label} tables to ${(shipped.worst * 100).toFixed(3)}% at ${HERO_PROGRESS_SAMPLES} samples ` +
        `(tolerance ${(TABLE_TOLERANCE * 100).toFixed(1)}%)`,
    );
  }
}

// ---------------------------------------------------------------------------
// (e) The container transform — every assertion aims at a plausible way of getting
// the construction wrong that still compiles, runs, and looks fine for 296ms.
// ---------------------------------------------------------------------------

/** `translate3d(x, y, 0) scale(a, b)` -> {x, y, a, b}. Parsed, not recomputed: see (e/compose). */
function parseTranslateScale(css) {
  const m = css.match(
    /^translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale\(([-\d.]+), ([-\d.]+)\)$/,
  );
  if (!m) throw new Error(`unparsable clip transform: ${css}`);
  return { x: +m[1], y: +m[2], a: +m[3], b: +m[4] };
}

/** `scaleY(k)` -> k. */
/**
 * The compensator, as the two emitted components. One is exactly 1 and the other carries the lift
 * (which is which is the fit's own choice). Parsed as a pair so the isotropy, compose and
 * anisotropy checks are written once for either axis.
 */
function parseCompensator(css) {
  const m = css.match(/^scale\(([-\d.e]+), ([-\d.e]+)\)$/);
  if (!m) throw new Error(`unparsable compensator: ${css}`);
  return { x: +m[1], y: +m[2] };
}

/** `scale(k) translate(apx, bpx)` -> {k, a, b}. */
function parseScaleTranslate(css) {
  const m = css.match(/^scale\(([-\d.e]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)$/);
  if (!m) throw new Error(`unparsable counter: ${css}`);
  return { k: +m[1], a: +m[2], b: +m[3] };
}

const CONTAINER_SAMPLES = 97;
/**
 * Anisotropy the WAAPI lerp may introduce between two keyframes, as a fraction: 0.6%, against a
 * measured 0.441% (4.2px of squash on a 948px box). The honest figure requires sampling between
 * the *real* keyframes — `HERO_PROGRESS_SAMPLES` offsets of eased progress, not uniform progress
 * steps, which sample finer than the compositor and under-report the error. Raising
 * `HERO_PROGRESS_SAMPLES` from 32 to 48 is what brought it down from 0.99%.
 */
const ANISOTROPY_TOLERANCE = 0.006;

let worstAnisotropy = 0;
let worstCornerOvershoot = 0;
let worstCornerRatio = 1;

console.log('\ncontainer transform');
console.log('case                 dir   isotropy   compose   landing   corner        cap');

for (const [label, card, image, viewport] of CASES) {
  const host = { left: 0, top: 0, width: viewport.width, height: viewport.height };
  for (const direction of ['forward', 'back']) {
    const forward = direction === 'forward';
    const clipFrom = forward ? card : host;
    const clipTo = forward ? host : card;
    const radiusFrom = forward ? HERO_TARGET_RADIUS_PX : 0;
    const radiusTo = forward ? 0 : HERO_TARGET_RADIUS_PX;
    const shape = HERO_CONTAINER_SHAPE[direction];
    const arc = createHeroRectArc(clipFrom, clipTo, 1);

    let isotropy = 0;
    let compose = 0;
    let boxError = 0;
    let fitError = 0;
    let capBound = false;
    const poses = [];

    for (let i = 0; i <= CONTAINER_SAMPLES; i += 1) {
      const progress = i / CONTAINER_SAMPLES;
      const box = lerpHeroRectArc(arc, progress);
      const pose = getHeroContainerPose(box, host);
      poses.push(pose);

      const clip = parseTranslateScale(formatHeroTransform(pose));
      const comp = parseCompensator(formatHeroContainerCompensator(pose));
      const counter = parseScaleTranslate(formatHeroContainerCounter(pose));

      /* (e/isotropy) The accumulated content scale must be the same on both axes — catches an
         inverted compensator, one on the wrong node, or one lifting the wrong axis: a plausible
         but squashed page, i.e. the failure nobody spots inside 194ms. */
      const fitX = clip.a * comp.x;
      const fitY = clip.b * comp.y;
      isotropy = Math.max(isotropy, Math.abs(fitY - fitX) / Math.max(1, fitX));

      /* (e/fit) The fit must be `max(sx, sy)` — cover. Fitting to the smaller scale leaves a band
         of the window unpainted: measured 138px of an 866px window at 1920x1080 on a portrait
         picture, with the flyer hanging 111px past the paint. */
      fitError = Math.max(fitError, Math.abs(fitX - Math.max(clip.a, clip.b)));

      /* (e/compose) clip . compensator . counter must be the identity, parsed from the emitted
         strings rather than re-multiplied: the mistake worth catching is at the string level —
         swap the counter's two functions and only this fails, where the app would merely put the
         opening flyer ~100px out on a device you are not holding. */
      const accX = fitX * counter.k;
      const accY = fitY * counter.k;
      const accDX = clip.x + fitX * counter.k * counter.a;
      const accDY = clip.y + fitY * counter.k * counter.b;
      compose = Math.max(
        compose,
        Math.abs(accX - 1),
        Math.abs(accY - 1),
        Math.abs(accDX),
        Math.abs(accDY),
      );

      /* (e/box) The visible box reconstructed from the pose must be the arc's own rect. */
      boxError = Math.max(
        boxError,
        Math.abs(host.left + clip.x - box.left),
        Math.abs(host.top + clip.y - box.top),
        Math.abs(host.width * clip.a - box.width),
        Math.abs(host.height * clip.b - box.height),
      );

      /* (e/corner) Containment, and the browser's own clamp. */
      const screenR = interpolate(
        radiusFrom,
        radiusTo,
        intervalProgress(progress, shape.start, shape.end),
      );
      const local = Number.parseFloat(formatHeroContainerRadius(pose, host, screenR));
      if (screenR > 0) {
        const rx = local * pose.scaleX;
        const ry = local * pose.scaleY;
        if (rx < screenR - 1e-9 || ry < screenR - 1e-9) {
          fail(
            'e/corner',
            `${label} ${direction} p=${progress.toFixed(2)} cuts ${rx.toFixed(2)}x${ry.toFixed(2)} ` +
              `against R=${screenR.toFixed(2)}`,
          );
        }
        if (local * 2 > Math.min(host.width, host.height) + 1e-9) capBound = true;
        worstCornerOvershoot = Math.max(worstCornerOvershoot, Math.min(rx, ry) - screenR);
        worstCornerRatio = Math.max(worstCornerRatio, Math.max(rx, ry) / Math.min(rx, ry));
      }

      /* (e/unproject) The inverse must be exact, on both axes — projected at the *fit* scale,
         which is what the compensator establishes. */
      const probe = { left: 137, top: 241, width: 313, height: 97 };
      const scale = geometry.heroContainerFitScale(pose);
      const screen = {
        left: box.left + (probe.left - host.left) * scale,
        top: box.top + (probe.top - host.top) * scale,
        width: probe.width * scale,
        height: probe.height * scale,
      };
      const back = unprojectHeroContainerRect(screen, box, host);
      const round = Math.max(
        Math.abs(back.left - probe.left),
        Math.abs(back.top - probe.top),
        Math.abs(back.width - probe.width),
        Math.abs(back.height - probe.height),
      );
      if (round > 1e-6) {
        fail('e/unproject', `${label} ${direction} round-trips off by ${round.toExponential(2)}`);
      }
    }

    /* (e/anisotropy) WAAPI lerps `scale(sx, sy)` and the compensator's single axis independently,
       so between two samples the product is not isotropic — real, unavoidable, and pinned to a
       number so a change to `HERO_PROGRESS_SAMPLES` or the decomposition cannot quietly make it
       visible. Sampled between the real keyframes (eased offsets, not the uniform steps above),
       which is the only honest figure. */
    const keyPoses = sampleProgress(HERO_FLIGHT_PROGRESS[direction], HERO_PROGRESS_SAMPLES).map(
      ({ progress }) => getHeroContainerPose(lerpHeroRectArc(arc, progress), host),
    );
    for (let i = 0; i + 1 < keyPoses.length; i += 1) {
      const a = keyPoses[i];
      const b = keyPoses[i + 1];
      const compOf = (p) => {
        const fit = Math.max(p.scaleX, p.scaleY);
        return { x: fit / p.scaleX, y: fit / p.scaleY };
      };
      const ca = compOf(a);
      const cb = compOf(b);
      for (let k = 1; k < 8; k += 1) {
        const t = k / 8;
        const sx = a.scaleX + (b.scaleX - a.scaleX) * t;
        const sy = a.scaleY + (b.scaleY - a.scaleY) * t;
        const fitX = sx * (ca.x + (cb.x - ca.x) * t);
        const fitY = sy * (ca.y + (cb.y - ca.y) * t);
        worstAnisotropy = Math.max(worstAnisotropy, Math.abs(fitY / fitX - 1));
      }
    }

    /* (e/landing) The handoff frame swaps the Stage's nodes for the route's untransformed ones,
       so a residual 0.999 is a sub-pixel text shift in the one frame nothing may move. */
    const endPose = getHeroContainerPose(lerpHeroRectArc(arc, 1), host);
    const endClip = formatHeroTransform(endPose);
    const endComp = formatHeroContainerCompensator(endPose);
    const endCounter = formatHeroContainerCounter(endPose);
    const endRadius = formatHeroContainerRadius(endPose, host, radiusTo);
    const landed =
      (forward
        ? endClip === 'translate3d(0px, 0px, 0) scale(1, 1)' &&
          endComp === 'scale(1, 1)' &&
          endCounter === 'scale(1) translate(0px, 0px)'
        : true) && Number.parseFloat(endRadius) >= 0;

    if (!landed) {
      fail('e/landing', `${label} ${direction} lands at ${endClip} / ${endComp} / ${endCounter}`);
    }

    /* (e/clamp) A negative-`top` source has to stay expressible; the old inset form clamped it
       to 0 and slid the whole window to the host's edge. */
    if (card.top < 0 && !forward) {
      let above = false;
      for (const pose of poses) if (host.top + pose.y < host.top - 1) above = true;
      if (!above) fail('e/clamp', `${label} never expresses a box above the host`);
    }

    if (isotropy > 1e-9) fail('e/isotropy', `${label} ${direction} off by ${isotropy.toExponential(2)}`);
    if (fitError > 1e-9) fail('e/fit', `${label} ${direction} does not fit to cover, off by ${fitError.toExponential(2)}`);
    if (compose > 1e-9) fail('e/compose', `${label} ${direction} off by ${compose.toExponential(2)}`);
    if (boxError > 1e-9) fail('e/box', `${label} ${direction} off by ${boxError.toExponential(2)}`);
    if (capBound) fail('e/corner', `${label} ${direction} needs a radius the browser would clamp`);

    console.log(
      `${label.padEnd(20)} ${direction.padEnd(5)} ${isotropy.toExponential(1).padStart(8)}  ` +
        `${compose.toExponential(1).padStart(8)}  ${(landed ? 'exact' : 'OFF').padEnd(7)}  ` +
        `${worstCornerRatio.toFixed(2).padStart(5)}:1 max     ${capBound ? 'BOUND' : 'clear'}`,
    );
  }
}

console.log(
  `\nworst between-sample anisotropy ${(worstAnisotropy * 100).toFixed(3)}% ` +
    `(tolerance ${(ANISOTROPY_TOLERANCE * 100).toFixed(1)}%), ` +
    `worst corner overshoot ${worstCornerOvershoot.toFixed(2)}px, ` +
    `worst corner ellipticity ${worstCornerRatio.toFixed(2)}:1`,
);
if (worstAnisotropy > ANISOTROPY_TOLERANCE) {
  fail(
    'e/anisotropy',
    `interpolated pair reaches ${(worstAnisotropy * 100).toFixed(3)}% anisotropy`,
  );
}

/* The flight leaves from rest — asserted rather than commented, because the constants read
   `velocity: 0.9` for a long time while claiming it. */
if (velocityAt(HERO_FLIGHT_PROGRESS.forward, 0) !== 0) {
  fail('d/model', 'HERO_FLIGHT_CURVE does not leave from rest');
}

// ---------------------------------------------------------------------------
// (f) containment — the picture never leaves the window, and keeps its arc
//
// `[data-image-detail-clip]` is `overflow: clip`, so anything the flyer does outside the window
// is a visible crop. Asserted via `solveHeroArcContainBows`; the window gives way instead of the
// picture, so `bow(pic)` stays at the crop budget's answer wherever the crop allows.
// ---------------------------------------------------------------------------

/** The overlay's own box, measured — see the viewport constants. */
const overlayBox = (viewport) => viewport.host;

/** Peak deviation of the box centre from its own chord, which is what reads as the parabola. */
function centreBow(arc) {
  const mid = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const a = mid(lerpHeroRectArc(arc, 0));
  const b = mid(lerpHeroRectArc(arc, 1));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  let worst = 0;
  for (let i = 1; i < AUDIT_SAMPLES; i += 1) {
    const p = mid(lerpHeroRectArc(arc, i / AUDIT_SAMPLES));
    worst = Math.max(worst, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / (chord || 1));
  }
  return { px: worst, pct: chord > 0 ? (worst / chord) * 100 : 0 };
}

/* The old solver: one scalar for both arcs, bisected from a feasible 0. Kept here so the last
   table column is a real comparison, not a remembered one. */
function sharedContainBow(card, media, host, cropBow) {
  const holds = (bow) => {
    const inner = createHeroRectArc(card, media, bow);
    const outer = createHeroRectArc(card, host, bow);
    for (let i = 0; i <= constants.HERO_ARC_SOLVE_SAMPLES; i += 1) {
      const p = i / constants.HERO_ARC_SOLVE_SAMPLES;
      if (
        geometry.heroRectEscape(lerpHeroRectArc(inner, p), lerpHeroRectArc(outer, p)) >
        constants.HERO_ARC_CONTAIN_SLACK
      ) {
        return false;
      }
    }
    return true;
  };
  if (holds(1)) return cropBow;
  let low = 0;
  let high = 1;
  for (let step = 0; step < constants.HERO_ARC_SOLVE_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (holds(mid)) low = mid;
    else high = mid;
  }
  return Math.min(cropBow, low);
}

/* Audited at `AUDIT_SAMPLES` against a solver at `HERO_ARC_SOLVE_SAMPLES`, so a residual is
   expected — the ceiling is the measured worst case, rounded up to the pixel. */
const ESCAPE_CEILING = constants.HERO_ARC_CONTAIN_SLACK + 1;
let worstEscape = 0;
let worstRawEscape = 0;
const gaveWay = [];

console.log('\ncontainment — the window gives way, the picture keeps its arc');
console.log('case                 bow(pic)  bow(win)   escape   picture bow      window bow      was');
for (const [name, card, image, viewport] of CASES) {
  const media = destination(image, viewport);
  const host = overlayBox(viewport);
  const baseAspect = media.width / media.height;
  const cropBow = geometry.solveHeroArcBow(card, media, baseAspect);
  const bows = geometry.solveHeroArcContainBows(
    { from: card, to: media, bow: cropBow },
    { from: card, to: host },
    host,
  );
  const picArc = createHeroRectArc(card, media, bows.inner);
  const winArc = createHeroRectArc(card, host, bows.outer);
  /* The visible loss is `(picture ∩ host) \ window`: the overlay and its host are both
     `overflow: hidden` on one box, so a picture edge outside *that* is clipped whether the window
     holds it or not. Audited on the clipped rect, with the raw figure printed beside it. */
  const clipToHost = (rect) => {
    const left = Math.max(rect.left, host.left);
    const top = Math.max(rect.top, host.top);
    return {
      left,
      top,
      width: Math.max(0, Math.min(rect.left + rect.width, host.left + host.width) - left),
      height: Math.max(0, Math.min(rect.top + rect.height, host.top + host.height) - top),
    };
  };
  let escape = 0;
  let rawEscape = 0;
  for (let i = 0; i <= AUDIT_SAMPLES; i += 1) {
    const p = i / AUDIT_SAMPLES;
    const picture = lerpHeroRectArc(picArc, p);
    const window = lerpHeroRectArc(winArc, p);
    rawEscape = Math.max(rawEscape, geometry.heroRectEscape(picture, window));
    const seen = clipToHost(picture);
    if (!(seen.width > 0) || !(seen.height > 0)) continue;
    escape = Math.max(escape, geometry.heroRectEscape(seen, window));
  }
  worstRawEscape = Math.max(worstRawEscape, rawEscape);
  worstEscape = Math.max(worstEscape, escape);
  const pic = centreBow(picArc);
  const win = centreBow(winArc);
  /* What one shared scalar gave the picture, for the record: the same containment criterion with
     both arcs on one bow. */
  const shared = sharedContainBow(card, media, host, cropBow);
  const was = centreBow(createHeroRectArc(card, media, shared));
  console.log(
    `${name.padEnd(20)} ${bows.inner.toFixed(2).padStart(8)}  ${bows.outer.toFixed(2).padStart(8)}  ` +
      `${escape.toFixed(1).padStart(7)}   ${`${pic.px.toFixed(0)}px ${pic.pct.toFixed(1)}%`.padEnd(15)}  ` +
      `${`${win.px.toFixed(0)}px ${win.pct.toFixed(1)}%`.padEnd(14)}  ${was.pct.toFixed(1).padStart(5)}%`,
  );
  if (escape > ESCAPE_CEILING) {
    fail(
      'f/contain',
      `${name} leaves the window by ${escape.toFixed(1)}px, over the ${ESCAPE_CEILING}px ceiling`,
    );
  }
  /* The picture giving way is the solver's last resort, and it is printed rather than failed:
     two pairs on this matrix genuinely reach it. Compare the last column instead — every row has
     to beat what one shared scalar gave. */
  if (bows.inner < cropBow - 1e-9) gaveWay.push(name);
}
console.log(
  `\nworst escape ${worstEscape.toFixed(2)}px against a ${constants.HERO_ARC_CONTAIN_SLACK}px ` +
    `solver slack (ceiling ${ESCAPE_CEILING}px at ${AUDIT_SAMPLES} audit points against the ` +
    `solver's ${constants.HERO_ARC_SOLVE_SAMPLES}); worst raw escape ` +
    `${worstRawEscape.toFixed(0)}px, all of it outside the overlay`,
);

console.log('\nper-tenth travel');
for (const [label, model] of MODELS.slice(0, 2)) {
  const row = [];
  let previous = 0;
  for (let i = 1; i <= 10; i += 1) {
    const value = progressAt(model, i / 10);
    row.push(((value - previous) * 100).toFixed(1).padStart(5));
    previous = value;
  }
  console.log(`${label.padEnd(19)}${row.join('')}`);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('\nall checks passed');
