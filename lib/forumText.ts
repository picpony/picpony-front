import { bbcodeToPlainText, IMAGE_MARKER } from '@/lib/bbcode';
import type { ForumPost } from '@/lib/types/forum';

/**
 * The words of a post for the places that show a line of it: the list row's teaser, a share
 * link's description. The author's 简介 when they wrote one; otherwise the body's own words —
 * a commission's description, a tag-group share's description and what it shares — as the
 * original front end derived them.
 */
export function forumTeaser(
  post: Pick<
    ForumPost,
    'excerpt' | 'content' | 'category' | 'title' | 'commission_link' | 'shared_groups' | 'shared_group_counts' | 'summary'
  >,
  maxLength = 120,
): string {
  const excerpt = post.excerpt.trim();
  if (excerpt) return bbcodeToPlainText(excerpt, { maxLength });
  const truncated = Boolean(post.summary);
  if (post.category === 'taggroups') {
    const tagCount = post.shared_group_counts?.tagGroups ?? post.shared_groups?.tagGroups.length ?? 0;
    const blockCount = post.shared_group_counts?.blockGroups ?? post.shared_groups?.blockGroups.length ?? 0;
    const parts = [
      tagCount > 0 ? `${tagCount} 个标签组` : '',
      blockCount > 0 ? `${blockCount} 个屏蔽组` : '',
    ].filter(Boolean);
    const lead = post.content.trim().replace(/\s+/g, ' ');
    const summary = parts.length > 0 ? `分享了 ${parts.join('、')}` : '';
    return [lead, summary].filter(Boolean).join(' · ') || post.title;
  }
  if (post.category === 'commission') {
    const words = bbcodeToPlainText(post.content, { maxLength, images: 'drop', truncated });
    if (words) return words;
    return post.commission_link ? '附有约稿链接' : bbcodeToPlainText(post.content, { maxLength, truncated });
  }
  /* Pictures are left out of a teaser — unless they are all it has. */
  return (
    bbcodeToPlainText(post.content, { maxLength, images: 'drop', truncated }) ||
    bbcodeToPlainText(post.content, { maxLength, truncated })
  );
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
