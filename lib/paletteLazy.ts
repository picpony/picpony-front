'use client';

import { useEffect, useState } from 'react';

import type { CustomPaletteInstall, PaletteTone } from '@/lib/appearance';

/**
 * The palette recipe, behind a dynamic import — the same seam as `lib/motionLazy.tsx`, so HCT
 * (`Hct`, `TonalPalette`, the gamut solver, ~7 KB brotli) never lands in any route's first document.
 * Only /settings needs to run it: the built-ins are CSS the generator wrote, the custom one is CSS
 * `app/layout.tsx` renders from the cookie seed, so the browser re-derives only on a seed change.
 * Nothing here awaits inside an event handler that owns a gesture — both doors are dialogs the
 * user has been sitting in — and `warmPalette()` runs from /settings' mount.
 */

type PaletteRule = typeof import('@/lib/paletteRule');

/** The two hexes a swatch needs, out of one scheme's role map. */
const schemeTone = (scheme: Record<string, string>) => ({
  primary: scheme.primary,
  onPrimary: scheme['on-primary'],
});

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
 * One image-derived option: a seed out of the picture, and the two hexes its chip is drawn from.
 * A seed only — **not** a `(seed, style)` pair: a style puts `primary` at M3's P40/P80 and three
 * of the five rotate the hue, so an orange sunset offered a brown, a grey-brown, a rust, a purple
 * and a grey (see `lib/paletteRule.ts`'s header). The seed *is* `primary`, as with a coat Fill.
 */
export interface ImageOption {
  seed: string;
  tones: { light: PaletteTone; dark: PaletteTone };
}

/**
 * The colours an image offers: Monet's own ranked seeds, each installed verbatim. `MAX_SEEDS` is
 * AOSP's `MAX_SEED_COLORS` (4), also Monet's hard cap in `ColorScheme.getSeedColors` and the
 * library's default `desired`; it caps *seeds* — AOSP's legacy path then crosses each with four
 * styles, the axis this app does not have. **Up to four, possibly fewer**: `Score` sweeps its
 * hue-difference bar from 90° down to 15° and returns the first passing bar's yield, so a
 * one-colour picture gives one option, not four samples of it. Decoding is `createImageBitmap` —
 * off the main thread, takes any format the browser reads.
 */
export async function imageOptions(file: File): Promise<ImageOption[]> {
  const recipe = rule ?? (await load());
  const seeds = await extractFromImage(file, MAX_SEEDS);
  return seeds.map((seed) => {
    const derived = recipe.deriveTheme(seed);
    return {
      seed,
      tones: { light: schemeTone(derived.light), dark: schemeTone(derived.dark) },
    };
  });
}

/** AOSP's `MAX_SEED_COLORS`. */
const MAX_SEEDS = 4;

/**
 * The candidate theme colours in an image, ranked — Monet's own wallpaper extraction. Returns up
 * to `desired` hexes, or an empty array for an image with no opaque pixel; `sourceColorsFromPixels`
 * owns the ranking and the guard that keeps AOSP's Google Blue — a colour not in the picture — out.
 * **The reduction is smoothed, a stated divergence**: AOSP passes `filter = false` (nearest
 * neighbour) to `createScaledBitmap`, and at a 30× reduction that samples one pixel in nine hundred,
 * so a small saturated subject can vanish, meet `Score`'s 1% cutoff and produce the fallback. The
 * measured thing is the colour *distribution*, so an area average is the honest reducer, requested
 * via `imageSmoothingQuality: 'high'`; Chrome's filter choice is non-contractual, hence the guard.
 */
async function extractFromImage(file: File, desired = 4): Promise<string[]> {
  const recipe = rule ?? (await load());
  const bitmap = await createImageBitmap(file);
  try {
    /* AOSP's own rescale: `sqrt(cap / area)`, so the result is aspect-independent. */
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
    return recipe.sourceColorsFromPixels(context.getImageData(0, 0, w, h).data, desired);
  } finally {
    bitmap.close();
  }
}

/**
 * Derive the eleventh palette from a hex — one the user named, or one lifted out of an image.
 * Returns null only for a string that is not a six-digit hex. A near-grey is *not* rejected:
 * `rampChroma` tapers its chroma floor to zero as a fill runs out of hue, so `#808080` lands on a
 * near-monochrome scheme, not a grey bar over a randomly-hued ramp — a grey theme is legitimate.
 * The built-ins are held to chroma 15 by ASSERTION 4 because a colour guide can insist on a hue.
 * The hex **is** `primary` in the light scheme, as with a coat Fill — one rule, no exceptions; the
 * ten get a second hex from the guide and this cannot (a Shadow Fill), so `deriveTheme` falls back
 * to seven tones down against the dark-page floor.
 */
export async function resolveCustomPalette(seed: string): Promise<CustomPaletteInstall | null> {
  const recipe = rule ?? (await load());
  const normalized = recipe.normalizeCustomSeed(seed);
  if (!normalized) return null;
  const derived = recipe.deriveTheme(normalized);
  return {
    seed: normalized,
    css: recipe.paletteBlocksCss(recipe.CUSTOM_PALETTE, derived),
    tones: { light: schemeTone(derived.light), dark: schemeTone(derived.dark) },
  };
}
