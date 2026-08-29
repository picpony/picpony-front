import { TRAIL_DEFAULTS, TRAIL_SIZE, TRAIL_VELOCITY_TAU } from '@/lib/flutedGlass';

/**
 * The cursor's ink: a velocity field and a density field, advected and decayed on the CPU.
 *
 * This is the reference's own `ChromaFlow` sim, and it is deliberately not a GPU ping-pong
 * pass. That page runs it as a JS loop over a 128x128 grid, and at 16k cells with a handful
 * of operations each it costs well under a millisecond — far less than the two extra
 * framebuffers, the extra program and the extra state a ping-pong would need for a
 * decorative band. The output is one 128x128 RGBA texture uploaded per frame: 64KB, which
 * is nothing beside the fragment work already being done.
 *
 * The two details that carry the feel are both the reference's, and neither is obvious:
 * the deposited blob's radius scales with the **square** of cursor speed while its
 * amplitude scales with speed, so a flick lays a wide strong trail and a slow drag lays a
 * thin faint one; and density is **advected along the velocity field** rather than merely
 * fading, which is what makes a trail curl instead of just dimming.
 *
 * Three things here are the reference's mechanism restated rather than copied, and each
 * fixes something the first port got wrong:
 *
 * - **Velocity is measured per frame, in `step`, not per pointer event.** The reference
 *   computes it in its render callback from a persistent pointer position, so a pointer that
 *   has stopped reports zero and stops depositing. Measuring it inside `move` instead means
 *   a parked cursor keeps its last reading for ever and pours ink until the blob saturates,
 *   and it makes the filter's time constant a function of the mouse's polling rate.
 * - **The blob is round on screen.** The reference scales the longer axis by the aspect
 *   ratio before taking the distance; without that, a circle in this unit-square field is an
 *   ellipse as wide as the plate's aspect — 4.4:1 on the /about band.
 * - **`dt` is stepped, not clamped.** The reference clamps to 16ms and runs at 60fps, so its
 *   clamp is a guard. Clamping while rendering at 30 makes the whole simulation run at 48%
 *   of real time and swallows the motion-speed preference entirely.
 *
 * Nothing here touches the DOM, so `scripts/probeFlutedGlass.mjs` drives the same class.
 */

const N = TRAIL_SIZE;
const CELLS = N * N;

/** The largest step the advection stays stable at. The reference's own figure. */
const MAX_STEP = 0.016;

/** Sampled by the shader as rg = velocity (0.5-centred), b = density. */
export class FlutedGlassTrail {
  /** Velocity, two channels per cell. */
  private vel = new Float32Array(CELLS * 2);
  private velNext = new Float32Array(CELLS * 2);
  /** Density, one channel per cell. */
  private density = new Float32Array(CELLS);
  private densityNext = new Float32Array(CELLS);
  /** What gets uploaded. */
  readonly pixels = new Uint8Array(CELLS * 4);

  constructor() {
    /* So the first upload is a defined neutral rather than all-zero, which decodes to a
       velocity of (-1, -1) — a direction nothing is flowing in. Density is zero either way,
       so the shader ignores it, but a texture that means something is cheaper to reason
       about than one that happens not to matter. */
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

  /** Pointer position in 0..1 of the plate, top-left origin. Records only; see the note. */
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
    /* Velocity as well as the flag: without this, re-entering resumes with the direction the
       pointer had when it left, so the ink comes back in the wrong colour. */
    this.rawVx = 0;
    this.rawVy = 0;
    this.smoothVx = 0;
    this.smoothVy = 0;
  }

  /** Plate aspect ratio, so the blob is a circle on screen. */
  setAspect(aspect: number) {
    this.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  }

  /**
   * Advance the field by `seconds`, in steps the advection is stable at.
   *
   * Stepping rather than clamping is what lets the motion-speed preference reach the ink and
   * what stops a 30fps frame from running the flow at half speed. The total is bounded
   * because a backgrounded tab must not advect the whole field across the plate at once.
   */
  step(seconds: number) {
    let remaining = Math.min(Math.max(seconds, 0), 0.2);
    /* Once per frame, over the frame's whole delta — not once per substep, or a slow frame
       would report the pointer as having moved during the first 16ms and stopped for the
       rest of it, and the deposit gate would close for every substep after the first. */
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
   * The pointer's velocity for this step, and its low-pass.
   *
   * `rawVx/rawVy` are what gates the deposit, so a pointer that has not moved since the last
   * step contributes nothing; `smoothVx/smoothVy` are what shapes and colours the blob. See
   * `TRAIL_VELOCITY_TAU` for why the filter is a time constant rather than a fixed weight.
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

    /* The pointer is the only source. Gated on the *instantaneous* reading — the reference's
       own test, and what makes a parked cursor stop laying ink down rather than saturating a
       blob under it. */
    if (this.seen && Math.abs(this.rawVx) + Math.abs(this.rawVy) > 0.01) {
      /* Radius on the square of speed, amplitude on speed. Both the reference's. */
      const radius = cfg.radius * 0.05 * Math.min(speed * speed * 20, 1);
      const gain = Math.min(speed * 10, 1);
      const reach = radius * 2;

      /* One axis is scaled so the falloff is measured in screen proportions rather than in
         grid cells — the reference's own correction, and what keeps the blob round. The
         search box is in grid space, so it has to undo that scaling again. */
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
   * Pack the fields for upload.
   *
   * The velocity goes in **unnormalised**, which is the reference's own choice and matters
   * twice: the shader fades toward the neutral base by the flow's magnitude, so normalising
   * here would leave it nothing to fade on; and a still cell then encodes to the midpoint
   * and decodes to a magnitude of zero, where a normalised zero vector came back as an
   * arbitrary 45-degree direction and painted a colour nothing had asked for.
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
