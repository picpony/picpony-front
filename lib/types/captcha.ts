/** A slider challenge (`POST /auth/challenges` → `challenge`, `src/pg/challenge.rs`). The target x stays on the server. */
export interface CaptchaChallenge {
  id: string;
  kind: 'slider';
  /** PNG data URLs. */
  background: string;
  piece: string;
  /** The piece's top edge, in the challenge's own canvas units. */
  y: number;
  width: number;
  height: number;
  piece_width: number;
  piece_height: number;
  expires_in: number;
}

/** One sample of the drag: canvas units, `t` in milliseconds since the drag began. */
export interface CaptchaPoint {
  x: number;
  y: number;
  t: number;
}

/** A solved challenge: the single-use `proof` a login, a registration, a resend or a reset carries. */
export interface CaptchaProof {
  proof: string;
  expires_in: number;
}
