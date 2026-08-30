'use client';

import { useEffect, useState } from 'react';

import type { CustomPaletteInstall, PaletteTone } from '@/lib/appearance';

/**
 * The palette recipe, behind a dynamic import.
 *
 * `lib/paletteRule.ts` pulls HCT — `Hct`, `TonalPalette` and the gamut solver come to
 * roughly 7 KB brotli — and exactly one screen ever needs to run it: /settings, when the
 * user picks a colour for the eleventh palette. Every other consumer of a palette reads a
 * hex that was resolved elsewhere. The ten built-in themes are CSS the generator wrote; the
 * custom one is CSS `app/layout.tsx` rendered from the seed in the cookie, server-side and
 * in the first byte. So the browser only re-derives when the seed actually changes.
 *
 * This is the same seam as `lib/motionLazy.tsx` and it keeps the same rule: **nothing here
 * awaits inside an event handler that owns a gesture.** It is easier to keep here than there,
 * because both doors into it are a dialog the user has been sitting in for a second or more —
 * a cell in the picker's grid, or a file dropped on the image control. `warmPalette()` runs
 * from /settings' own mount, so in practice the chunk is resident before either opens.
 */

type PaletteRule = typeof import('@/lib/paletteRule');

/**
 * The two hexes a swatch needs, out of one scheme's role map.
 */
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
 *
 * `components/ColorPicker.tsx` builds its hue rail and its tone×chroma grid out of real
 * `Hct.from()` colours rather than a CSS gradient, so every cell it offers is a colour that
 * exists — sRGB's gamut in HCT is an irregular solid, and a gradient painted across it hands
 * back values the browser has already clipped. That needs the module, not just its results.
 *
 * Shared by both dialogs so the cold path has one shape. `active` is the dialog's `isOpen`:
 * there is no point fetching for a dialog that has never been opened, and /settings' own
 * `warmPalette()` means the chunk has normally landed long before either is — so in practice
 * the first render already has it and neither placeholder paints.
 *
 * The two halves — a synchronous "is it here yet" read and an awaitable loader — are
 * deliberately *not* exported on their own. They were, and nothing outside this function ever
 * called either: a bare synchronous read is one a call site has to pair with a loader itself,
 * which is exactly the two-step this hook exists to stop being written twice.
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
 * The pixel budget a candidate image is reduced to before quantising: AOSP's own, an **area**.
 *
 * `QuantizerCelebi` is linear in pixels and a phone photo is twelve million of them, which
 * would block the main thread for seconds. A thumbnail carries the same colour *distribution*,
 * which is the only thing being measured.
 *
 * It was a 128px longest **edge**, and that is not what AOSP does — the mechanism matters
 * because it is aspect-dependent. `WallpaperColors.java` caps
 * `MAX_WALLPAPER_EXTRACTION_AREA = MAX_BITMAP_SIZE * MAX_BITMAP_SIZE` at 112 × 112 = 12 544 px
 * and rescales by `sqrt(cap / area)`, with a comment saying why: "we'll mainly match bitmap
 * sizes using the area instead. This way our comparisons are aspect ratio independent." A fixed
 * edge kept 31% *more* pixels than AOSP on a square and 40% *fewer* on a tall screenshot — 112
 * as a raw edge appears in AOSP exactly once, as the fallback for a drawable with no intrinsic
 * size.
 */
const SAMPLE_AREA = 112 * 112;

/**
 * One image-derived option: a seed out of the picture, and the two hexes its chip is drawn
 * from.
 *
 * A seed and nothing else — **not** a `(seed, style)` pair, which is what an AOSP wallpaper
 * option is and what this offered for one pass. See the header of `lib/paletteRule.ts` for
 * the measurement that took the style axis out; the short version is that a style puts
 * `primary` at M3's P40/P80 and three of the five rotate the hue, so an orange sunset
 * offered a brown, a grey-brown, a rust, a purple and a grey. Here the seed *is* `primary`,
 * exactly as a character's coat Fill is, so an option is a colour that is in the picture.
 */
export interface ImageOption {
  seed: string;
  tones: { light: PaletteTone; dark: PaletteTone };
}

/**
 * The colours an image offers: Monet's own ranked seeds, each installed verbatim.
 *
 * `MAX_SEEDS` is AOSP's `MAX_SEED_COLORS` (`ColorProvider.kt`: `private const val
 * MAX_SEED_COLORS = 4`), which is also Monet's own hard cap in `ColorScheme.getSeedColors` and
 * the library's default `desired`. Note it caps *seeds* — AOSP's legacy path then crosses each
 * with four styles to make its chips, which is the axis this app does not have.
 *
 * **Up to four, and possibly fewer.** `Score` sweeps its hue-difference bar from 90° down to
 * 15° and returns whatever the first passing bar yields, so a picture of one colour gives one
 * option rather than four samples of it. The row renders what it gets.
 *
 * Decoding is `createImageBitmap`, which is off the main thread and takes any format the
 * browser reads, where an `<img>` plus `onload` is two more states to carry.
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
 * The candidate theme colours in an image, ranked — Monet's own wallpaper extraction.
 *
 * Returns up to `desired` hexes, or an empty array for an image with no opaque pixel in it.
 * `sourceColorsFromPixels` owns the ranking and the guard that keeps AOSP's Google Blue — a
 * colour that is not in the picture — from ever being installed.
 *
 * **The reduction is smoothed, which is a stated divergence.** AOSP passes `filter = false` to
 * `createScaledBitmap`, i.e. nearest neighbour, and at a 30× reduction that samples one pixel in
 * nine hundred: a small saturated subject can disappear entirely, which then meets `Score`'s 1%
 * proportion cutoff and produces the fallback. What is being measured is the colour
 * *distribution*, so an area average is the honest reducer for it, and
 * `imageSmoothingQuality: 'high'` is the request for one. Chrome's choice of filter is still not
 * contractual, which is why `sourceColorsFromPixels` guards the outcome rather than trusting it.
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
 *
 * Returns null only for a string that is not a six-digit hex. A near-grey is *not* rejected:
 * `rampChroma` tapers its chroma floor to zero as a fill runs out of hue, so `#808080` lands
 * on a near-monochrome scheme rather than on a grey bar over a randomly-hued ramp, and a
 * person who wants a grey theme is not making a mistake. The ten built-ins are held to
 * chroma 15 by ASSERTION 4 because a colour guide can afford to insist on a hue.
 *
 * The hex **is** `primary` in the light scheme, exactly as a character's coat Fill is —
 * there is one rule here and nothing is an exception to it. What the ten get from the guide
 * and this one cannot is a second hex: a character's Shadow Fill answers "the same colour,
 * one step deeper", and with no artist to ask, `deriveTheme` falls back to seven tones down
 * against the dark-page floor.
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
