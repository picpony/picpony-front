/**
 * @license
 * Adapted from material-color-utilities' `QuantizerCelebi` / `QuantizerWsmeans`
 * (Copyright 2021 Google LLC), licensed under the Apache License, Version 2.0:
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { QuantizerWu, argbFromLab, labFromArgb } from '@material/material-color-utilities';

/**
 * `QuantizerCelebi`, deterministic: Wu's clusters refined by weighted k-means, with seeded
 * starts and conserved populations when final centres round to the same RGB.
 *
 * **The library's TypeScript port starts every pixel in a random cluster** (`Math.random`), and
 * its first pass prunes each search by the distance from that start, so which clusters converge
 * — and so the colours 从图片取色 offered — changed from one read of the same picture to the next.
 * AOSP's Java quantizer seeds its generator (`new Random(0x42688)`), so Android gives one answer
 * per picture; this draws the same starts from Java's own generator with the same seed.
 *
 * The refinement arithmetic stays unchanged: ten iterations at most, a point moves only past 3
 * units of ΔE, and a cluster is skipped when it is four times farther from the point's current
 * one than the point is (the triangle-inequality rule). The port's row sort is left out: it
 * compares objects as strings, so it never reordered anything, and each row stays indexed by
 * cluster.
 */
export function quantizeCelebi(pixels: number[], maxColors: number): Map<number, number> {
  const starting = new QuantizerWu().quantize(pixels, maxColors);
  return quantizeWsmeans(pixels, starting, maxColors);
}

const MAX_ITERATIONS = 10;
const MIN_MOVEMENT_DISTANCE = 3.0;
/** AOSP's seed (`QuantizerWsmeans.java`). */
const SEED = 0x42688;

/* The generator's constants. Built with `BigInt()` rather than written as literals, which the
   project's compile target does not allow. */
const MULTIPLIER = BigInt(0x5deece66d);
const ADDEND = BigInt(0xb);
const MASK = (BigInt(1) << BigInt(48)) - BigInt(1);
const THIRTY_ONE = BigInt(31);

/** `java.util.Random` — its 48-bit linear congruential generator and its `nextInt(bound)`. */
export function javaRandom(seed: number) {
  let state = (BigInt(seed) ^ MULTIPLIER) & MASK;
  const next = (bits: number) => {
    state = (state * MULTIPLIER + ADDEND) & MASK;
    return Number(BigInt.asIntN(32, state >> BigInt(48 - bits)));
  };
  return {
    nextInt(bound: number): number {
      if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(next(31))) >> THIRTY_ONE);
      let bits: number;
      let value: number;
      /* Java rejects a draw whose `bits - value + (bound - 1)` overflows an int. */
      do {
        bits = next(31);
        value = bits % bound;
      } while (bits - value + (bound - 1) > 0x7fffffff);
      return value;
    },
  };
}

const distance = (from: number[], to: number[]) => {
  const dL = from[0] - to[0];
  const dA = from[1] - to[1];
  const dB = from[2] - to[2];
  return dL * dL + dA * dA + dB * dB;
};

function quantizeWsmeans(inputPixels: number[], startingClusters: number[], maxColors: number) {
  const pixelToCount = new Map<number, number>();
  const points: number[][] = [];
  const pixels: number[] = [];
  for (const pixel of inputPixels) {
    const count = pixelToCount.get(pixel);
    if (count === undefined) {
      points.push(labFromArgb(pixel));
      pixels.push(pixel);
      pixelToCount.set(pixel, 1);
    } else {
      pixelToCount.set(pixel, count + 1);
    }
  }
  const pointCount = points.length;
  const counts = pixels.map((pixel) => pixelToCount.get(pixel) ?? 0);

  const clusterCount = Math.min(maxColors, pointCount, startingClusters.length);
  if (clusterCount === 0) return new Map<number, number>();
  const clusters = startingClusters.slice(0, clusterCount).map((argb) => labFromArgb(argb));

  const random = javaRandom(SEED);
  const clusterIndices = Array.from({ length: pointCount }, () => random.nextInt(clusterCount));
  /* Distance between every pair of clusters, indexed by cluster; a cluster's own entry stays -1,
     so the pruning below never skips it. */
  const between = Array.from({ length: clusterCount }, () => new Array<number>(clusterCount).fill(-1));
  const pixelCountSums = new Array<number>(clusterCount).fill(0);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    for (let i = 0; i < clusterCount; i++) {
      for (let j = i + 1; j < clusterCount; j++) {
        const d = distance(clusters[i], clusters[j]);
        between[i][j] = d;
        between[j][i] = d;
      }
    }

    let pointsMoved = 0;
    for (let i = 0; i < pointCount; i++) {
      const point = points[i];
      const previousClusterIndex = clusterIndices[i];
      const previousDistance = distance(point, clusters[previousClusterIndex]);
      let minimumDistance = previousDistance;
      let newClusterIndex = -1;
      for (let j = 0; j < clusterCount; j++) {
        if (between[previousClusterIndex][j] >= 4 * previousDistance) continue;
        const d = distance(point, clusters[j]);
        if (d < minimumDistance) {
          minimumDistance = d;
          newClusterIndex = j;
        }
      }
      if (newClusterIndex !== -1 &&
        Math.abs(Math.sqrt(minimumDistance) - Math.sqrt(previousDistance)) > MIN_MOVEMENT_DISTANCE) {
        pointsMoved++;
        clusterIndices[i] = newClusterIndex;
      }
    }
    if (pointsMoved === 0 && iteration !== 0) break;

    const sumA = new Array<number>(clusterCount).fill(0);
    const sumB = new Array<number>(clusterCount).fill(0);
    const sumC = new Array<number>(clusterCount).fill(0);
    pixelCountSums.fill(0);
    for (let i = 0; i < pointCount; i++) {
      const cluster = clusterIndices[i];
      const point = points[i];
      const count = counts[i];
      pixelCountSums[cluster] += count;
      sumA[cluster] += point[0] * count;
      sumB[cluster] += point[1] * count;
      sumC[cluster] += point[2] * count;
    }
    for (let i = 0; i < clusterCount; i++) {
      const count = pixelCountSums[i];
      clusters[i] = count === 0 ? [0, 0, 0] : [sumA[i] / count, sumB[i] / count, sumC[i] / count];
    }
  }

  const argbToPopulation = new Map<number, number>();
  for (let i = 0; i < clusterCount; i++) {
    const count = pixelCountSums[i];
    if (count === 0) continue;
    const argb = argbFromLab(clusters[i][0], clusters[i][1], clusters[i][2]);
    // Different Lab centres can round to the same RGB. Keep both populations, with
    // the original centres and assignments intact, so every sampled pixel is counted.
    argbToPopulation.set(argb, (argbToPopulation.get(argb) ?? 0) + count);
  }
  return argbToPopulation;
}
