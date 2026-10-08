'use client';

import { useEffect, useState } from 'react';
import { LS_KEYS } from '@/lib/constants';
import { useSyncedSetting } from '@/lib/settingsSync';
import { loadTagTranslations, peekTagTranslations, tagTranslationKey } from '@/lib/tagTranslations';

/**
 * How long a name may be waited for before the tag shows as itself. The dictionary normally
 * answers in a few hundred milliseconds; one that has not by now is slow or down, and a
 * placeholder must not stand in for a name for the read's whole deadline. A late answer still
 * arrives and replaces the tag.
 */
const NAME_WAIT_MS = 1200;

/** 显示中文标签, read at event time — `useSyncedSetting`'s own rule (on unless switched off). */
export function chineseTagNamesShown(): boolean {
  try {
    return typeof window === 'undefined' || localStorage.getItem(LS_KEYS.showChineseTags) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Ask the dictionary for `tag`'s name now, so a surface about to show it has it on its first
 * render (`peekTagTranslations`). Only when the names are shown at all: a lookup nothing will
 * display is a request the screen would not have made. Never rejects.
 */
export function warmTagName(tag: string): Promise<void> {
  if (!chineseTagNamesShown()) return Promise.resolve();
  return loadTagTranslations([tag]).then(() => {}, () => {});
}

/** What one screen knows about the names of its tags, for `tagNameOf`. */
export interface TagNameKnowledge {
  /** 显示中文标签. */
  enabled: boolean;
  /** Fresh cache entries for the tags now listed (`peekTagTranslations`), by translation key. */
  peeked: Record<string, string | null>;
  /** Every answer this screen has had, by translation key — kept as tags come and go. */
  answers: Record<string, string | null>;
  /** Translation keys whose wait ran out before their answer came. */
  waited: ReadonlySet<string>;
}

function own(record: Record<string, string | null>, key: string): string | null | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * One tag's slot: its name; `null` to show the tag itself (the names are off, the dictionary has
 * none, or the wait ran out); `undefined` while it is still being asked for. Pure, for the tests.
 *
 * An answer, once had, is kept: a row on its way out of the list, or one that stays while another
 * arrives, goes on saying what it said. Re-asked whenever the list changed, a leaving row's tag
 * was no longer among the tags asked about and turned back into the English tag — or into a
 * placeholder, the last one — in the middle of its fade.
 */
export function tagNameOf(tag: string, known: TagNameKnowledge): string | null | undefined {
  if (!known.enabled) return null;
  const key = tagTranslationKey(tag);
  /* A cached miss (`null`) is an answer as much as a name is, so only an absent entry falls through. */
  const cached = own(known.peeked, key);
  const name = cached !== undefined ? cached : own(known.answers, key);
  if (name === undefined) return known.waited.has(key) ? null : undefined;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

const NOTHING_WAITED: ReadonlySet<string> = new Set();

/**
 * The dictionary's Chinese name for each tag, when 显示中文标签 is on (`showChineseTags`) — what a
 * subscription row and a subscription's heading lead with. Cached names paint at once
 * (`peekTagTranslations`); the rest arrive with one batched read. A tag the dictionary has no
 * name for reads as itself.
 *
 * The answer per tag is `tagNameOf`'s: a name, `null`, or `undefined` while it is still being
 * asked for — the slot is unknown, so a caller holds the name's place (a placeholder in its
 * geometry) rather than painting the tag and renaming it a moment later (M1-017). Asking ends at
 * `NAME_WAIT_MS`; a late answer still lands. Answers accumulate for as long as the screen is up.
 */
export function useTagNames(tags: readonly string[]): (tag: string) => string | null | undefined {
  const enabled = useSyncedSetting('showChineseTags');
  const key = tags.join('\n');
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [waited, setWaited] = useState(NOTHING_WAITED);
  /* A lookup in memory once the cache has been parsed, so it is simply read on every render. A
     cached miss ("the dictionary has none") is an answer too, so it is never waited for. */
  const peeked = enabled && tags.length > 0 ? peekTagTranslations(tags) : {};

  useEffect(() => {
    if (!enabled || key === '') return;
    let live = true;
    const asked = key.split('\n');
    const timer = window.setTimeout(() => {
      if (live) setWaited((previous) => new Set([...previous, ...asked.map(tagTranslationKey)]));
    }, NAME_WAIT_MS);
    void loadTagTranslations(asked).then((names) => {
      if (!live) return;
      window.clearTimeout(timer);
      setAnswers((previous) => ({ ...previous, ...names }));
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [enabled, key]);

  return (tag: string) => tagNameOf(tag, { enabled, peeked, answers, waited });
}
