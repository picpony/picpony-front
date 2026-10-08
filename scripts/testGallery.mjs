/**
 * The gallery's pure contracts, with no browser and no live service: the image ladder (the
 * optimizer rung, the backoff, the give-up), the rendition an animated card takes, a card's
 * name, the banner's teaser and filter verdict, the card `sizes` arithmetic, the shared seed
 * keys, the two decision-15 adapters and the server's featured seed.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { blockFiltersEnvelope } from './netAuditFixtures.mjs';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testGallery');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false }),
};
globalThis.document = {
  visibilityState: 'visible', hidden: false, cookie: '',
  addEventListener() {}, removeEventListener() {},
};
globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };

const loader = await import('../lib/imageLoader.ts');
const { describeImage } = await import('../lib/imageDescription.ts');
const { descriptionTeaser } = await import('../lib/plainText.ts');
const { isWithheldBy } = await import('../lib/imageFilters.ts');
const masonry = await import('../lib/masonry.ts');
const { featuredKey, homeFeedKey } = await import('../lib/feedKeys.ts');
const gallery = await import('../lib/api/gallery.ts');
const { ApiError } = await import('../lib/api/errors.ts');
const { DEFAULT_BLOCK_FILTERS } = await import('../lib/blockFilters.ts');
const catalogue = await import('../lib/resources.ts');
const feedServer = await import('../lib/feed.server.ts');
const { clearBlockFiltersMemo } = await import('../lib/blockFilters.server.ts');
const { IMAGE_WORKER_BASE, IMAGE_CDN_BASE } = await import('../lib/constants.ts');

const json = (data, init) => Response.json(data, init);
const RAW = 'https://derpicdn.net/img/2026/9/25/3901421/medium.png';

beforeEach(() => {
  values.clear();
  globalThis.fetch = async (url) => { throw new Error(`Unexpected network request: ${url}`); };
});

// --- lib/imageLoader.ts -------------------------------------------------------------------

test('the first attempt is the optimizer on the raw URL, line-free, so it cannot mismatch at hydration', () => {
  assert.equal(loader.OPTIMIZER_ACTIVE, true, 'outside development the optimizer is live');
  const first = loader.createInitialAttempt(RAW, { line: 'cdn' });
  assert.deepEqual(
    { url: first.url, optimized: first.optimized, delayMs: first.delayMs, giveUp: first.giveUp },
    { url: RAW, optimized: true, delayMs: 0, giveUp: false },
    'no worker or CDN wrapper reaches the optimizer (R8-026)',
  );
  const direct = loader.createInitialAttempt(RAW, { line: 'cdn', optimize: false });
  assert.equal(direct.optimized, false);
  assert.equal(direct.url, `${IMAGE_CDN_BASE}${encodeURIComponent(RAW)}`, 'an unoptimized start takes the server’s line');
});

test('an optimizer failure is not retried on the same URL: it goes browser-direct on the visitor’s line', () => {
  const next = loader.resolveNextAttempt(RAW, loader.createInitialAttempt(RAW), true);
  assert.equal(next.optimized, false);
  assert.equal(next.delayMs, 0, 'a different URL needs no wait');
  assert.ok(next.url.startsWith(IMAGE_WORKER_BASE) && next.url.endsWith('&_thumb=1'), next.url);
});

test('every retry waits: a beat on the worker, an exponential backoff on the direct line, then a give-up', () => {
  let attempt = loader.createInitialAttempt(RAW, { optimize: false, line: 'picpony' });
  attempt = loader.resolveNextAttempt(RAW, attempt);
  assert.equal(attempt.tier, 0);
  assert.ok(attempt.delayMs >= 300 && attempt.delayMs <= 500, `worker retry waits a beat (${attempt.delayMs})`);
  assert.match(attempt.url, /retry=\d+/, 'and busts the cached failure');
  attempt = loader.resolveNextAttempt(RAW, attempt);
  assert.ok(attempt.tier === 1 || attempt.tier === 2, 'then steps down a line');
  if (attempt.tier === 1) {
    attempt = loader.resolveNextAttempt(RAW, attempt);
    attempt = loader.resolveNextAttempt(RAW, attempt);
  }
  assert.equal(attempt.tier, 2);
  const waits = [];
  let guard = 0;
  while (!attempt.giveUp && guard++ < 20) {
    attempt = loader.resolveNextAttempt(RAW, attempt);
    if (!attempt.giveUp) waits.push(attempt.delayMs);
  }
  assert.ok(attempt.giveUp, 'the ladder ends');
  assert.equal(waits.length, 4, 'four direct retries');
  for (let i = 1; i < waits.length; i += 1) {
    assert.ok(waits[i] > waits[i - 1] * 1.1, `the backoff grows (${waits.join(', ')})`);
  }
  assert.ok(waits[0] >= 375 && waits.at(-1) <= 8_000 * 1.25, 'bounded: half a second to eight');
  assert.equal(loader.resolveNextAttempt(RAW, attempt), attempt, 'a given-up attempt stays given up');
});

test('the backoff is jittered and capped', () => {
  for (let n = 1; n <= 12; n += 1) {
    const ms = loader.backoffDelay(n);
    const base = Math.min(8_000, 500 * 2 ** (n - 1));
    assert.ok(ms >= base * 0.75 && ms <= base * 1.25, `${n}: ${ms}`);
  }
});

test('an animated card takes the smallest rendition wide enough, not the 800px medium (R12-001)', () => {
  const reps = Object.fromEntries(
    ['thumb_small', 'thumb', 'small', 'medium', 'large'].map((name) => [name, `https://derpicdn.net/img/1/${name}.gif`]),
  );
  /* The R12 evidence: a 749×421 GIF in a 256px desktop column. */
  assert.equal(loader.pickRendition(reps, 749, 421, 256), reps.thumb, '250px wide is within 10% of 256');
  assert.equal(loader.pickRendition(reps, 749, 421, 256 * 1.5), reps.medium);
  /* Portrait: `small` is a 320×240 box, so a tall picture gets narrower there than in `thumb`. */
  assert.equal(loader.renditionWidth('small', 600, 800), 180);
  assert.equal(loader.renditionWidth('thumb', 600, 800), 188);
  assert.equal(loader.pickRendition(reps, 600, 800, 256), reps.medium);
  assert.equal(loader.pickRendition({ thumb: reps.thumb }, 3000, 2000, 900), reps.thumb, 'the largest there is');
  assert.equal(loader.renditionWidth('medium', 300, 200), 300, 'never upscaled past the original');
});

test('line URLs unwrap to the raw Derpibooru URL', () => {
  const wrapped = `${IMAGE_WORKER_BASE}${encodeURIComponent(RAW)}&_thumb=1`;
  assert.equal(loader.getRawImageUrl(wrapped), RAW);
  assert.equal(loader.getRawImageUrl(`${IMAGE_CDN_BASE}${encodeURIComponent(RAW)}`), RAW);
  assert.equal(loader.getRawImageUrl(`${RAW}?retry=123`), RAW);
});

// --- names, teasers, verdicts -----------------------------------------------------------------

test('a card is named by its content, never by the upload’s file name (R11-002)', () => {
  assert.equal(
    describeImage({ id: 1, name: 'GOAwF74aMAAC6KH.jpg?name=orig', tags: ['earth pony', 'female', 'g4', 'pinkie pie', 'safe', 'solo', 'artist:floratavy'] }),
    'pinkie pie，作者 floratavy',
  );
  assert.equal(
    describeImage({ id: 2, tags: ['anthro', 'belly', 'bracelet', 'clothes', 'sweetie belle', 'artist:a', 'artist:b', 'artist:c'] }),
    'sweetie belle、anthro、belly，作者 a、b',
    'characters first, three subjects, two artists',
  );
  assert.equal(describeImage({ id: 3, tags: ['safe', 'g4', 'solo'] }), '图片 #3');
  assert.equal(describeImage({ id: 4, tags: ['safe', 'artist:only'] }), '图片 #4，作者 only');
  assert.equal(describeImage({ id: 5, tags: ['oc:fluffy', 'oc only', 'series:x', 'twilight sparkle'] }), 'fluffy、twilight sparkle');
  assert.equal(describeImage({ id: 6 }), '图片 #6');
});

test('a description teaser is plain text: markup removed, spoilers dropped, cut with an ellipsis (R4-054)', () => {
  assert.equal(descriptionTeaser('> **Commission** for [someone](https://x.y) ||big spoiler|| done!\n\nsecond'), 'Commission for someone done!');
  assert.equal(descriptionTeaser('\\#mlp #mylittlepony\n\nArt by me #mlp #scitwi'), 'Art by me', 'a paragraph of hashtags is skipped');
  assert.equal(descriptionTeaser('Use `code` and _italic_ and snake_case_name and 2*3*4'), 'Use code and italic and snake_case_name and 2*3*4');
  assert.equal(descriptionTeaser('```\ncode\n```\n\nReal &amp; more &#65;'), 'Real & more A');
  assert.equal(descriptionTeaser('"Textile":https://e.x and [spoiler]x[/spoiler]ok'), 'Textile and ok');
  assert.equal(descriptionTeaser('  \n  '), '');
  assert.equal(descriptionTeaser(null), '');
  const long = descriptionTeaser('字'.repeat(300));
  assert.equal(Array.from(long).length, 150);
  assert.ok(long.endsWith('…'));
});

test('the banner is judged by the feed’s own rules (R4-025)', () => {
  const settings = { contentFilter: 'safe', banAnthro: false, banDiscomfort: true, onlyPony: false, hiddenTags: [] };
  const f = DEFAULT_BLOCK_FILTERS;
  assert.equal(isWithheldBy(['pony', 'suggestive'], settings, f), true, 'the safe filter’s own tags');
  assert.equal(isWithheldBy(['pony', 'suggestive'], { ...settings, contentFilter: 'developer' }, f), false);
  assert.equal(isWithheldBy(['pony', 'safe'], settings, f), false);
  assert.equal(isWithheldBy(['anthro', 'safe'], { ...settings, banAnthro: true }, f), true);
  assert.equal(isWithheldBy(['obese', 'safe'], settings, f), true, 'the discomfort toggle is on by default');
  assert.equal(isWithheldBy(['obese', 'safe'], { ...settings, banDiscomfort: false }, f), false);
  assert.equal(isWithheldBy(['Guitar', 'safe'], { ...settings, hiddenTags: ['guitar'] }, f), true, 'case-insensitive');
  assert.equal(isWithheldBy(['human', 'safe'], { ...settings, onlyPony: true }, f), true, 'only-pony requires a pony tag');
  assert.equal(isWithheldBy(['pony', 'safe'], { ...settings, onlyPony: true }, f), false);
});

// --- sizes -----------------------------------------------------------------------------------

test('a card’s width counts the docked drawer and the gutters (R4-043)', () => {
  assert.equal(masonry.estimateCardWidth(390), 175);
  assert.equal(Math.round(masonry.estimateCardWidth(768)), 133, 'R4-043 measured ~136px at 768');
  assert.equal(masonry.estimateCardWidth(1440), 264);
  assert.equal(masonry.estimateCardWidth(1920), 308, 'the 1280px column caps it');
  assert.match(masonry.MASONRY_CARD_SIZES, /^\(max-width: 639px\) calc\(\(100vw - 40px\) \/ 2\)/);
  assert.match(masonry.MASONRY_CARD_SIZES, /\(max-width: 1023px\) calc\(\(100vw - 368px\) \/ 3\)/);
  assert.match(masonry.MASONRY_CARD_SIZES, /\(max-width: 1615px\) calc\(\(100vw - 384px\) \/ 4\), 308px$/);
  assert.match(masonry.GALLERY_BLOCK_SIZES, /\(max-width: 1615px\) calc\(100vw - 336px\), 1280px$/);
});

// --- keys ------------------------------------------------------------------------------------

test('the server’s seeds and the client’s resources build one key', () => {
  assert.equal(catalogue.homeFeed.keyOf({ page: 3, sort: 'score', fp: 'safe|-|d|-|' }), homeFeedKey(3, 'score', 'safe|-|d|-|'));
  assert.equal(catalogue.featuredImage.keyOf({ contentFilter: 'developer' }), featuredKey(undefined, 'developer'));
  assert.notEqual(
    catalogue.featuredImage.keyOf({ apiKey: 'k', contentFilter: 'safe' }),
    featuredKey(undefined, 'safe'),
    'a keyed read never lands on the anonymous seed',
  );
});

// --- decision 15 adapters --------------------------------------------------------------------

test('本站讨论: a page of ids with PicPony’s counts, deduplicated and validated', async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = new URL(String(url), 'https://app.invalid');
    return json({
      success: true,
      images: [
        { image_id: 922467, comment_count: 3, last_commented_at: '2026-09-23 14:01:48' },
        { image_id: 922467, comment_count: 9 },
        { image_id: 'x' },
        { image_id: 3898930, comment_count: 0 },
      ],
      total: 248,
      total_pages: 5,
    });
  };
  const page = await gallery.getDiscussedImages(2);
  assert.equal(asked.searchParams.get('action'), 'get_discussed_images');
  assert.equal(asked.searchParams.get('limit'), '50');
  assert.equal(asked.searchParams.get('page'), '2');
  assert.deepEqual(page.images.map((row) => [row.imageId, row.comments]), [[922467, 3], [3898930, 0]]);
  assert.equal(page.total, 248);
  assert.equal(page.totalPages, 5);
  globalThis.fetch = async () => json({ success: false, message: '服务不可用' }, { status: 200 });
  await assert.rejects(gallery.getDiscussedImages(1), ApiError, 'an unsuccessful envelope is a failure, not an empty page');
});

test('PicPony comment counts: one POST per page, positive counts only', async () => {
  let body;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    assert.equal(new URL(String(url), 'https://app.invalid').searchParams.get('action'), 'get_batch_comment_counts');
    assert.equal(init.method, 'POST');
    return json({ success: true, counts: { 1: 2, 2: 0, 3: '4', x: 5 } });
  };
  assert.deepEqual(await gallery.getBatchCommentCounts([1, 2, 3]), { 1: 2, 3: 4 });
  assert.deepEqual(body, { image_ids: [1, 2, 3] });
  assert.deepEqual(await gallery.getBatchCommentCounts([]), {}, 'nothing to ask, nothing sent');
});

// --- lib/feed.server.ts ----------------------------------------------------------------------

test('the featured seed is anonymous, keyed like the resource, and carries the document’s verdict', async () => {
  clearBlockFiltersMemo();
  const reads = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.searchParams.get('action') === 'get_block_tags') return json(blockFiltersEnvelope());
    reads.push(target);
    assert.equal(target.searchParams.get('key'), null, 'no user key reaches a shared server read');
    assert.ok(init?.signal, 'bounded by the document’s wait');
    return json({ image: { id: 9, tags: ['pony', 'guitar'], representations: { large: RAW }, view_url: RAW } });
  };
  const plain = await feedServer.readFeatured('safe|-|d|-|');
  assert.equal(plain.key, featuredKey(undefined, 'safe'));
  assert.equal(plain.data.id, 9);
  assert.equal(plain.hidden, false);
  const hiding = await feedServer.readFeatured('safe|-|d|-|guitar');
  assert.equal(hiding.hidden, true, 'the fingerprint’s hidden tags withhold it');
  assert.equal(reads.length, 1, 'one upstream read per content filter, shared');
  const developer = await feedServer.readFeatured('developer|-|d|-|');
  assert.equal(developer.key, featuredKey(undefined, 'developer'));
  assert.equal(reads.at(-1).searchParams.get('filter_id'), '56027', 'developer mode reads through its own filter');
  const unknown = await feedServer.readFeatured('unmirrorable');
  assert.equal(unknown.hidden, true, 'a device whose hidden tags the server cannot see gets no picture from it');
  const lined = feedServer.featuredOnImageLine(plain, 'cdn');
  assert.ok(lined.data.representations.large.startsWith(IMAGE_CDN_BASE));
  assert.equal(plain.data.representations.large, RAW, 'the shared memo entry is never rewritten');
});

test('the feed seed reads the page in the address, and only a bounded range of them', async () => {
  clearBlockFiltersMemo();
  const pages = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    const action = target.searchParams.get('action');
    if (action === 'get_block_tags') return json(blockFiltersEnvelope());
    if (action === 'get_public_blacklist') return json({ success: true, blacklist: [] });
    pages.push(target.searchParams.get('page'));
    return json({ total: 500, images: [{ id: 1, representations: {}, view_url: '' }] });
  };
  const seed = await feedServer.readHomeFeed('safe|-|d|-|', 'created_at', 3);
  assert.equal(pages.at(-1), '3');
  assert.equal(seed.key.startsWith('created_at:3:'), true);
  assert.equal(await feedServer.readHomeFeed('safe|-|d|-|', 'created_at', 21), null, 'past the seeded range the client reads');
  assert.equal(await feedServer.readHomeFeed('safe|-|d|-|', 'created_at', 0), null);
});
