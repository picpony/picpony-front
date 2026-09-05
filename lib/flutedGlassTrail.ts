import { TRAIL_DEFAULTS, TRAIL_SIZE, TRAIL_VELOCITY_TAU } from '@/lib/flutedGlass';

/**
 * The cursor's ink: a velocity field and a density field, advected and decayed on the CPU.
 * Deliberately not a GPU ping-pong pass — at 128x128 the JS loop costs well under a
 * millisecond, far less than the extra framebuffers and program a ping-pong pass would
 * need for a decorative band. Output: one 128x128 RGBA texture uploaded per frame.
 *
 * - Velocity is measured per frame, in `step`, never per pointer event: a parked cursor must
 *   report zero and stop depositing instead of pouring ink until the blob saturates.
 * - The blob is round on screen: the longer axis is scaled by the plate's aspect before the
 *   distance test, else a circle in this unit-square field renders as an ellipse.
 * - `dt` is stepped, never clamped: clamping at 30fps runs the flow at half real time and
 *   swallows the motion-speed preference; the stepped total stays bounded for background tabs.
 * - Density is advected along the velocity field rather than merely faded, so trails curl.
 *
 * Touches no DOM, so `scripts/probeFlutedGlass.mjs` drives the same class.
 */

const N = TRAIL_SIZE;
const CELLS = N * N;

/** Largest step the advection stays stable at. */
const MAX_STEP = 0.016;

/** Sampled by the shader as rg = velocity (0.5-centred), b = density. */
export class FlutedGlassTrail {
  private vel = new Float32Array(CELLS * 2);
  private velNext = new Float32Array(CELLS * 2);
  private density = new Float32Array(CELLS);
  private densityNext = new Float32Array(CELLS);
  /** What gets uploaded. */
  readonly pixels = new Uint8Array(CELLS * 4);

  constructor() {
    /* Seed a defined neutral: all-zero decodes to velocity (-1, -1), a direction nothing flows in. */
    this.encode();
  }

  private pointerX = -1;
  private pointerY = -1;
  private lastX = -1;
  private lastY = -1;
  private rawVx = 0;
  private rawVy = 0;
  private smoothVx = 0;
  private smoothVy = 0;
  private seen = false;
  /** Plate width over height, so the deposit is round on screen rather than in the grid. */
  private aspect = 1;

  /** Pointer position in 0..1 of the plate, top-left origin. Records only; velocity is sampled in `step`. */
  move(x: number, y: number) {
    this.pointerX = x;
    this.pointerY = y;
    if (!this.seen) {
      this.lastX = x;
      this.lastY = y;
    }
    this.seen = true;
  }

  leave() {
    this.seen = false;
    /* Reset velocity too: re-entry would otherwise resume with the pre-leave direction — wrong-colour ink. */
    this.rawVx = 0;
    this.rawVy = 0;
    this.smoothVx = 0;
    this.smoothVy = 0;
  }

  setAspect(aspect: number) {
    this.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  }

  /**
   * Advance the field by `seconds` in stable sub-steps, never a clamp, so 30fps frames and the
   * motion-speed preference run the flow at true rate.
   */
  step(seconds: number) {
    let remaining = Math.min(Math.max(seconds, 0), 0.2);
    /* Once per frame over the whole delta, not per substep: in-loop sampling would read
       movement only in the first 16ms and close the deposit gate for every later substep. */
    this.sampleVelocity(remaining);
    while (remaining > 1e-6) {
      const dt = Math.min(remaining, MAX_STEP);
      remaining -= dt;
      this.advance(dt);
    }
    this.encode();
  }

  private advance(dt: number) {
    const cfg = TRAIL_DEFAULTS;

    const velKeep = 1 - dt / cfg.velocityDecay;
    const densityKeep = 1 - dt / cfg.densityDecay;
    const carry = cfg.momentum * 50 * dt;

    const { vel, velNext, density, densityNext } = this;

    for (let i = 0; i < CELLS * 2; i += 1) velNext[i] = vel[i] * velKeep;

    /* Advection: trace each cell back along its own velocity and pick up what was there. */
    for (let row = 0; row < N; row += 1) {
      for (let col = 0; col < N; col += 1) {
        const cell = row * N + col;
        const vi = cell * 2;
        if (Math.abs(vel[vi]) < 0.001 && Math.abs(vel[vi + 1]) < 0.001) {
          densityNext[cell] = density[cell] * densityKeep;
          continue;
        }
        const sx = col - vel[vi] * carry;
        const sy = row - vel[vi + 1] * carry;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= N || y0 + 1 >= N) {
          densityNext[cell] = density[cell] * densityKeep;
          continue;
        }
        const fx = sx - x0;
        const fy = sy - y0;
        const a = density[y0 * N + x0];
        const b = density[y0 * N + x0 + 1];
        const c = density[(y0 + 1) * N + x0];
        const d = density[(y0 + 1) * N + x0 + 1];
        densityNext[cell] =
          (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy) *
          densityKeep;
      }
    }

    this.deposit(velNext, densityNext, dt);

    this.vel = velNext;
    this.velNext = vel;
    this.density = densityNext;
    this.densityNext = density;
  }

  /**
   * The pointer's velocity for this step, low-passed. `rawVx/rawVy` gate the deposit (no
   * movement since the last step contributes nothing); `smoothVx/smoothVy` shape and colour
   * the blob. See `TRAIL_VELOCITY_TAU` for why the filter is a time constant.
   */
  private sampleVelocity(dt: number) {
    if (!this.seen || dt <= 0) {
      this.rawVx = 0;
      this.rawVy = 0;
      return;
    }
    this.rawVx = (this.pointerX - this.lastX) / dt;
    this.rawVy = (this.pointerY - this.lastY) / dt;
    this.lastX = this.pointerX;
    this.lastY = this.pointerY;
    const k = 1 - Math.exp(-dt / TRAIL_VELOCITY_TAU);
    this.smoothVx += (this.rawVx - this.smoothVx) * k;
    this.smoothVy += (this.rawVy - this.smoothVy) * k;
  }

  private deposit(vel: Float32Array, density: Float32Array, dt: number) {
    const cfg = TRAIL_DEFAULTS;
    const speed = Math.hypot(this.smoothVx, this.smoothVy);

    /* The pointer is the only source, gated on the *instantaneous* reading: a parked cursor stops laying ink. */
    if (this.seen && Math.abs(this.rawVx) + Math.abs(this.rawVy) > 0.01) {
      /* Radius on the square of speed, amplitude on speed — flicks lay wide strong trails, slow drags thin faint ones. */
      const radius = cfg.radius * 0.05 * Math.min(speed * speed * 20, 1);
      const gain = Math.min(speed * 10, 1);
      const reach = radius * 2;

      /* One axis is scaled so falloff is in screen proportions (blob stays round); the grid-space search box undoes it. */
      const sx = this.aspect >= 1 ? this.aspect : 1;
      const sy = this.aspect >= 1 ? 1 : 1 / this.aspect;

      if (radius > 0) {
        const c0 = Math.max(0, Math.floor((this.pointerX - reach / sx) * N));
        const c1 = Math.min(N - 1, Math.ceil((this.pointerX + reach / sx) * N));
        const r0 = Math.max(0, Math.floor((this.pointerY - reach / sy) * N));
        const r1 = Math.min(N - 1, Math.ceil((this.pointerY + reach / sy) * N));

        for (let row = r0; row <= r1; row += 1) {
          for (let col = c0; col <= c1; col += 1) {
            const dx = ((col + 0.5) / N - this.pointerX) * sx;
            const dy = ((row + 0.5) / N - this.pointerY) * sy;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach * reach) continue;
            const falloff = Math.exp(-d2 / (radius * radius));
            const cell = row * N + col;
            const add = falloff * cfg.intensity * 100 * dt * 0.01;
            vel[cell * 2] += this.smoothVx * add;
            vel[cell * 2 + 1] += this.smoothVy * add;
            density[cell] += add * gain;
          }
        }
      }
    }

    for (let i = 0; i < CELLS; i += 1) {
      vel[i * 2] = clamp(vel[i * 2], -1, 1);
      vel[i * 2 + 1] = clamp(vel[i * 2 + 1], -1, 1);
      density[i] = clamp(density[i], 0, 1);
    }
  }

  /**
   * Pack the fields for upload. Velocity goes in **unnormalised**: the shader fades toward
   * the neutral base by the flow's magnitude, so normalising would leave it nothing to fade
   * on, and a still cell would decode to an arbitrary 45-degree direction instead of zero.
   */
  private encode() {
    const { vel, density, pixels } = this;
    for (let i = 0; i < CELLS; i += 1) {
      pixels[i * 4] = Math.round(clamp(vel[i * 2] * 127.5 + 127.5, 0, 255));
      pixels[i * 4 + 1] = Math.round(clamp(vel[i * 2 + 1] * 127.5 + 127.5, 0, 255));
      pixels[i * 4 + 2] = Math.round(clamp(density[i] * 255, 0, 255));
      pixels[i * 4 + 3] = 255;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
