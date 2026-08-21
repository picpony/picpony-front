const API_BASE = 'https://picpony.top';

/**
 * Joins class names, keeping only non-empty strings. The components in this
 * repo compose classes with template literals, which leaves `undefined` and
 * `false` in the output string; this keeps the conditional cases readable
 * without pulling in clsx/tailwind-merge.
 *
 * Takes `unknown` so that `someReactNode && 'pl-10'` type-checks — a ReactNode
 * narrows to `0 | 0n | '' | false | null | undefined` on the falsy branch, none
 * of which a narrower signature would accept.
 *
 * It does not resolve Tailwind conflicts, and **ordering the arguments does not
 * resolve them either**. This used to advise putting the overridable classes
 * first and letting `className` land last, which does not work: for two utilities
 * that set the same property, the winner is decided by the order the rules appear
 * in the generated stylesheet, not by the order the class names appear in the
 * attribute. `mt-12` beats a caller's `mt-8` wherever you put it.
 *
 * So a primitive that hard-codes a property a call site might want to change has
 * to detect the override and stand its own default down. `Skeleton` does this for
 * its radius and `Pagination` for its top margin; both carry the regex and the
 * reasoning. The alternative is to make the value a prop.
 */
export function cn(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
}

/**
 * Bound a number to a range.
 *
 * Written out seven times in four shapes before this — a local arrow in
 * `AsciiDecodeField`, a `useCallback` in `ImageCropper`, and five inline
 * `Math.max(a, Math.min(b, v))` in `GlossaryTab`, `Popover` and twice inside
 * `lib/hero/`. All correct, all different, and none of them findable from the
 * others.
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The [0, 1] case, which is the one `lib/hero/` needed twice. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * A PicPony-hosted path, made absolute.
 *
 * **The leading slash is normalised**, and that is the whole reason this exists as
 * one function. Eleven call sites hand-joined the same host with three different
 * semantics — `${host}/${path}`, `${host}${path}`, and a conditional — and the *same
 * field* (`post.cover_image`) was joined with a slash in one file and without one in
 * another. At most one of those was right, and a shared helper is what makes the
 * question have a single answer.
 */
export function getAssetUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}/${path.replace(/^\/+/, '')}`;
}

/** The avatar case, which tolerates a missing value. */
export function getAvatarUrl(avatar: string | undefined | null): string {
  return avatar ? getAssetUrl(avatar) : '';
}

/**
 * Copies text, and reports whether it actually worked.
 *
 * There were two of these and neither was right. The image detail's share menu
 * called `navigator.clipboard.writeText` bare and then showed 链接已复制
 * unconditionally — but the Clipboard API is undefined outside a secure context
 * and rejects on a denied permission, so on plain HTTP or with clipboard access
 * blocked the toast claimed a copy that never happened, and the rejection went
 * unhandled besides. The admin badge tab had the `execCommand` fallback but
 * announced its own failure through the browser's `prompt()` — a system box in
 * the OS font, outside the app's scrim, type scale and focus trap.
 *
 * `document.execCommand('copy')` is deprecated and is here on purpose: it is the
 * only path that works on an insecure origin, and it returns `false` rather than
 * throwing when the UA refuses, which is why its result is checked.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through — a denied permission is still worth one more attempt.
    }
  }
  try {
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', '');
    // Off-screen rather than hidden: `display:none` is not selectable, and a
    // visible focus jump would scroll the page.
    staging.style.position = 'fixed';
    staging.style.top = '-9999px';
    staging.style.opacity = '0';
    document.body.appendChild(staging);
    staging.select();
    const ok = document.execCommand('copy');
    staging.remove();
    return ok;
  } catch {
    return false;
  }
}


export function processImageFile(file: File, maxSizeMB: number = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择有效的图片文件'));
      return;
    }

    if (file.size > maxSizeMB * 1024 * 1024) {
      reject(new Error(`图片大小不能超过 ${maxSizeMB}MB`));
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error('读取图片失败'));
    };
    reader.readAsDataURL(file);
  });
}

export function distributeToMasonryColumns<T extends { height?: number; width?: number }>(
  items: T[],
  columns: number,
): T[][] {
  const columnData: T[][] = Array.from({ length: columns }, () => []);
  const columnHeights = new Array(columns).fill(0);

  items.forEach((item) => {
    let shortestColIndex = 0;
    let minHeight = columnHeights[0];
    for (let i = 1; i < columns; i++) {
      if (columnHeights[i] < minHeight) {
        minHeight = columnHeights[i];
        shortestColIndex = i;
      }
    }

    columnData[shortestColIndex].push(item);
    const aspectRatio = (item.height || 1) / (item.width || 1);
    columnHeights[shortestColIndex] += aspectRatio;
  });

  return columnData;
}

/**
 * Encrypt track data using XOR with key 0x5A (90), then base64 encode.
 * Matches backend validation in api.php captcha_verify / production Vue captcha.
 * Track format: array of [x, relativeY, elapsedMs] points
 *   - x: slider offset in the 310-wide puzzle (0..260)
 *   - relativeY: clientY - startY (NOT absolute clientY)
 *   - elapsedMs: ms since drag start
 * First point is always [0, 0, 0].
 */
export function encodeTrack(track: [number, number, number][]): string {
  const jsonStr = JSON.stringify(track);
  const key = 0x5a;
  const bytes = new Uint8Array(jsonStr.length);
  for (let i = 0; i < jsonStr.length; i++) {
    bytes[i] = jsonStr.charCodeAt(i) ^ key;
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
