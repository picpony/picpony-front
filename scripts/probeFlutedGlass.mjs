/**
 * Renders the /about plate to a PNG, in software, from the app's own `lib/flutedGlass.ts`.
 *
 * This exists because the effect cannot be judged from its numbers and the browser harness
 * on this machine cannot start. Every parameter that is not taken from the reference scene
 * was picked by rendering a sheet and looking at it.
 *
 * It is a CPU transcription of the same formulas the fragment shaders run, so it is a design
 * instrument rather than a test of them — the two can drift, and only the browser can say
 * what actually ships. It follows the shipped structure, though, including the two passes:
 * the field is rasterised once into a buffer and the glass samples that buffer bilinearly,
 * because sampling a rasterised image is part of why the refraction reads as glass.
 *
 *   node scripts/probeFlutedGlass.mjs [width] [height] [--scheme=light|dark]
 *                                     [--time=s] [--out=path] [--stroke] [--<param>=n]
 *
 * Every numeric field of all four config objects is sweepable by its own bare name, with
 * one exception: two of them are called `speed`, so the reeds' creep is `--fluteSpeed` and
 * the flow's clock is `--swirlSpeed`. Colours take `--colorA= --colorB= --sheen= --hue=`.
 *
 * `--stroke` walks a synthetic cursor through all four directions before the frame is taken,
 * so the whole ink ramp can be seen standing still: the four stops are a *lighting* model,
 * so a single arc only ever shows two of them.
 *
 * Module resolution is `scripts/heroPath.mjs`'s hook, for the reasons documented there.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Lazily built by `crc32`; declared up here because `encodePng` runs at module top level. */
let CRC_TABLE;

function withExtension(filePath) {
  if (path.extname(filePath)) return filePath;
  for (const candidate of ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']) {
    if (existsSync(filePath + candidate)) return filePath + candidate;
  }
  return filePath;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!specifier.startsWith('@/') && !relative) return nextResolve(specifier, context);
    const base = specifier.startsWith('@/')
      ? path.join(ROOT, specifier.slice(2))
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const resolved = withExtension(base);
    return {
      url: pathToFileURL(resolved).href,
      shortCircuit: true,
      format:
        resolved.endsWith('.ts') || resolved.endsWith('.tsx') ? 'module-typescript' : undefined,
    };
  },
});

const {
  FLUTE_DEFAULTS,
  SWIRL_DEFAULTS,
  GRAIN_DEFAULTS,
  TRAIL_SIZE,
  TRAIL_DEFAULTS,
  INK_STOPS,
  inkStops,
  srgbDecode,
  srgbEncode,
  linearLuminance,
  fluteExponent,
  fluteSlope,
} = await import('../lib/flutedGlass.ts');
const { FlutedGlassTrail } = await import('../lib/flutedGlassTrail.ts');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const num = (name, fallback) => Number(flag(name, String(fallback)));
const positional = args.filter((a) => !a.startsWith('--'));
const W = Number(positional[0] ?? 1400);
const H = Number(positional[1] ?? 320);
const TIME = num('time', 7);
const SCHEME = flag('scheme', 'light') === 'dark' ? 'dark' : 'light';
const OUT = flag('out', path.join(ROOT, `flutedglass-${SCHEME}.png`));

/* `speed` is the one field name two of the four config objects share, and this flat merge
   cannot hold both: `FluteConfig.speed` is .15, the flutes per second the reeds creep
   sideways, and `SwirlConfig.speed` is 1, the flow's own clock. Spread order silently
   decided which one `--speed=` reached (the swirl), and pass 2 then read
   `FLUTE_DEFAULTS.speed` directly past `cfg` — so the creep was unsweepable twice over, on
   the one parameter whose whole job is to be looked at in motion. The name is *dropped*
   rather than resolved to one of them, so a later `cfg.speed` is `undefined` and renders an
   obviously broken plate instead of a quietly wrong one. Every other field of all four
   objects still answers to its own bare name; this is the only qualified pair. */
const cfg = { ...FLUTE_DEFAULTS, ...SWIRL_DEFAULTS, ...GRAIN_DEFAULTS };
delete cfg.speed;
for (const key of Object.keys(cfg)) {
  if (typeof cfg[key] !== 'number') continue;
  const override = flag(key, null);
  if (override !== null) cfg[key] = Number(override);
}
/* `TRAIL_DEFAULTS` is read live by the sim rather than copied, so overriding it means
   assigning into it. Every field of all four config objects is therefore sweepable by name,
   which is what this tool is for — with the single documented exception of `speed`, which
   two of them declare (see the note above `cfg`). */
for (const key of Object.keys(TRAIL_DEFAULTS)) {
  const override = flag(key, null);
  if (override !== null) TRAIL_DEFAULTS[key] = Number(override);
}

/* Hex to linear-light 0..1, through the app's own transfer curve. The whole render below is
   linear except the intermediate buffer, exactly as the shaders are. */
const hex = (s) => {
  const v = s.replace('#', '');
  return [
    srgbDecode(parseInt(v.slice(0, 2), 16) / 255),
    srgbDecode(parseInt(v.slice(2, 4), 16) / 255),
    srgbDecode(parseInt(v.slice(4, 6), 16) / 255),
  ];
};

/* The three glass tokens. They live in globals.css, so they are spelled here rather than
   imported — a mismatch shows up as a plate the wrong colour, which is what this tool is
   for looking at. */
const BODY = {
  light: { a: '#ffffff', b: '#f0e8ea', sheen: '#ffffff', hue: '#e06c9f' },
  dark: { a: '#312a2d', b: '#4c4447', sheen: '#ffe3ee', hue: '#cb5b8d' },
};
const body = BODY[SCHEME];
const fluteSpeed = num('fluteSpeed', FLUTE_DEFAULTS.speed);
const swirlSpeed = num('swirlSpeed', SWIRL_DEFAULTS.speed);
const colorA = hex(flag('colorA', body.a));
const colorB = hex(flag('colorB', body.b));
const sheen = hex(flag('sheen', body.sheen));
const ink = inkStops(colorA, hex(flag('hue', body.hue)), SCHEME);

/* Run the same sim the component runs. `--stroke` walks the cursor through all four
   directions, since the ink ramp is a lighting model and one arc only shows two of it. */
const trail = new FlutedGlassTrail();
trail.setAspect(W / H);
const STEPS = Math.max(1, Math.round(TIME / 0.016));
const stroke = args.includes('--stroke');
const LEGS = [
  [0.18, 0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.16],
  [0.5, 0.16, 0.82, 0.16],
  [0.82, 0.16, 0.82, 0.84],
];
const STROKE_STEPS = 34;
for (let i = 0; i < STEPS; i += 1) {
  if (stroke) {
    const from = STEPS - LEGS.length * STROKE_STEPS;
    if (i >= from && from >= 0) {
      const leg = LEGS[Math.floor((i - from) / STROKE_STEPS)];
      const k = ((i - from) % STROKE_STEPS) / (STROKE_STEPS - 1);
      trail.move(leg[0] + (leg[2] - leg[0]) * k, leg[1] + (leg[3] - leg[1]) * k);
    }
  }
  trail.step(0.016);
}

/* Bilinear, matching the texture sampler. */
function trailSample(ux, uy, out) {
  const fx = Math.min(Math.max(ux, 0), 1) * (TRAIL_SIZE - 1);
  const fy = Math.min(Math.max(uy, 0), 1) * (TRAIL_SIZE - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, TRAIL_SIZE - 1);
  const y1 = Math.min(y0 + 1, TRAIL_SIZE - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 3; c += 1) {
    const a = trail.pixels[(y0 * TRAIL_SIZE + x0) * 4 + c];
    const b = trail.pixels[(y0 * TRAIL_SIZE + x1) * 4 + c];
    const d = trail.pixels[(y1 * TRAIL_SIZE + x0) * 4 + c];
    const e = trail.pixels[(y1 * TRAIL_SIZE + x1) * 4 + c];
    out[c] =
      (a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty) / 255;
  }
}

/* The shader's uniform five-tap cross. */
const tapA = [0, 0, 0];
const tapB = [0, 0, 0];
function trailAt(ux, uy, out) {
  const o = 1 / TRAIL_SIZE;
  trailSample(ux, uy, tapA);
  for (let c = 0; c < 3; c += 1) out[c] = tapA[c];
  for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o]]) {
    trailSample(ux + dx, uy + dy, tapB);
    for (let c = 0; c < 3; c += 1) out[c] += tapB[c];
  }
  for (let c = 0; c < 3; c += 1) out[c] *= 0.2;
}

/* --- Swirl --- */
function swirlField(ux, uy, t) {
  const s = cfg.detail;
  const ax =
    ux + Math.sin(uy * s * 1.7 + t * 0.8) * 0.12 + Math.cos(ux * s * 0.9 - t * 0.5) * 0.05;
  const ay =
    uy + Math.cos(ux * s * 1.3 - t * 0.6) * 0.12 + Math.sin(uy * s * 1.1 + t * 0.7) * 0.05;
  const o = Math.sin(ax * s * 2.1 + ay * s * 1.8 + t * 0.4);

  const u2 = s * 2.1;
  const dx =
    ax + Math.cos(ay * u2 * 2.7 - t * 0.45) * 0.07 + Math.sin(ax * u2 * 1.9 + t * 0.6) * 0.04;
  const dy =
    ay + Math.sin(ax * u2 * 2.3 + t * 0.65) * 0.07 + Math.cos(ay * u2 * 1.6 - t * 0.4) * 0.04;
  const h = Math.cos(dx * u2 * 1.4 - dy * u2 * 1.9 + t * 0.35);

  const f = s * 3.7;
  const mx =
    dx +
    Math.sin(dy * f * 1.8 + t * 0.85) * 0.04 +
    Math.cos(dx * f * 1.3 - t * 0.55) * 0.025 +
    Math.sin((dx + dy) * f * 0.7 + t * 0.9) * 0.02;
  const my =
    dy +
    Math.cos(dx * f * 1.6 - t * 0.75) * 0.04 +
    Math.sin(dy * f * 1.1 + t * 0.5) * 0.025 +
    Math.cos((dx + dy) * f * 0.8 - t * 0.95) * 0.02;
  const g = Math.sin(mx * f * 1.1 + my * f * 1.5 - t * 0.55);

  return o * 0.45 + h * 0.35 + g * 0.2;
}

const smoothstep = (a, b, v) => {
  const x = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/* --- Pass 1: the field, rasterised into an sRGB-encoded buffer, as the FBO holds it --- */
const backdrop = Buffer.alloc(W * H * 3);
const trailVec = [0, 0, 0];
{
  const t = TIME * swirlSpeed;
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      const ux = (px / H) * cfg.stretch;
      const uy = py / H;
      const field = swirlField(ux, uy, t);
      const bias = (cfg.blend - 50) * 0.006;
      const y = smoothstep(0.5 - cfg.ramp, 0.5 + cfg.ramp, field * 0.5 + 0.5 + bias);
      const shimmer = Math.sin(t * 2.5 + field * 8) * 0.015 + 1;

      trailAt(px / W, py / H, trailVec);
      const cover = smoothstep(0, 0.1, trailVec[2]);
      const vx = trailVec[0] * 2 - 1;
      const vy = trailVec[1] * 2 - 1;
      const mag = Math.hypot(vx, vy);
      const dx = vx / (mag + 0.001);
      const dy = vy / (mag + 0.001);
      const wR = smoothstep(0, 0.7, dx);
      const wL = smoothstep(0, 0.7, -dx);
      const wD = smoothstep(0, 0.7, dy);
      const wU = smoothstep(0, 0.7, -dy);
      const hw = wL + wR;
      const vw = wU + wD;
      const sw = hw + vw + 0.001;
      const k = smoothstep(0.01, 0.1, mag);

      const i = (py * W + px) * 3;
      for (let c = 0; c < 3; c += 1) {
        const swirl = (colorA[c] + (colorB[c] - colorA[c]) * y) * shimmer;
        const directional =
          ((ink.left[c] * wL + ink.right[c] * wR) * hw +
            (ink.up[c] * wU + ink.down[c] * wD) * vw) /
          sw;
        const tint = ink.base[c] + (directional - ink.base[c]) * k;
        backdrop[i + c] = Math.max(
          0,
          Math.min(255, Math.round(srgbEncode(swirl + (tint - swirl) * cover) * 255)),
        );
      }
    }
  }
}

/* The shader's mirror, then a bilinear fetch and a decode back to linear. */
function mirror(u) {
  const m = ((u * 0.5) % 1 + 1) % 1;
  return 1 - Math.abs(m * 2 - 1);
}
function backdropAt(px, py, out) {
  const fx = mirror(px / W) * (W - 1);
  const fy = mirror(py / H) * (H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, W - 1);
  const y1 = Math.min(y0 + 1, H - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 3; c += 1) {
    const a = backdrop[(y0 * W + x0) * 3 + c];
    const b = backdrop[(y0 * W + x1) * 3 + c];
    const d = backdrop[(y1 * W + x0) * 3 + c];
    const e = backdrop[(y1 * W + x1) * 3 + c];
    out[c] = srgbDecode(
      (a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty) / 255,
    );
  }
}

/* --- Pass 2: the glass --- */
const exponent = fluteExponent(cfg.softness);
const rad = (cfg.angle * Math.PI) / 180;
const cosA = Math.cos(rad);
const sinA = Math.sin(rad);
/* /360, not /180 — the reference's own half-angle. See `FluteConfig.lightAngle`. */
const theta = (cfg.lightAngle * Math.PI) / 360;
const lightX = Math.sin(theta);
const lightZ = Math.cos(theta);
const specExponent = Math.pow(2, 8 - cfg.highlightSoftness * 7);
const fluteOffset = TIME * fluteSpeed;
const halfFlute = (0.5 / cfg.frequency) * H;

const out = Buffer.alloc(W * H * 3);
const tap = [0, 0, 0];
const col = [0, 0, 0];

for (let py = 0; py < H; py += 1) {
  for (let px = 0; px < W; px += 1) {
    const across = (px * cosA + py * sinA) / H;
    const u = ((across * cfg.frequency - fluteOffset) % 1 + 1) % 1;
    const r = (u - 0.5) * 2;
    const slope = fluteSlope(r, exponent);
    const shift = -slope * cfg.refraction * halfFlute;
    const split = shift * cfg.aberration * 0.5;

    backdropAt(px + cosA * (shift + split), py + sinA * (shift + split), tap);
    col[0] = tap[0];
    backdropAt(px + cosA * shift, py + sinA * shift, tap);
    col[1] = tap[1];
    backdropAt(px + cosA * (shift - split), py + sinA * (shift - split), tap);
    col[2] = tap[2];

    const facing = Math.sqrt(Math.max(0, 1 - Math.min(slope * slope, 1)));
    /* Order mirrors the shader and is load-bearing: the transmission loss multiplies what
       got through, then the reflection is added on top of it. */
    const flank = 1 - cfg.flank * (1 - facing);
    const incidence = Math.max(slope * lightX + facing * lightZ, 0);
    const spec = Math.pow(incidence, specExponent) * cfg.highlight;
    for (let c = 0; c < 3; c += 1) col[c] = col[c] * flank + sheen[c] * spec;

    /* `fract`, not `%`: the remainder operator keeps the sign, so half the samples came
       back negative and the field read as a diagonal weave rather than as noise. */
    const hash = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
    const noise = (hash - Math.floor(hash)) * 2 - 1;
    const lum = Math.max(
      0,
      Math.min(1, col[0] * 0.2126 + col[1] * 0.7152 + col[2] * 0.0722),
    );
    const grain = noise * Math.pow(1 - lum + 1e-6, cfg.bias) * cfg.strength * 0.1;

    const i = (py * W + px) * 3;
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.max(0, Math.min(255, Math.round(srgbEncode(col[c] + grain) * 255)));
    }
  }
}

writeFileSync(OUT, encodePng(W, H, out));

/**
 * What the rendered plate actually measures, in the two quantities the reference was
 * measured in — so the two are comparable without opening either image.
 *
 * Sampled off `out`, i.e. after every term including the grain, which is the only place
 * these can be read: the field's span (printed below) is an *input*, and the flank, the
 * specular and the ramp all move what comes out of it.
 *
 * The reference, sampled the same way off its own canvas at 1440x760: **luma span 12.3**
 * (242.7..255), **mean chroma 3.8**, max chroma 13. That is the whole of why it reads as
 * white silk rather than as coloured glass — it has almost no colour and very little
 * contrast, and every bit of what it does have is shaped into reeds and flow.
 */
{
  let lmin = 255;
  let lmax = 0;
  let chromaSum = 0;
  let chromaMax = 0;
  let n = 0;
  for (let i = 0; i < out.length; i += 3 * 7) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < lmin) lmin = l;
    if (l > lmax) lmax = l;
    const ch = Math.max(r, g, b) - Math.min(r, g, b);
    chromaSum += ch;
    if (ch > chromaMax) chromaMax = ch;
    n += 1;
  }
  console.log(
    `  rendered: luma ${lmin.toFixed(1)}..${lmax.toFixed(1)} (span ${(lmax - lmin).toFixed(1)})  ` +
      `chroma mean ${(chromaSum / n).toFixed(1)} max ${chromaMax}  ` +
      '[reference: span 12.3, chroma mean 3.8 max 13]',
  );
}

/* The ink ramp in code values, because that is the unit `INK_STOPS` is stated in and the
   one thing worth checking by eye against the picture. */
const plateCode = srgbEncode(linearLuminance(colorA)) * 255;
const toHex = (c) =>
  '#' +
  c
    .map((v) => Math.max(0, Math.min(255, Math.round(srgbEncode(v) * 255))).toString(16).padStart(2, '0'))
    .join('');
const ramp = ['base', 'left', 'down', 'right', 'up']
  .map((k) => `${k} ${Math.round(srgbEncode(linearLuminance(ink[k])) * 255)} ${toHex(ink[k])}`)
  .join('  ');

console.log(
  `${OUT}\n  ${W}x${H} ${SCHEME} t=${TIME}s\n` +
    `  freq ${cfg.frequency} (pitch ${(H / cfg.frequency).toFixed(0)}px)  angle ${cfg.angle}  ` +
    `soft ${cfg.softness} (exp ${exponent})  refr ${cfg.refraction} ` +
    `(reach ${(cfg.refraction * halfFlute).toFixed(0)}px)  abr ${cfg.aberration}\n` +
    `  detail ${cfg.detail}  stretch ${cfg.stretch}  ramp ${cfg.ramp}  hl ${cfg.highlight}/${cfg.highlightSoftness} ` +
    `(exp ${specExponent.toFixed(0)})  flank ${cfg.flank}  grain ${cfg.strength}  ` +
    `speed ${fluteSpeed}/${swirlSpeed} (flute/swirl)  trail ${STEPS} steps${stroke ? ' + stroke' : ''}\n` +
    /* The field's span is what every one of the glass's terms acts on, so it is the first
       number to look at when the plate reads flat. */
    `  plate ${plateCode.toFixed(0)} → ${(srgbEncode(linearLuminance(colorB)) * 255).toFixed(0)} ` +
    `(field ${Math.abs(srgbEncode(linearLuminance(colorB)) * 255 - plateCode).toFixed(0)} codes)  ` +
    `ink ${ramp}  ` +
    `(offsets 0/${Object.values(INK_STOPS).map((s) => s.offset).join('/')})`,
);

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body2 = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body2) >>> 0);
    return Buffer.concat([len, body2, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
