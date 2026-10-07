'use client';

import { LS_KEYS } from '@/lib/constants';
import { htmlToBBCode } from '@/lib/bbcode';
import { categoryOf } from '@/lib/forumModel';
import { isBlankRichText } from '@/lib/forumText';
import type { ForumCategory } from '@/lib/types/forum';

/**
 * A forum post being written, kept on this device so a reload, a closed tab or a slip of the
 * drawer does not lose it (R6-042). One per account and per post — a new post, or an edit to a
 * given one — so two accounts on one browser never see each other's words.
 *
 * The original front end kept one draft under `forum_post_draft`, its body as the editor's HTML;
 * the first account to open the composer here adopts it (converted to BBCode) and the old key is
 * removed, so it is adopted exactly once.
 */

export interface ForumDraft {
  title: string;
  excerpt: string;
  category: ForumCategory;
  /** BBCode, as the editor writes it. */
  content: string;
  commissionLink: string;
  /** A tag-group share's note — plain text, as the original took it. */
  groupsDescription: string;
  /** The groups chosen to share: `tag:<id>` / `block:<id>` for the writer's own, `kept-tag:<n>` /
   *  `kept-block:<n>` for those an edited post already shares. */
  groups: string[];
  /** The uploaded cover's stored path. */
  cover: string | null;
  /** Without a cover, the post's first picture stands in (the original front end's switch). */
  firstImageAsCover: boolean;
  /** Every picture uploaded while writing — the post's `draft_images`. */
  images: string[];
}

export interface SavedDraft extends ForumDraft {
  savedAt: number;
}

export const EMPTY_DRAFT: ForumDraft = {
  title: '',
  excerpt: '',
  category: 'discussion',
  content: '',
  commissionLink: '',
  groupsDescription: '',
  groups: [],
  cover: null,
  firstImageAsCover: true,
  images: [],
};

const keyOf = (userId: string, postId: number | null) => `${LS_KEYS.forumDraft}:${userId}:${postId ?? 'new'}`;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];

/** Whether a draft holds nothing worth keeping. */
export function isEmptyDraft(draft: ForumDraft): boolean {
  return (
    !draft.title.trim() &&
    !draft.excerpt.trim() &&
    isBlankRichText(draft.content) &&
    !draft.commissionLink.trim() &&
    !draft.groupsDescription.trim() &&
    draft.groups.length === 0 &&
    draft.cover === null
  );
}

function parse(raw: string | null): SavedDraft | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const draft: SavedDraft = {
      title: text(record.title),
      excerpt: text(record.excerpt),
      category: categoryOf(record.category),
      content: text(record.content),
      commissionLink: text(record.commissionLink),
      groupsDescription: text(record.groupsDescription),
      groups: strings(record.groups),
      cover: text(record.cover) || null,
      firstImageAsCover: record.firstImageAsCover !== false,
      images: strings(record.images),
      savedAt: Number.isFinite(Number(record.savedAt)) ? Number(record.savedAt) : Date.now(),
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

/** The original front end's draft, in this draft's shape; `null` when there is none worth keeping. */
function legacyDraft(): SavedDraft | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LS_KEYS.forumDraft);
  } catch {
    return null;
  }
  if (!raw) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const html = text(data.content);
  let content = '';
  try {
    content = html && html !== '<p><br></p>' ? htmlToBBCode(html) : '';
  } catch {
    /* No document to read the HTML with: the rest of the draft is still worth having. */
  }
  const draft: SavedDraft = {
    ...EMPTY_DRAFT,
    title: text(data.title),
    excerpt: text(data.excerpt),
    category: categoryOf(data.category),
    content,
    commissionLink: text(data.commissionLink),
    groupsDescription: text(data.taggroupsDescription),
    images: strings(data.draftImages),
    savedAt: Date.now(),
  };
  return isEmptyDraft(draft) ? null : draft;
}

/**
 * The draft for a new post (`postId` null) or an edit, if there is one. A new post's first read
 * adopts the original front end's draft when this account has none of its own — written under
 * this account first, and only then removed from the old key, so a refused write loses nothing.
 */
export function readDraft(userId: string, postId: number | null): SavedDraft | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(keyOf(userId, postId));
  } catch {
    return null;
  }
  const own = parse(raw);
  if (own || postId !== null) return own;
  const legacy = legacyDraft();
  if (!legacy) return null;
  writeDraft(userId, null, legacy);
  try {
    if (localStorage.getItem(keyOf(userId, null)) !== null) localStorage.removeItem(LS_KEYS.forumDraft);
  } catch {
    /* Kept where it was: the next visit adopts it again. */
  }
  return legacy;
}

/** Saves a draft; an empty one is removed instead. Storage that refuses is not an error here. */
export function writeDraft(userId: string, postId: number | null, draft: ForumDraft) {
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(keyOf(userId, postId));
    else localStorage.setItem(keyOf(userId, postId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* Private mode or a full quota: the words are still on screen. */
  }
}

export function clearDraft(userId: string, postId: number | null) {
  try {
    localStorage.removeItem(keyOf(userId, postId));
  } catch {
    /* Nothing to clear. */
  }
}
