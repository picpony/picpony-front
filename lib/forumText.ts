import { bbcodeToPlainText, IMAGE_MARKER } from '@/lib/bbcode';
import { parseCommission, parseSharedGroups } from '@/lib/api/forum';
import type { ForumPost } from '@/lib/types/forum';

/**
 * The words of a post for the places that show a line of it: the list row's teaser, a share
 * link's description. The author's 简介 when they wrote one; otherwise the body's own words —
 * a commission's description, a tag-group share's description and what it shares — as the
 * original front end derived them.
 */
export function forumTeaser(post: Pick<ForumPost, 'excerpt' | 'content' | 'category' | 'title'>, maxLength = 120): string {
  const excerpt = post.excerpt.trim();
  if (excerpt) return bbcodeToPlainText(excerpt, { maxLength });
  if (post.category === 'taggroups') {
    const shared = parseSharedGroups(post.content);
    if (shared) {
      const parts = [
        shared.tagGroups.length > 0 ? `${shared.tagGroups.length} 个标签组` : '',
        shared.blockGroups.length > 0 ? `${shared.blockGroups.length} 个屏蔽组` : '',
      ].filter(Boolean);
      const lead = shared.description.trim().replace(/\s+/g, ' ');
      const summary = parts.length > 0 ? `分享了 ${parts.join('、')}` : '';
      return [lead, summary].filter(Boolean).join(' · ') || post.title;
    }
  }
  if (post.category === 'commission') {
    const commission = parseCommission(post.content);
    if (commission) {
      const words = bbcodeToPlainText(commission.description, { maxLength, images: 'drop' });
      if (words) return words;
      return commission.link ? '附有约稿链接' : bbcodeToPlainText(commission.description, { maxLength });
    }
  }
  /* Pictures are left out of a teaser — unless they are all it has. */
  return bbcodeToPlainText(post.content, { maxLength, images: 'drop' }) || bbcodeToPlainText(post.content, { maxLength });
}

/** How long a quoted reply may be — the original front end's cut, now between characters. */
export const QUOTE_LENGTH = 100;

/**
 * The quote a reply opens with, built from the words of the reply it answers (R6-031): the
 * source's own tags never reach it, so a quoted picture is 「[图片]」 rather than the picture
 * again, and the cut can no longer leave a tag open. A quote inside the quoted reply is left out,
 * so a chain of replies does not nest.
 */
export function replyQuote(username: string, content: string): string {
  const words = bbcodeToPlainText(content, { maxLength: QUOTE_LENGTH }) || IMAGE_MARKER;
  /* The attribution is the tag's parameter: nothing in it may end the tag. */
  const who = username.replace(/["\]\n]/g, '').trim();
  return `[quote="${who}"]\n${words}\n[/quote]\n\n`;
}

/**
 * Whether the editor's output says nothing: no words and no picture. The editor leaves empty
 * paragraphs behind when everything is deleted, so an emptiness check on the string is wrong.
 */
export function isBlankRichText(bbcode: string): boolean {
  return bbcodeToPlainText(bbcode).trim() === '';
}
