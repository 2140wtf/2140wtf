import { useNostr } from '@nostrify/react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type AuthorResult, authorQueryOptions } from '@/hooks/useAuthor';
import { useEventStore } from '@/hooks/useEventStore';

import type { NostrEvent } from '@nostrify/nostrify';

/** Lowercase 64-char hex pubkey. */
const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Non-notifying mention tag (mirrors Buzz's reference-only mention). Treated
 * the same as a `p` tag for resolving `@name` text back to a pubkey.
 */
const MENTION_REFERENCE_TAG = 'mention';

/** Resolved `@name` → pubkey mapping for an event, plus a matcher regex. */
export interface MentionNameMap {
  /** Lowercased profile alias → hex pubkey. */
  byName: Map<string, string>;
  /** Regex matching any known `@alias` in text, or null when there are none. */
  regex: RegExp | null;
}

const EMPTY: MentionNameMap = { byName: new Map(), regex: null };

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every name a profile could be `@`-mentioned by: kind-0 `display_name`,
 * `name`, and the local part of a NIP-05 identifier. Mirrors Buzz, which
 * emits all aliases so a rendered chip always resolves to a pubkey.
 */
function aliasesFor(data: AuthorResult | undefined): string[] {
  const md = data?.metadata;
  if (!md) return [];
  const out: string[] = [];
  const push = (s: string | undefined) => {
    const t = s?.trim();
    if (t) out.push(t);
  };
  push(md.display_name);
  push(md.name);
  const nip05 = md.nip05?.trim();
  if (nip05) {
    // "_@domain" → root; else the local part before "@".
    push(nip05.startsWith('_@') ? nip05.slice(2) : nip05.split('@')[0]);
  }
  return out;
}

/**
 * Build a regex that matches a known `@alias` in body text. Aliases are sorted
 * longest-first so a multi-word / longer name wins over a shorter prefix, then
 * escaped and joined as alternatives. The `@` must not be preceded by a word
 * char, `@`, `.` or `/` (so emails / handles / paths don't match), and the
 * alias must be followed by a boundary. Returns null when there are no aliases.
 */
function buildMentionRegex(names: string[]): RegExp | null {
  const valid = names.filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  if (valid.length === 0) return null;
  const alts = valid.map(escapeRegExp).join('|');
  return new RegExp(`(?<![\\w@./])@(${alts})(?=[\\s,;.!?:)\\]}'"]|$)`, 'giu');
}

/**
 * Resolve the profiles an event `p`-tags (or non-notifying `mention`-tags) into
 * a `@name` → pubkey map so plain-text mentions can be linkified.
 *
 * Clients like Buzz store a mention as literal `@displayName` text in the body
 * with the identity binding living only in a `["p", <hex>]` tag — the two
 * halves must be re-married at render time. This hook resolves each tagged
 * pubkey's kind-0 profile (sharing {@link useAuthor}'s cache), collects its
 * aliases, and returns a matcher restricted to those known names, so an
 * arbitrary `@word` without a corresponding tag is never linkified.
 */
export function useMentionNameMap(event: NostrEvent): MentionNameMap {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const eventStore = useEventStore();

  const pubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const tag of event.tags) {
      if ((tag[0] === 'p' || tag[0] === MENTION_REFERENCE_TAG) && tag[1] && HEX64.test(tag[1])) {
        set.add(tag[1].toLowerCase());
      }
    }
    return [...set];
  }, [event.tags]);

  const results = useQueries({
    queries: pubkeys.map((pk) => authorQueryOptions(nostr, queryClient, eventStore, pk)),
  });

  // Stable serialization of resolved aliases: the returned map/regex identity
  // only changes when the resolved names actually change, keeping downstream
  // token memos from re-running on every render as query objects churn.
  const aliasKey = pubkeys
    .map((pk, i) => `${pk}:${aliasesFor(results[i]?.data).join('\u0000')}`)
    .join('|');

  return useMemo(() => {
    if (pubkeys.length === 0) return EMPTY;
    const byName = new Map<string, string>();
    pubkeys.forEach((pk, i) => {
      for (const alias of aliasesFor(results[i]?.data)) {
        const key = alias.toLowerCase();
        // First writer wins so a name shared by two members stays deterministic.
        if (!byName.has(key)) byName.set(key, pk);
      }
    });
    if (byName.size === 0) return EMPTY;
    return { byName, regex: buildMentionRegex([...byName.keys()]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aliasKey]);
}
