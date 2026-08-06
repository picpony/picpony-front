/**
 * Roles, their display names, and the badge they render as.
 *
 * The admin user table and the public profile page each carried their own copy
 * of this, and they had drifted: `super_admin` showed as 超管 in the table and
 * 创始人 on the profile, with unrelated colours. One definition means the badge
 * beside a username is the same badge wherever you meet that user.
 *
 * Colours come from the categorical accent scale rather than error/warning —
 * being an admin is a category, not a severity. See the accent block in
 * app/globals.css.
 */
export type Role = 'super_admin' | 'admin' | 'editor' | 'user';

interface RoleInfo {
  label: string;
  /** Container + ink pair; safe to drop straight onto a chip. */
  chip: string;
}

const ROLES: Record<Role, RoleInfo> = {
  super_admin: { label: '创始人', chip: 'bg-accent-purple text-on-accent-purple' },
  admin: { label: '管理员', chip: 'bg-accent-indigo text-on-accent-indigo' },
  editor: { label: '小编', chip: 'bg-accent-blue text-on-accent-blue' },
  user: { label: '普通用户', chip: 'bg-surface-container-high text-on-surface-variant' },
};

/** Roles that can reach the admin panel. */
export const STAFF_ROLES: readonly Role[] = ['editor', 'admin', 'super_admin'];

export function roleInfo(role: string | undefined | null): RoleInfo {
  if (!role) return ROLES.user;
  return ROLES[role.toLowerCase() as Role] ?? ROLES.user;
}

export function isStaff(role: string | undefined | null): boolean {
  return STAFF_ROLES.includes(String(role).toLowerCase() as Role);
}
