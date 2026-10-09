/**
 * A backend yes/no, read one way everywhere (review P6-O8). PicPony's PHP answers 0/1 integers
 * today (measured: `active`, `email_verified`, `api_accel_banned`), but a driver or a column
 * change can make them strings, and a bare truthiness test reads `"0"` as yes — a link shown as
 * 生效中, a user as 已封禁. Only `true`, `1`, `"1"` and `"true"` are yes.
 */
export function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}
