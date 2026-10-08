/**
 * A picture's name, for an `alt`, a card link's `aria-label` or a spoiler cover — made of the
 * tags the row already carries, never of `name`.
 *
 * Derpibooru's `name` is the uploader's original **file name** (`GOAwF74aMAAC6KH.jpg?name=orig`,
 * `Picsart_26-09-25_09-52-36-067.jpg`), so a grid read aloud was fifty random file names, and the
 * same string surfaced as the failure plate. The tags describe the picture: who is in it, what
 * happens, who drew it.
 *
 * Plain module (no `'use client'`): the server renders the same names the client hydrates.
 */
import type { ImagePreview } from '@/lib/types/image';

/**
 * Tags that say nothing about what is *in* the picture: the rating, the generation, bookkeeping
 * about the file and its background, and the sex/count tags nearly every row carries. Kept short
 * on purpose — a missed noise tag costs a word, a wrongly listed content tag costs meaning.
 */
const NOISE = new Set([
  'safe', 'suggestive', 'questionable', 'explicit', 'semi-grimdark', 'grimdark', 'grotesque',
  'g1', 'g2', 'g3', 'g4', 'g5', 'g4.5', 'g3.5', 'pony life',
  'female', 'male', 'solo', 'solo female', 'solo male', 'duo', 'duo female', 'duo male', 'trio',
  'group', 'mare', 'stallion', 'filly', 'colt', 'pony', 'earth pony', 'unicorn', 'pegasus',
  'alicorn', 'bat pony',
  'simple background', 'white background', 'transparent background', 'black background',
  'gradient background', 'high res', 'absurd res', 'artist needed', 'source needed',
  'useless source url', 'edit', 'edited screencap', 'screencap', 'derpibooru exclusive',
  'animated', 'gif', 'webm', 'no sound', 'sound', 'vector', 'svg', 'png', 'jpg', 'traditional art',
  'digital art', 'signature', 'watermark', 'cropped', 'imminent', 'text', 'oc', 'oc only',
  'bust', 'portrait', 'solo focus', 'close-up', 'full body', 'looking at you', 'looking at each other',
]);

/** Emoticon tags (`:d`, `>:c`, `:3`, `x3`) describe an expression, not a subject. */
const EMOTICON = /^(?:[:;=>][-']?|x)[a-z0-9()<>|:\/]{1,3}$/;

/**
 * The characters a gallery is most often of, in their canonical Derpibooru spelling. Only an
 * ordering hint — a character listed here is named before the other content tags — so the list
 * is short and never needs to be complete: an unlisted character is still named, just later.
 */
const CHARACTERS = new Set([
  'twilight sparkle', 'pinkie pie', 'fluttershy', 'rarity', 'applejack', 'rainbow dash', 'spike',
  'princess celestia', 'princess luna', 'princess cadance', 'starlight glimmer', 'sunset shimmer',
  'trixie', 'derpy hooves', 'apple bloom', 'scootaloo', 'sweetie belle', 'discord',
  'queen chrysalis', 'lyra heartstrings', 'bon bon', 'vinyl scratch', 'octavia melody',
  'big macintosh', 'maud pie', 'sunburst', 'nightmare moon', 'tempest shadow', 'cozy glow',
  'shining armor', 'flurry heart', 'gilda', 'zecora', 'coco pommel', 'minuette', 'moondancer',
  'sci-twi', 'izzy moonbow', 'sunny starscout', 'pipp petals', 'zipp storm', 'hitch trailblazer',
  'misty brightdawn', 'sprout cloverleaf', 'opaline arcana',
]);

/** Namespaces that name who made the picture rather than what is in it. */
const CREDIT_NAMESPACES = ['artist:', 'editor:', 'colorist:', 'photographer:'];

const MAX_SUBJECTS = 3;
const MAX_CREDITS = 2;

/** `图片 #123`, the name of a picture whose tags say nothing. */
export function fallbackImageName(id: number): string {
  return `图片 #${id}`;
}

/**
 * A short description: up to three subjects (characters first, then other content tags, in the
 * row's order) and up to two artists — `twilight sparkle、sunset shimmer、clothes，作者 floratavy`.
 * Falls back to `图片 #id`.
 */
export function describeImage(image: Pick<ImagePreview, 'id' | 'tags'>): string {
  const characters: string[] = [];
  const others: string[] = [];
  const credits: string[] = [];
  for (const raw of image.tags ?? []) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    const lower = tag.toLowerCase();
    if (!tag || NOISE.has(lower) || EMOTICON.test(lower)) continue;
    const credit = CREDIT_NAMESPACES.find((ns) => lower.startsWith(ns));
    if (credit) {
      if (lower.startsWith('artist:')) credits.push(tag.slice(credit.length).trim());
      continue;
    }
    if (lower.startsWith('oc:')) {
      characters.push(tag.slice(3).trim());
      continue;
    }
    /* Any other namespace (`series:`, `comic:`, `spoiler:`, `fanfic:` …) is bookkeeping. */
    if (/^[a-z ]+:/.test(lower)) continue;
    if (CHARACTERS.has(lower)) characters.push(tag);
    else others.push(tag);
  }
  const subjects = [...characters, ...others].filter(Boolean).slice(0, MAX_SUBJECTS);
  const artists = credits.filter(Boolean).slice(0, MAX_CREDITS);
  if (subjects.length === 0 && artists.length === 0) return fallbackImageName(image.id);
  if (subjects.length === 0) return `${fallbackImageName(image.id)}，作者 ${artists.join('、')}`;
  const byline = artists.length > 0 ? `，作者 ${artists.join('、')}` : '';
  return `${subjects.join('、')}${byline}`;
}
