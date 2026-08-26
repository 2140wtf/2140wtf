/**
 * presence — self-declared, in-room display identity (protocol §7).
 *
 * Rooms have no global identity registry (that would be a metadata leak):
 * authors are per-room keys. Presence lets a member claim a display name
 * INSIDE the encrypted scroll — {presence:{name,color?}} — so other members
 * can render "@alice" instead of a key prefix. It is a display hint only:
 * never a routing or auth input, never on the wire, and foldable from the
 * scroll like every other payload (latest-in-scroll per author wins).
 *
 * Name collisions resolve WITHOUT a registry: when two live roster entries
 * share a name, clients disambiguate with the author's key suffix —
 * "@alice·3f2a" — derived from the room author key, stable for the room.
 */
import type { MergedMessage } from './merge.js';
export interface Presence {
    name: string;
    color?: string;
}
/** Build a presence payload (encrypted in-envelope, like every §7 structure). */
export declare function buildPresence(name: string, opts?: {
    color?: string;
}): Record<string, unknown>;
/** Parse a presence payload, or null when absent/invalid. */
export declare function parsePresence(payload: unknown): Presence | null;
export interface RosterEntry {
    /** Room author key (the mention target). */
    author: string;
    name: string;
    color?: string;
    /** Display handle: bare name, or name·suffix when the name collides. */
    handle: string;
}
/**
 * Fold the room roster from a merged scroll: latest presence per author
 * (scroll order wins), redacted excluded. Authors without a presence get a
 * key-derived handle so every speaker is addressable.
 */
export declare function foldRoster(messages: MergedMessage[]): Map<string, RosterEntry>;
/**
 * Resolve @handles in display text to roster author keys. Case-insensitive,
 * non-overlapping leftmost-longest (so "@alice·3f2a" routes to the
 * disambiguated author, not plain @alice). Returns the deduped `to` list
 * for payload routing — the text itself is left untouched for display.
 */
export declare function resolveMentions(text: string, roster: Map<string, RosterEntry>): string[];
/** Split display text into segments for chip rendering. */
export interface TextSegment {
    kind: 'text' | 'mention';
    text: string;
    /** Set on mention segments: the resolved roster entry. */
    entry?: RosterEntry;
}
export declare function segmentMentions(text: string, roster: Map<string, RosterEntry>): TextSegment[];
/**
 * Autocomplete source: roster entries whose handle starts with the fragment
 * after the last "@" in the composer text. Returns [] when the caret is not
 * in a mention context.
 */
export declare function autocompleteMentions(composerText: string, roster: Map<string, RosterEntry>): RosterEntry[];
