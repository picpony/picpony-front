/**
 * Regression cases for review part 4 (search, upload, messages, favourites, forum, subscriptions,
 * shop, tag and block groups), with no live service: each test names the finding it pins (`P4-Fn`
 * in `part4-review.md`). P4-F5 lives with the sync's own cases in `testSubscriptions.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock, test } from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testReviewPart4');

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { origin: 'https://app.invalid', pathname: '/' },
  __picponyRoutePolicy: { api: 'direct', image: 'direct' },
};
globalThis.document = { visibilityState: 'visible', hidden: false, cookie: '', addEventListener() {}, removeEventListener() {} };

const { balanceUserQuery, buildSearchQueryFrom } = await import('../lib/searchQuery.ts');
const limits = await import('../lib/uploadLimits.ts');
const { POST } = await import('../app/upload/submit/route.ts');
const { encodeWithinLimit, FORUM_IMAGE_MAX_BYTES } = await import('../lib/forumImages.ts');
const { packFavourites, transferBudgetMs } = await import('../lib/favoritesDownload.ts');
const { shareThumbSrc } = await import('../app/messages/messageText.ts');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------------------------
// P4-F1 — a port of Philomena's lexer (PhilomenaQuery.Parse.Lexer), as far as groups and quoted
// terms go: what decides where the group around the user's text really ends.
// ---------------------------------------------------------------------------------------------

const OPERATOR = /^\s+(?:AND|OR|&&|\|\|)\s+/;
const STOP = (s, i) => s[i] === ',' || OPERATOR.test(s.slice(i)) || /^\s*\)/.test(s.slice(i)) || /^\s*\^[-+]?\d/.test(s.slice(i));

/** `dirty_text` from `i`: the end of the term's text, or -1 when it matches nothing. */
function dirtyText(s, i) {
  let k = i;
  for (;;) {
    if (k >= s.length || STOP(s, k)) break;
    const ch = s[k];
    if (ch === '\\') {
      k += k + 1 < s.length ? 2 : 1;
      continue;
    }
    if (ch === '(') {
      const inner = dirtyText(s, k + 1);
      if (inner !== -1 && s[inner] === ')') {
        k = inner + 1;
        continue;
      }
      break;
    }
    if (ch === ')') break;
    k += 1;
  }
  return k > i ? k : -1;
}

/** The lexer's tokens with their offsets; `null` where Philomena's lexer would fail. */
function lex(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (s[i] === ',') { tokens.push({ type: 'and', at: i }); i += 1; continue; }
    if (s[i] === '!' || s[i] === '-') { tokens.push({ type: 'not', at: i }); i += 1; continue; }
    const operator = OPERATOR.exec(rest);
    if (operator) { tokens.push({ type: /OR|\|\|/.test(operator[0]) ? 'or' : 'and', at: i }); i += operator[0].length; continue; }
    const not = /^NOT\s+/.exec(rest);
    if (not) { tokens.push({ type: 'not', at: i }); i += not[0].length; continue; }
    if (s[i] === '(') { tokens.push({ type: 'lparen', at: i }); i += 1; continue; }
    if (s[i] === ')') { tokens.push({ type: 'rparen', at: i }); i += 1; continue; }
    const boost = /^\^[-+]?\d+(?:\.\d+)?/.exec(rest);
    if (boost) { i += boost[0].length; continue; }
    if (/\s/.test(s[i])) { i += 1; continue; }
    if (s[i] === '"') {
      let j = i + 1;
      let closed = -1;
      while (j < s.length) {
        if (s[j] === '\\') { j += j + 1 < s.length ? 2 : 1; continue; }
        if (s[j] === '"') { closed = j; break; }
        j += 1;
      }
      if (closed !== -1) { tokens.push({ type: 'term', at: i }); i = closed + 1; continue; }
    }
    const end = dirtyText(s, i);
    if (end === -1) return null;
    tokens.push({ type: 'term', at: i });
    i = end;
  }
  return tokens;
}

/** Whether, in `(<scoped>), -explicit`, Philomena closes the opening group exactly at our `)`. */
function groupHolds(scoped) {
  const query = `(${scoped}), -explicit`;
  const tokens = lex(query);
  if (!tokens) return true; /* A query Philomena cannot lex is a 400, not a way around the filters. */
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'lparen') depth += 1;
    if (token.type === 'rparen') {
      depth -= 1;
      if (depth === 0) return token.at === scoped.length + 1;
    }
  }
  return true;
}

test('P4-F1: a quote in the middle of a term cannot hide the parentheses that close the filter group', () => {
  const exploit = '-x"), explicit OR (y"';
  /* What it does unbalanced: Philomena ends the group at the user's own `)`. */
  assert.equal(groupHolds(exploit), false, 'the lexer port reproduces the escape');
  const scoped = balanceUserQuery(exploit);
  assert.notEqual(scoped, exploit);
  assert.equal(groupHolds(scoped), true, scoped);
  const built = decodeURIComponent(buildSearchQueryFrom(
    { contentFilter: 'safe', banAnthro: false, onlyPony: false, hiddenTags: [] }, exploit, undefined, [42],
  ));
  assert.ok(built.startsWith(`(${scoped}), `), built);
  assert.match(built, /, -explicit/);
  assert.match(built, /, -id:42$/);

  for (const text of ['explicit"), * OR ("', 'a, b"), id.gt:0 OR (c"', 'NOT x"), explicit OR (y"', 'a OR b"), c OR (d"']) {
    assert.equal(groupHolds(balanceUserQuery(text)), true, text);
  }
});

test('P4-F1: quoted terms where Philomena reads them stay as typed', () => {
  for (const text of [
    '"a (b" OR c', 'a OR "b c"', 'NOT "a b"', '-"a (b"', 'fluttershy, (safe OR "a)b")', 'artist:foo (bar)',
    'fluttershy OR (rarity, safe)', '"princess luna", safe', 'a && "b)"',
  ]) {
    assert.equal(balanceUserQuery(text), text, text);
    assert.equal(groupHolds(text), true, text);
  }
  /* A quote mid-term is an ordinary character either way; escaped, it says so. */
  assert.equal(balanceUserQuery('x"y'), 'x\\"y');
});

test('P4-F1: fuzzed text never ends the group early', () => {
  const pieces = ['a', 'b', ' ', '(', ')', '"', '\\', ',', '-', '!', ' OR ', ' AND ', ' || ', 'NOT ', '^2', 'x:y'];
  let seed = 4;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 3000; round += 1) {
    let text = '';
    const length = 1 + Math.floor(random() * 12);
    for (let i = 0; i < length; i += 1) text += pieces[Math.floor(random() * pieces.length)];
    const scoped = balanceUserQuery(text);
    assert.equal(groupHolds(scoped), true, `${JSON.stringify(text)} → ${JSON.stringify(scoped)}`);
  }
});

// ---------------------------------------------------------------------------------------------
// P4-F2 — the upload's limits, counted the way Derpibooru counts them
// ---------------------------------------------------------------------------------------------

const valid = { key: 'fixtureKey123', url: 'https://picpony.top/uploads/fixture.png', tag_input: 'safe, pony, cute' };
const submit = (body) => POST(new Request('https://app.invalid/upload/submit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

test('P4-F2: the description is measured in UTF-8 bytes, on the form and on the hop alike', async () => {
  assert.equal(limits.utf8Length('小马'), 6);
  assert.equal(limits.uploadDescriptionProblem('马'.repeat(16_666)), null, '49,998 bytes fit');
  assert.match(limits.uploadDescriptionProblem('马'.repeat(20_000)) ?? '', /60000 字节/, '20,000 Chinese characters do not');
  assert.equal(limits.uploadDescriptionProblem('a'.repeat(50_000)), null);
  assert.equal(limits.uploadDescriptionProblem(` ${'a'.repeat(50_000)} \n`), null, 'measured trimmed, as sent');

  const previous = globalThis.fetch;
  const forwarded = [];
  globalThis.fetch = async (url, init) => {
    forwarded.push(JSON.parse(String(init.body)));
    return Response.json({ image: { id: 9 } }, { status: 201 });
  };
  try {
    /* The longest description the form accepts reaches Derpibooru — line breaks, which JSON
       doubles, included — where the 128KB cap answered 413. */
    const longest = '马'.repeat(16_000) + '\n'.repeat(1_900);
    assert.equal(limits.uploadDescriptionProblem(longest), null);
    const accepted = await submit({ ...valid, description: longest });
    assert.notEqual(accepted.status, 413);
    assert.notEqual(accepted.status, 400);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].image.description, longest.trim());

    /* One the form refuses, the hop refuses too — as an invalid description, never as 请求过大. */
    const refused = await submit({ ...valid, description: '马'.repeat(20_000) });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).message, '作品描述无效');
    assert.equal(forwarded.length, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('P4-F2: the form and the hop agree on a source address and on the tag list', async () => {
  for (const [value, ok] of [
    ['https://example.test/art', true],
    ['https://user:pass@example.test/art', false],
    [`https://example.test/${'a'.repeat(2100)}`, false],
    ['example.test', false],
    ['ftp://example.test/a', false],
  ]) {
    assert.equal(Boolean(limits.uploadSourceUrl(value)), ok, value);
  }
  assert.equal(limits.uploadTagInput('safe', ['pony', 'cute']), 'safe, pony, cute');
  assert.equal(limits.uploadTagInput(null, ['pony']), 'pony');

  const page = source('app/upload/page.tsx');
  assert.match(page, /uploadSourceUrl\(text\)/, 'the form checks a source with the hop\'s own function');
  assert.match(page, /uploadDescriptionProblem\(draft\.description\)/);
  assert.match(page, /UPLOAD_MAX_TAG_INPUT/);
  assert.doesNotMatch(page, /Array\.from\(draft\.description\)\.length/, 'no character count left');
  const route = source('app/upload/submit/route.ts');
  assert.match(route, /const webUrl = uploadSourceUrl;/);
  assert.match(route, /UPLOAD_MAX_DESCRIPTION_BYTES/);
});

// ---------------------------------------------------------------------------------------------
// P4-F3 — a sent reply takes away only what it sent
// ---------------------------------------------------------------------------------------------

test('P4-F3: a reply that lands keeps the words typed and the target picked while it was out', () => {
  const composer = source('components/forum/ReplyComposer.tsx');
  assert.match(composer, /const sent = content;/);
  assert.match(composer, /setContent\(\(current\) => \(current === sent \? '' : current\)\)/);
  assert.match(composer, /latestReplyTo\.current\?\.commentId === target\.commentId\) onCancelReply\(\)/);
  assert.doesNotMatch(composer, /setContent\(''\);\n\s*onCancelReply\(\);/, 'no unconditional clear left');
});

// ---------------------------------------------------------------------------------------------
// P4-F4 — a picture that may be transparent stays PNG when it fits, and is laid over white when not
// ---------------------------------------------------------------------------------------------

function fakeEncoder(sizes) {
  const calls = [];
  return {
    calls,
    encoder: {
      async encode(type, quality) {
        calls.push(`${type}@${quality}`);
        const size = sizes[type]?.(quality) ?? 1;
        return { size, type };
      },
      flatten() { calls.push('flatten'); },
    },
  };
}

test('P4-F4: a large PNG is redrawn as a PNG when that fits, and only flattened before a JPEG', async () => {
  const fits = fakeEncoder({ 'image/png': () => FORUM_IMAGE_MAX_BYTES - 1 });
  const kept = await encodeWithinLimit(fits.encoder, 'image/png');
  assert.equal(kept.type, 'image/png');
  assert.deepEqual(fits.calls, ['image/png@1']);

  const heavy = fakeEncoder({
    'image/png': () => FORUM_IMAGE_MAX_BYTES + 1,
    'image/jpeg': (quality) => (quality > 0.6 ? FORUM_IMAGE_MAX_BYTES + 1 : FORUM_IMAGE_MAX_BYTES),
  });
  const jpeg = await encodeWithinLimit(heavy.encoder, 'image/webp');
  assert.equal(jpeg.type, 'image/jpeg');
  assert.deepEqual(heavy.calls, ['image/png@1', 'flatten', 'image/jpeg@0.9', 'image/jpeg@0.75', 'image/jpeg@0.6']);

  const photo = fakeEncoder({ 'image/jpeg': () => FORUM_IMAGE_MAX_BYTES * 2 });
  const last = await encodeWithinLimit(photo.encoder, 'image/jpeg');
  assert.equal(last.type, 'image/jpeg', 'the last step is taken as it is; the caller reports the size');
  assert.equal(photo.calls[0], 'flatten', 'a photo never tries PNG');
  assert.equal(photo.calls.at(-1), 'image/jpeg@0.3', 'the original front end\'s quality floor');
});

// ---------------------------------------------------------------------------------------------
// P4-F6 — a steady transfer of a large original is not cut at 45 seconds
// ---------------------------------------------------------------------------------------------

test('P4-F6: a large original arriving steadily past 45 s is packed; a crawl is still let go of', async () => {
  assert.equal(transferBudgetMs(0), 45_000);
  assert.ok(transferBudgetMs(12 * 1024 * 1024) > 60_000);

  const previous = globalThis.fetch;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  try {
    const run = async (chunkBytes, chunks) => {
      globalThis.fetch = async (_url, init) => {
        let sent = 0;
        const body = new ReadableStream({
          start(controller) {
            /* As a real fetch does: an abort errors the body being read. */
            init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
          },
          pull(controller) {
            return new Promise((resolve) => {
              setTimeout(() => {
                if (init.signal.aborted) return resolve();
                if (sent === chunks) controller.close();
                else {
                  sent += 1;
                  controller.enqueue(new Uint8Array(chunkBytes));
                }
                resolve();
              }, 10_000);
            });
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
      };
      let done = false;
      const outcome = packFavourites([{ id: 1, view_url: 'https://derpicdn.net/img/view/1.png' }], { lines: ['direct'] })
        .finally(() => { done = true; });
      for (let step = 0; step < 40 && !done; step += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        mock.timers.tick(10_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      return outcome;
    };
    /* 6 × 2MB, one every 10 s: 200 KB/s for 60 s — packed. */
    const steady = await run(2 * 1024 * 1024, 6);
    assert.equal(steady.packed, 1, 'a 12MB original at 200 KB/s');
    /* 10 × 256KB, one every 10 s: 25 KB/s — still failed. */
    const crawl = await run(256 * 1024, 10);
    assert.equal(crawl.packed, 0);
    assert.equal(crawl.failed, 1);
  } finally {
    mock.timers.reset();
    globalThis.fetch = previous;
  }
});

// ---------------------------------------------------------------------------------------------
// P4-F7 — a share card draws only a Derpibooru or PicPony picture
// ---------------------------------------------------------------------------------------------

test('P4-F7: a share card\'s thumbnail is drawn only from Derpibooru\'s and PicPony\'s hosts', () => {
  const real = 'https://derpicdn.net/img/2026/1/1/123/small.png';
  assert.equal(shareThumbSrc(real), real);
  assert.equal(shareThumbSrc(`https://picponyapi.147052.xyz/?url=${encodeURIComponent(real)}`), real, 'a wrapped one is unwrapped');
  for (const hostile of [
    'https://tracker.example/pixel.gif',
    'https://derpicdn.net.example/a.png',
    'http://derpicdn.net/img/a.png',
    'https://user@derpicdn.net/a.png',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(shareThumbSrc(hostile), '', hostile);
  }
  assert.match(source('app/messages/ShareCard.tsx'), /const thumb = shareThumbSrc\(target\.thumbUrl\)/);
});

// ---------------------------------------------------------------------------------------------
// P4-F8 — a block group's switch is confirmed by a fresh list once the server has the last word
// ---------------------------------------------------------------------------------------------

test('P4-F8: the switch loop asks for the list again once its writes have landed', () => {
  const page = source('app/block-groups/page.tsx');
  assert.match(page, /sentAny = true;/);
  assert.match(page, /if \(sentAny && readToken\(\) === token\) blockGroups\.expire\(\{ token \}\);/);
});
