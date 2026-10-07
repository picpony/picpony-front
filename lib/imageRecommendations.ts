import { hexFromArgb, Hct } from '@material/material-color-utilities';

import { clearColorAt, type ClearColorRegister } from './clearColor';
import { isGuardedHue, norm180, wrapHue } from './paletteRule';
import { quantizeCelebi } from './quantize';
import { clamp } from './utils';

/** A displayed recommendation is installed exactly; this never processes stored/manual colours. */
export interface ImageRecommendation {
  seed: string;
  /** One image-derived companion hue, or null for the existing automatic rule. */
  accent: number | null;
}

interface Cluster {
  argb: number;
  population: number;
  hue: number;
  tone: number;
  chroma: number;
}

interface HueFamily {
  anchor: number;
  population: number;
  members: Cluster[];
  hue: number;
  tone: number;
  chroma: number;
  pictureShare: number;
  darkShare: number;
}

/** Matches the approved study's reproducible HCT precision before family aggregation. */
const measured = (value: number) => Number(value.toFixed(3));
const READABLE_CHROMA = 8;
const MAX_OPTIONS = 8;
const isCool = (hue: number) => hue >= 165 && hue < 325;

function familiesOf(clusters: readonly Cluster[], total: number): HueFamily[] {
  const families: HueFamily[] = [];
  for (const cluster of clusters) {
    if (cluster.chroma < READABLE_CHROMA) continue;
    // Fixed anchors avoid a chain of neighbours swallowing a distant hue.
    let family = families.find((f) => Math.abs(norm180(f.anchor - cluster.hue)) < 22);
    if (!family) {
      family = { anchor: cluster.hue, members: [], population: 0, hue: 0, tone: 0, chroma: 0, pictureShare: 0, darkShare: 0 };
      families.push(family);
    }
    family.members.push(cluster);
    family.population += cluster.population;
  }
  for (const family of families) {
    let x = 0;
    let y = 0;
    let tone = 0;
    let chroma = 0;
    let dark = 0;
    for (const c of family.members) {
      x += Math.cos(c.hue * Math.PI / 180) * c.population;
      y += Math.sin(c.hue * Math.PI / 180) * c.population;
      tone += c.tone * c.population;
      chroma += c.chroma * c.population;
      if (c.tone < 50) dark += c.population;
    }
    family.hue = measured(wrapHue(Math.atan2(y, x) * 180 / Math.PI));
    family.tone = measured(tone / family.population);
    family.chroma = measured(chroma / family.population);
    family.pictureShare = measured(family.population / total);
    family.darkShare = measured(dark / family.population);
  }
  return families.sort((a, b) => b.population - a.population || a.hue - b.hue);
}

function companionOf(family: HueFamily, families: readonly HueFamily[]): number | null {
  const eligible = families.filter((other) =>
    other !== family && other.pictureShare >= 0.002 && other.chroma >= READABLE_CHROMA &&
    Math.abs(norm180(other.hue - family.hue)) >= 45 && !isGuardedHue(Math.round(other.hue) % 360),
  );
  if (!eligible.length) return null;
  // Area leads; close populations may prefer the more distinct partner shown in the study.
  const tied = eligible.filter((f) => f.population >= eligible[0].population * 0.9);
  const separation = (f: HueFamily) => Math.abs(Math.abs(norm180(f.hue - family.hue)) - 90);
  tied.sort((a, b) => separation(a) - separation(b) || b.population - a.population);
  return Math.round(tied[0].hue) % 360;
}

function recommendation(family: HueFamily, families: readonly HueFamily[], register?: ClearColorRegister): ImageRecommendation {
  const deep = register ? register === 'deep' : isCool(family.hue) && family.darkShare >= 0.6;
  const yellow = family.hue >= 70 && family.hue < 125;
  const warm = family.hue < 70 || family.hue >= 325;
  const tone = deep ? clamp(family.tone, 34, 42) : clamp(family.tone, yellow ? 86 : 82, yellow ? 92 : warm ? 86 : 88);
  return { seed: clearColorAt(family.hue, tone, deep ? 'deep' : 'light'), accent: companionOf(family, families) };
}

/**
 * Direction A (decision 33): opaque-pixel area ranks readable hue families; their own hues
 * receive clear light/deep fills. A small vivid detail can be a companion, never a chroma
 * bonus over a larger family. Called only after an image is read, behind the palette seam.
 */
export function recommendImageColors(pixels: Uint8ClampedArray, desired = MAX_OPTIONS): ImageRecommendation[] {
  const count = Number.isFinite(desired) ? clamp(Math.trunc(desired), 0, MAX_OPTIONS) : MAX_OPTIONS;
  if (!count) return [];
  const opaque: number[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] !== 255) continue;
    opaque.push((255 << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  if (!opaque.length) return [];
  const clusters = [...quantizeCelebi(opaque, 128)].map(([argb, population]): Cluster => {
    const hct = Hct.fromInt(argb);
    return { argb, population, hue: measured(hct.hue), tone: measured(hct.tone), chroma: measured(hct.chroma) };
  }).sort((a, b) => b.population - a.population || a.argb - b.argb);
  const families = familiesOf(clusters, opaque.length);
  const options: ImageRecommendation[] = [];
  const add = (option: ImageRecommendation) => {
    if (options.length < count && !options.some((o) => o.seed === option.seed)) options.push(option);
  };
  if (!families.length) {
    // No reliable hue: retain actual image tones instead of inventing a colourful fallback.
    const tones: number[] = [];
    for (const c of clusters) {
      if (tones.some((tone) => Math.abs(tone - c.tone) < 12)) continue;
      add({ seed: hexFromArgb(c.argb).toLowerCase(), accent: null });
      tones.push(c.tone);
      if (options.length === count) break;
    }
    return options;
  }
  for (const family of families) {
    add(recommendation(family, families));
    if (options.length === count) break;
  }
  // Give each area-ranked family a place before an alternative of an already offered hue.
  for (const family of families) {
    if (options.length === count) break;
    if (isCool(family.hue) && family.darkShare >= 0.6 && family.pictureShare >= 0.08) {
      add(recommendation(family, families, 'light'));
    }
  }
  return options;
}
