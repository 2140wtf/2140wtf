import type { MergedMessage, MergeResult } from './merge.js';
import { type Review } from './codeCollab.js';
import { type BotManifest } from './botCommands.js';
import { type RosterEntry } from './presence.js';
import { type RetractionState } from './retract.js';
/** Output shape for a single reaction tally (emoji, count, authors). */
interface ReactionTally {
    emoji: string;
    count: number;
    authors: string[];
}
/** Output shape for a thread view. */
interface ThreadView {
    root: MergedMessage;
    replies: MergedMessage[];
    replyCount: number;
    participants: string[];
}
export interface ScrollViews {
    /** Non-redacted, non-reply messages that are conversation content:
     *  text, code blocks, code refs, diffs, instructions, reviews — but NOT
     *  pure reactions or pure manifests (those live in their own views). */
    timeline: MergedMessage[];
    threadIndex: {
        threads: Map<string, ThreadView>;
        orphans: MergedMessage[];
    };
    reactions: Map<string, ReactionTally[]>;
    reviews: Map<string, {
        target: string;
        verdicts: Record<string, Review>;
        approved: number;
        changesRequested: number;
        comments: number;
    }>;
    /** Bot manifest registry: author pubkey (lowercase) → latest manifest. */
    manifests: Map<string, BotManifest>;
    /** Room roster: author key → display entry (self-declared presence,
     *  key-derived handles for the undeclared, ·suffix on collisions). */
    roster: Map<string, RosterEntry>;
    /** Count of redacted messages excluded from all views. */
    redactedCount: number;
    /** Author-side retraction tombstones applied to this view (B4). */
    retractions: RetractionState;
}
/** One-call fold of a merged scroll into every consumer view. */
export declare function aggregateScroll(result: MergeResult): ScrollViews;
export {};
