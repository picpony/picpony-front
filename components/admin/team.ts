/**
 * The team form's rules as plain functions — what a save sends, and how a member's card links —
 * held to the backend's contract (`POST /admin/team-members`, `PUT /admin/team-members/{id}`,
 * both with the roster's `expected_revision`):
 *
 *   member { name, role, category, avatar_url, link_url, order_num (32-bit), user_id | null }
 *
 * **A member is linked by binding an account** (R9-022): 关联站内用户 ID sets `user_id`, which is the
 * binding (/about shows the account's current avatar and links its profile from it). The backend
 * accepts only an http(s) address in `link_url` — the old `user:<id>` pseudo-link is refused — so a
 * bound member saves an empty `link_url`. A stored external link is kept as it is while no account
 * is bound — it was somebody's data — and is dropped only by binding one.
 */

import { roleInfo, type Role } from '@/lib/roles';
import type { AdminTeamMember, TeamMemberBody } from '@/lib/api/admin';

export type TeamCategory = 'developer' | 'manager' | 'editor' | 'special';

export const TEAM_CATEGORIES: { value: TeamCategory; label: string }[] = [
  { value: 'developer', label: '开发团队' },
  { value: 'manager', label: '管理团队' },
  { value: 'editor', label: '小编团队' },
  { value: 'special', label: '特别鸣谢' },
];

export type TeamMemberRow = AdminTeamMember;

export interface TeamFormValues {
  name: string;
  title: string;
  category: TeamCategory;
  userId: string;
  avatarUrl: string;
  order: string;
}

export type TeamFormErrors = Partial<Record<'name' | 'userId' | 'order', string>>;

function category(value: unknown): TeamCategory {
  return TEAM_CATEGORIES.some((option) => option.value === value) ? (value as TeamCategory) : 'special';
}

/** A positive account id, or 0 for none. */
export function boundUser(value: unknown): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function teamForm(member?: TeamMemberRow | null): TeamFormValues {
  if (!member) return { name: '', title: '', category: 'developer', userId: '', avatarUrl: '', order: '0' };
  const uid = boundUser(member.user_id);
  return {
    name: member.name ?? '',
    title: member.role ?? '',
    category: category(member.category),
    userId: uid ? String(uid) : '',
    avatarUrl: member.avatar_url ?? '',
    order: String(member.order_num),
  };
}

/** A stored link that is not an account link — somebody's homepage the form does not edit. */
export function externalLink(link: string | null | undefined): string | null {
  const value = (link ?? '').trim();
  return value && !value.startsWith('user:') ? value : null;
}

/** The card's stored link for a member bound to `userId` (0 for none): a binding needs none. */
export function linkFor(userId: number, stored: string | null | undefined): string {
  if (userId) return '';
  return externalLink(stored) ?? '';
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** The save's body, or the fields' errors. */
export function teamPayload(
  values: TeamFormValues,
  member?: TeamMemberRow | null,
): { payload: TeamMemberBody; errors?: undefined } | { payload?: undefined; errors: TeamFormErrors } {
  const errors: TeamFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = '请填写成员姓名';
  const uidText = values.userId.trim();
  const userId = boundUser(uidText);
  if (uidText && (!/^\d+$/.test(uidText) || !userId)) errors.userId = '站内用户 ID 须为正整数';
  const orderText = values.order.trim();
  /* And one the column holds (review P6-O10): the backend stores a 32-bit integer. */
  if (orderText && (!/^-?\d+$/.test(orderText) || Number(orderText) < INT32_MIN || Number(orderText) > INT32_MAX)) errors.order = '排序号须为 -2147483648～2147483647 的整数';
  if (Object.keys(errors).length > 0) return { errors };
  const payload: TeamMemberBody = {
    name,
    role: values.title.trim(),
    category: values.category,
    user_id: userId || null,
    avatar_url: values.avatarUrl.trim(),
    link_url: linkFor(userId, member?.link_url),
    order_num: orderText ? Number(orderText) : 0,
  };
  return { payload };
}

/** A title and a column suggested by an account's role — the original console's 快捷导入. */
export function suggestion(role: unknown): { title: string; category: TeamCategory } {
  const value = typeof role === 'string' ? role : '';
  if (value === 'super_admin' || value === 'admin' || value === 'editor') {
    const category: TeamCategory = value === 'super_admin' ? 'developer' : value === 'admin' ? 'manager' : 'editor';
    return { title: roleInfo(value as Role).label, category };
  }
  return { title: '社区成员', category: 'special' };
}
