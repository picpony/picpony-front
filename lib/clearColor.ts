import { Hct, hexFromArgb } from '@material/material-color-utilities';

export type ClearColorRegister = 'light' | 'deep';

/**
 * Direction A's two registers, as the numbers rather than as two literals inside one expression:
 * a 明清色 (a tint — a pure hue plus white) sits all but on the gamut's edge and is capped so a
 * large area never shouts; a 暗清色 (a shade — a pure hue plus black) keeps a little more room and
 * a higher cap, because at a low tone the gamut is wide and the edge itself is loud.
 *
 * Exported because the shade's share is what tells a *container* whether it is a shade or a greyed
 * tone — `deepSecondChroma` in `lib/paletteRule.ts` reads it rather than restating 0.72.
 */
export const CLEAR_REGISTERS = {
  light: { share: 0.96, cap: 36 },
  deep: { share: 0.72, cap: 48 },
} as const;

/** Direction A's large-area chroma at a hue and tone: the register's share of what sRGB holds. */
export function clearChromaAt(hue: number, tone: number, register: ClearColorRegister): number {
  const ceiling = Hct.from(hue, 200, tone).chroma;
  const { share, cap } = CLEAR_REGISTERS[register];
  return Math.min(cap, ceiling * share);
}

/** Direction A's large-area chroma, at a tone chosen for the image or character. */
export function clearColorAt(hue: number, tone: number, register: ClearColorRegister): string {
  return hexFromArgb(Hct.from(hue, clearChromaAt(hue, tone, register), tone).toInt()).toLowerCase();
}
