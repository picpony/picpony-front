'use client';

import { useEffect, useState } from 'react';

import type { CustomPaletteInstall, CustomTones } from '@/lib/appearance';
import { parseCustomSpec, type CustomSpec } from '@/lib/paletteSpec';
import type { ImageRecommendation } from '@/lib/imageRecommendations';

/**
 * The palette recipe, behind a dynamic import — the same seam as `lib/motionLazy.tsx`, so HCT
 * (`Hct`, `TonalPalette`, the gamut solver, ~7 KB brotli) never lands in any route's first document.
 * Only /settings needs to run it: the built-ins are CSS the generator wrote, the custom one is CSS
 * `app/layout.tsx` renders from the cookie seed, so the browser re-derives only on a seed change.
 * Nothing here awaits inside an event handler that owns a gesture — both doors are dialogs the
 * user has been sitting in — and `warmPalette()` runs from /settings' mount.
 */

type PaletteRule = typeof import('@/lib/paletteRule');

let rule: PaletteRule | null = null;
let loading: Promise<PaletteRule> | null = null;

function load(): Promise<PaletteRule> {
  if (loading) return loading;
  loading = import('@/lib/paletteRule').then((loaded) => {
    rule = loaded;
    return loaded;
  });
  return loading;
}

/** Pull the recipe in when a screen that can change the seed mounts. Idempotent. */
export function warmPalette(): void {
  void load();
}

/** The recipe as a dialog holds it: non-null means every `Hct` call below is synchronous. */
export type PaletteTools = PaletteRule;

/**
 * The HCT primitives themselves, for the two palette dialogs — null until the chunk lands.
 * `components/ColorPicker.tsx` builds its hue rail and tone×chroma grid from real `Hct.from()`
 * colours rather than a CSS gradient: sRGB's gamut in HCT is an irregular solid, and a gradient
 * painted across it hands back values the browser has already clipped. Shared by both dialogs;
 * `active` skips fetching for a dialog never opened, and `warmPalette()` normally has the chunk
 * resident first, so no placeholder paints. The sync read and the awaitable loader are deliberately
 * not exported separately — pairing them is the two-step this hook exists to own.
 */
export function usePaletteTools(active: boolean): PaletteTools | null {
  const [tools, setTools] = useState(() => rule);
  useEffect(() => {
    if (!active || tools) return;
    let live = true;
    void load().then((loaded) => {
      if (live) setTools(loaded);
    });
    return () => {
      live = false;
    };
  }, [active, tools]);
  return tools;
}

/**
 * The pixel budget a candidate image is reduced to before quantising: AOSP's own, an **area** not
 * a longest edge, because that makes the reduction aspect-independent — `WallpaperColors.java`
 * caps `MAX_WALLPAPER_EXTRACTION_AREA` at 112 × 112 px and rescales by `sqrt(cap / area)` ("we'll
 * mainly match bitmap sizes using the area instead. This way our comparisons are aspect ratio
 * independent"); a fixed edge kept 31% more pixels than AOSP on a square and 40% fewer on a tall
 * screenshot. `QuantizerCelebi` is linear in pixels and a phone photo is twelve million of them —
 * a thumbnail carries the same colour *distribution*, the only thing measured.
 */
const SAMPLE_AREA = 112 * 112;

/**
 * An image recommendation ready to install: the displayed seed is `primary`, with one
 * image-derived companion hue or null for automatic. Direction A adapts the recommendation
 * before display; confirmation and the manual/saved-colour path never transform it again.
 */
export interface ImageOption {
  seed: string;
  accent: number | null;
  tones: CustomTones;
}

/**
 * Direction A's area-ranked recommendations, with the existing theme derivation and tile.
 * Recommendation work loads only when reading an image. A file the browser cannot decode
 * throws ImageDecodeError; an all-transparent image legitimately offers no colours.
 */
export async function imageOptions(file: File): Promise<ImageOption[]> {
  const recipe = rule ?? (await load());
  const recommendations = await extractFromImage(file, MAX_OPTIONS);
  return recommendations.map(({ seed, accent }) => ({
    seed,
    accent,
    tones: recipe.paletteTones(recipe.deriveCustomTheme({ seed, accent })),
  }));
}

/** Area-ranked families first, then supported light/deep alternatives, at most eight. */
const MAX_OPTIONS = 8;

/**
 * The file is not a picture this browser can read — told apart from a picture with no usable
 * colour in it, which is an answer rather than a failure. It was reported as the latter: a
 * text file came back as 「这张图里没有能撑起主题的颜色」.
 */
export class ImageDecodeError extends Error {
  constructor(cause?: unknown) {
    super('无法读取此图片', { cause });
    this.name = 'ImageDecodeError';
  }
}

/** A picture's natural size, from its header: an `<img>` learns it without decoding the pixels. */
function naturalSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new ImageDecodeError());
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageDecodeError());
    };
    image.src = url;
  });
}

/**
 * The picture, decoded straight to the sampling size rather than at full resolution first — a
 * phone photo is twelve million pixels, and the full-size bitmap was held only to be drawn into
 * a canvas of twelve thousand. The size comes from AOSP's area rule (`SAMPLE_AREA`), so the
 * header is read first; an engine that refuses the resize options still decodes it whole.
 */
async function decodeForSampling(file: File): Promise<ImageBitmap> {
  const { width, height } = await naturalSize(file);
  /* AOSP's own rescale: `sqrt(cap / area)`, so the result is aspect-independent. */
  const area = width * height;
  const scale = area > SAMPLE_AREA ? Math.sqrt(SAMPLE_AREA / area) : 1;
  const resizeWidth = Math.max(1, Math.round(width * scale));
  const resizeHeight = Math.max(1, Math.round(height * scale));
  try {
    return await createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      throw new ImageDecodeError(error);
    }
  }
}

/**
 * Samples the image for direction A's pure recommendation helper. Returns no recommendations
 * when there are no opaque pixels; grayscale inputs retain their actual tones.
 * **The reduction is smoothed, a stated divergence**: AOSP passes `filter = false` (nearest
 * neighbour) to `createScaledBitmap`, and at a 30× reduction that samples one pixel in nine hundred,
 * so a small saturated subject can vanish, meet `Score`'s 1% cutoff and produce the fallback. The
 * measured thing is the colour *distribution*, so an area average is the honest reducer, requested
 * via `resizeQuality: 'high'` on the decode (and `imageSmoothingQuality: 'high'` on the fallback);
 * Chrome's filter choice is non-contractual, hence the guard.
 */
async function extractFromImage(file: File, desired = MAX_OPTIONS): Promise<ImageRecommendation[]> {
  const { recommendImageColors } = await import('./imageRecommendations');
  const bitmap = await decodeForSampling(file);
  try {
    /* Normally already at the sampling size; the fallback decode is whole and is reduced here. */
    const area = bitmap.width * bitmap.height;
    const scale = area > SAMPLE_AREA ? Math.sqrt(SAMPLE_AREA / area) : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, w, h);
    return recommendImageColors(context.getImageData(0, 0, w, h).data, desired);
  } finally {
    bitmap.close();
  }
}

/**
 * Derive the eleventh palette from its spec — a hex the user named or one lifted out of an image,
 * and its 副色相 — or from a stored spec string (a bare seed reads as 自动). Returns null only for
 * something that is not a spec. A near-grey is *not* rejected: `rampChroma` tapers its chroma
 * floor to zero as a fill runs out of hue, so `#808080` lands on a near-monochrome scheme, not a
 * grey bar over a randomly-hued ramp — a grey theme is legitimate, and 自动 gives it grey accents.
 * The built-ins are held to chroma 15 by ASSERTION 4 because a colour guide can insist on a hue.
 * The hex **is** `primary` in the light scheme, as a built-in's fill is — one rule, no exceptions;
 * there is no second hex, so `deriveTheme` takes the dark fill seven tones down against the
 * dark-page floor.
 */
export async function resolveCustomPalette(value: CustomSpec | string): Promise<CustomPaletteInstall | null> {
  const recipe = rule ?? (await load());
  const spec = typeof value === 'string' ? parseCustomSpec(value) : value;
  const seed = spec ? recipe.normalizeCustomSeed(spec.seed) : null;
  if (!spec || !seed) return null;
  const derived = recipe.deriveCustomTheme({ seed, accent: spec.accent });
  return {
    seed,
    accent: spec.accent,
    css: recipe.paletteBlocksCss(recipe.CUSTOM_PALETTE, derived),
    tones: recipe.paletteTones(derived),
  };
}
