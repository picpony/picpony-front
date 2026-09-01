const API_BASE = 'https://picpony.top';

/**
 * Joins class names, keeping only non-empty strings (repo components compose
 * classes with template literals, which leak undefined/false into the output).
 * Takes `unknown` so a falsy-guard expression type-checks: a ReactNode narrows
 * to `0 | 0n | '' | false | null | undefined` on the falsy branch. Does not
 * resolve conflicting utilities, and argument order does not either — for two
 * rules setting the same property, the winner is the order in the generated
 * stylesheet, not the attribute — so a primitive with a hard-coded default must
 * detect the override and stand it down.
 */
export function cn(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
}

/** Bound a number to a range — the shared bounded-number helper. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The [0, 1] case of clamp. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** A PicPony-hosted path, made absolute, normalising the leading slash — one function because call sites hand-joined the host with several conflicting join semantics, and the URL shape must have a single answer. */
export function getAssetUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}/${path.replace(/^\/+/, '')}`;
}

/** The avatar case of getAssetUrl, which tolerates a missing value. */
export function getAvatarUrl(avatar: string | undefined | null): string {
  return avatar ? getAssetUrl(avatar) : '';
}

/** Copies text and reports whether it actually worked: the Clipboard API needs a secure context and can reject, so a failed first attempt falls through to the deprecated-but-intentional execCommand copy — the only path that works on an insecure origin, whose false return is checked rather than trusted. */
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
    // Off-screen rather than hidden: a hidden element is not selectable.
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
 * Track format: array of [x, relativeY, elapsedMs] points — x: slider offset in the
 * 310-wide puzzle (0..260); relativeY: clientY - startY (NOT absolute clientY);
 * elapsedMs: ms since drag start. First point is always [0, 0, 0].
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

/**
 * Run something once the browser is idle, and hand back a way to cancel it.
 * `timeoutMs` is the deadline either way: it is `requestIdleCallback`'s own
 * `timeout` and, on browsers without one, the `setTimeout` fallback's delay —
 * not before idle if idle comes first, never later than this.
 */
export function runWhenIdle(task: () => void, timeoutMs = 4000): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(handle);
}
