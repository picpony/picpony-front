import type { NextRequest } from 'next/server';
import { PICPONY_API_ORIGIN, PICPONY_RELAY_UPSTREAM } from '@/lib/constants';
import {
  UPLOAD_MAX_DESCRIPTION_BYTES,
  UPLOAD_MAX_TAG_INPUT,
  uploadSourceUrl,
  utf8Length,
} from '@/lib/uploadLimits';

/**
 * 发布图片's second step: hand Derpibooru a staged picture, through the relay.
 *
 * Derpibooru's API takes an upload *by URL* — `POST /api/v1/json/images?key=` with JSON
 * `{image: {tag_input, source_url, description}, url}` — and the original front end sent that
 * request through `cdn.picpony.top/relay`, the line that exists for visitors whose direct route to
 * Derpibooru does not work. The relay answers only PicPony's own `Origin`, so the browser cannot
 * reach it from this app; this handler makes the hop, as `app/relay/route.ts` does for reads.
 *
 * It is **not** a general forwarder. The target is fixed — Derpibooru's upload endpoint and
 * nothing else — and the body is rebuilt from validated fields rather than passed through, so the
 * request it sends is the one the form described. The caller's API key arrives in the body, not
 * the query, so it does not land in this server's access log on the way in; the relay's own
 * contract puts it in the relayed URL, exactly as the original front end did.
 *
 * Nothing here holds ambient authority: there is no cookie, no session and no server credential —
 * everything that makes the request count comes from the caller — so a cross-site post can do
 * nothing the caller could not do with the relay directly.
 */

const UPLOAD_TARGET = 'https://derpibooru.org/api/v1/json/images';

/**
 * Generous: Derpibooru fetches the picture and processes it before it answers, and the person is
 * watching a progress bar. A wedged relay is still let go of, rather than holding a connection
 * for the platform's socket lifetime. On expiry the answer is a 504, which the form reads as
 * "unconfirmed" — the upload may have landed.
 */
const SUBMIT_TIMEOUT_MS = 90_000;

/** Derpibooru keys are short and alphanumeric; anything else is not one. */
const KEY_OK = /^[A-Za-z0-9_-]{8,64}$/;
/** The relay's per-user accounting label — `app/relay/route.ts`'s rule, verbatim. */
const XP_USER_MAX = 64;
const XP_USER_OK = /^[\w.-]+$/;
const MAX_TAG_INPUT = UPLOAD_MAX_TAG_INPUT;
/**
 * The body is a handful of strings; a larger one is not a form. Sized to hold every body the
 * field limits allow (`lib/uploadLimits.ts`), JSON escaping included — a 50,000-byte description
 * of line breaks doubles as it is escaped — so the cap never refuses a valid form (review P4-F2:
 * at 128KB it refused a long Chinese description the form had accepted, as 「请求过大」).
 */
const MAX_BODY_BYTES = 512 * 1024;

const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'content-encoding',
  'content-length',
  'cdn-cache-control',
  'vercel-cdn-cache-control',
  'x-powered-by',
  'server',
  'set-cookie',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'vary',
]);

function answer(status: number, message: string): Response {
  return Response.json({ success: false, message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

/** An absolute http(s) URL with no credentials, within `UPLOAD_MAX_SOURCE_URL` characters — or `null`. The
 *  form checks a source with the same function, so it cannot accept one this refuses. */
const webUrl = uploadSourceUrl;

/** Optional text within `maxBytes` UTF-8 bytes — Derpibooru's own unit for the description. */
function optionalText(value: unknown, maxBytes: number): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return undefined;
  return utf8Length(text) > maxBytes ? null : text;
}

export async function POST(request: NextRequest): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return answer(413, '请求过大');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return answer(415, '请求格式无效');
  }

  let raw = '';
  const reader = request.body?.getReader();
  if (!reader) return answer(400, '请求无效');
  try {
    let bytes = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return answer(413, '请求过大');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch {
    return answer(400, '请求无效');
  } finally {
    reader.releaseLock();
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return answer(400, '请求无效');
    body = parsed as Record<string, unknown>;
  } catch {
    return answer(400, '请求无效');
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY_OK.test(key)) return answer(400, 'API Key 无效');
  const url = webUrl(body.url);
  if (!url) return answer(400, '图片暂存地址无效');
  const tagInput = typeof body.tag_input === 'string' ? body.tag_input.trim() : '';
  if (!tagInput || tagInput.length > MAX_TAG_INPUT) return answer(400, '标签无效');
  const sourceRaw = body.source_url;
  const source = sourceRaw === undefined || sourceRaw === null || sourceRaw === '' ? undefined : webUrl(sourceRaw);
  if (source === null) return answer(400, '来源链接无效');
  const description = optionalText(body.description, UPLOAD_MAX_DESCRIPTION_BYTES);
  if (description === null) return answer(400, '作品描述无效');

  const target = new URL(UPLOAD_TARGET);
  target.searchParams.set('key', key);
  const upstream = new URL(PICPONY_RELAY_UPSTREAM);
  upstream.searchParams.set('url', target.toString());
  const xpUser = typeof body.xp_user === 'string' ? body.xp_user : '';
  if (xpUser && xpUser.length <= XP_USER_MAX && XP_USER_OK.test(xpUser)) {
    upstream.searchParams.set('xp_user', xpUser);
  }

  const image: Record<string, string> = { tag_input: tagInput };
  if (source) image.source_url = source;
  if (description) image.description = description;

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: 'POST',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(SUBMIT_TIMEOUT_MS)]),
      headers: {
        /* The allowlist the relay checks — the reason this handler exists. */
        Origin: PICPONY_API_ORIGIN,
        Referer: `${PICPONY_API_ORIGIN}/`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': request.headers.get('user-agent') ?? 'PicPony/1.0',
      },
      body: JSON.stringify({ image, url }),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (error) {
    /* Our own deadline: the relay held the request, so it may have reached Derpibooru. A refused
       connection never left this server. The form tells the two apart by status. */
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return timedOut ? answer(504, '上传线路没有在时限内应答') : answer(502, '上传线路不可用');
  }

  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {});
    return answer(502, '上传线路返回了重定向');
  }

  /* Only JSON is an answer. Derpibooru's error pages and a relay's challenge page are documents,
     and serving one from this origin would hand its scripts the session's storage. */
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json' && !/^application\/[\w.+-]+\+json$/.test(mediaType ?? '')) {
    void response.body?.cancel().catch(() => {});
    if (response.status >= 400 && response.status < 500) {
      return answer(response.status, `Derpibooru 返回 ${response.status}`);
    }
    return answer(502, '上传线路返回了非 JSON 内容');
  }

  const headers = new Headers();
  /* Headers the upstream's `Connection` names are hop-by-hop too — the other proxies drop them,
     and this one did not (review P1-F12). */
  const connectionHeaders = new Set(
    response.headers.get('connection')?.toLowerCase().split(',').map((value) => value.trim()) ?? [],
  );
  response.headers.forEach((value, name) => {
    if (!SKIP_RESPONSE_HEADERS.has(name) && !connectionHeaders.has(name)) headers.set(name, value);
  });
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const dynamic = 'force-dynamic';
