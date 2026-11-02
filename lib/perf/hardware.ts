/**
 * What the browser will say about the hardware under a /perf run. No web API names the CPU: the
 * closest are the GPU the page renders on (WebGL's unmasked renderer, WebGPU's adapter info) and,
 * on Android Chromium, the phone's model number (UA Client Hints). A phone's GPU names its SoC, so
 * the report adds that as a guess, marked as one. Anything the browser withholds stays `null`;
 * the tester's own 设备备注 on /perf fills the rest (a desktop CPU, mostly).
 */

export type PerfHardware = {
  /** The GPU as WebGL reports it, trimmed of ANGLE's wrapping: `AMD Radeon RX 6500 XT`. */
  gpu: string | null;
  /** The renderer string exactly as the browser gave it, for anything the trim lost. */
  gpuRaw: string | null;
  /** WebGPU's adapter: vendor and architecture (`amd · rdna-2`), when the browser has WebGPU. */
  gpuAdapter: string | null;
  /** The device model from UA Client Hints (`2510DRK44C`); Android Chromium only. */
  model: string | null;
  /** OS version and CPU architecture from UA Client Hints (`Windows 15.0.0 · x86 64-bit`). */
  os: string | null;
  /** The phone SoC the GPU implies (`骁龙 8 至尊版（推测）`), or null when it implies none. */
  socGuess: string | null;
};

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);

/** `ANGLE (AMD, AMD Radeon RX 6500 XT (0x0000743F) Direct3D11 vs_5_0 ps_5_0, D3D11)` → the model. */
export function cleanRenderer(raw: string) {
  let text = raw.trim();
  const angle = /^ANGLE \((.*)\)$/.exec(text);
  if (angle) {
    const parts = angle[1].split(',').map((part) => part.trim());
    text = parts.length >= 2 ? parts[1] : parts[0];
  }
  return (
    text
      .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
      .replace(/\s+(Direct3D|OpenGL|Vulkan|Metal).*$/i, '')
      .replace(/\s*\(TM\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || raw
  );
}

/** Adreno numbers map one-to-one onto Snapdragon flagships; other GPUs ship in many SoCs. */
const ADRENO_SOC: Record<string, string> = {
  '840': '骁龙 8 至尊版 第五代',
  '830': '骁龙 8 至尊版',
  '750': '骁龙 8 第三代',
  '735': '骁龙 8s 第三代',
  '740': '骁龙 8 第二代',
  '730': '骁龙 8 第一代 / 8+ 第一代',
  '725': '骁龙 7+ 第二代',
  '660': '骁龙 888',
  '650': '骁龙 865',
  '640': '骁龙 855',
};

export function socFromGpu(gpu: string | null) {
  if (!gpu) return null;
  const adreno = /Adreno\D*(\d{3})/i.exec(gpu);
  if (adreno && ADRENO_SOC[adreno[1]]) return `${ADRENO_SOC[adreno[1]]}（推测）`;
  if (/^Apple (M\d|A\d)/i.test(gpu)) return `${gpu}（推测）`;
  return null;
}

function webglRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    /* Firefox and newer Chromium answer RENDERER itself with the unmasked (sanitized) name. */
    const raw = String(
      (info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return raw || null;
  } catch {
    return null;
  }
}

type GpuAdapterInfo = {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
};
type GpuNavigator = Navigator & {
  gpu?: { requestAdapter(): Promise<{ info?: GpuAdapterInfo } | null> };
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
  };
};

async function webgpuAdapter() {
  const nav = navigator as GpuNavigator;
  if (!nav.gpu) return null;
  try {
    const adapter = await withTimeout(nav.gpu.requestAdapter(), 1500);
    const info = adapter?.info;
    if (!info) return null;
    const parts = [info.vendor, info.architecture, info.description || info.device].filter(
      (part): part is string => !!part,
    );
    return parts.length ? parts.join(' · ') : null;
  } catch {
    return null;
  }
}

async function clientHints() {
  const nav = navigator as GpuNavigator;
  if (!nav.userAgentData?.getHighEntropyValues) return { model: null, os: null };
  try {
    const hints = await withTimeout(
      nav.userAgentData.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
      ]),
      1500,
    );
    if (!hints) return { model: null, os: null };
    const str = (key: string) => (typeof hints[key] === 'string' ? (hints[key] as string) : '');
    const os = [
      [str('platform'), str('platformVersion')].filter(Boolean).join(' '),
      [str('architecture'), str('bitness') && `${str('bitness')}-bit`].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(' · ');
    return { model: str('model') || null, os: os || null };
  } catch {
    return { model: null, os: null };
  }
}

export async function collectHardware(): Promise<PerfHardware> {
  const gpuRaw = webglRenderer();
  const gpu = gpuRaw ? cleanRenderer(gpuRaw) : null;
  const [gpuAdapter, hints] = await Promise.all([webgpuAdapter(), clientHints()]);
  return { gpu, gpuRaw, gpuAdapter, model: hints.model, os: hints.os, socGuess: socFromGpu(gpu) };
}
