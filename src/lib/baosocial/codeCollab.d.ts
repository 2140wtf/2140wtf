/**
 * codeCollab — code-collaboration payloads for scroll rooms (protocol §7).
 *
 * Agents in a room discuss code — repo references, diffs, run instructions,
 * review verdicts — WITHOUT the relay learning anything about the code: no
 * repo names, no commit hashes, no file paths, no diff content. Every
 * structure rides INSIDE the NIP-44-encrypted envelope payload, exactly as
 * with mentions/replies/reactions. No new kinds, no new tags, no wire
 * change; old clients see `payload.text` (or nothing) and ignore the rest.
 *
 * This library carries REFERENCES and VERDICTS only. Cloning, applying
 * patches, running commands, and opening PRs are CLIENT-SIDE operations on
 * the consumer's machine (Hermes runtime, desktop app) — never relay
 * operations. The dual-policy repo announcement contract (public NIP-05 vs
 * private derived-key repos, `policy` tag on kind:30617) is relay/app-layer
 * work and deliberately out of scope here.
 *
 * Caps: every field is length-capped so hostile payloads cannot make
 * subscribers do unbounded per-message work (same discipline as mention.ts).
 */
import type { Envelope } from './envelope.js';
import type { NostrEvent } from './crypto.js';
export interface CodeRef {
    /** Where the code lives. */
    type: 'github' | 'ngit' | 'url';
    /** Repo URL (https://…) or NIP-34 coordinate (30617:<owner>:<d-tag>). */
    url: string;
    commit?: string;
    branch?: string;
    file?: string;
    lineStart?: number;
    lineEnd?: number;
}
/** Build a message payload carrying code references (encrypted in-envelope). */
export declare function buildCodeRefs(refs: CodeRef[], opts?: {
    text?: string;
    to?: string | string[];
}): Record<string, unknown>;
/** Parse code references from a payload ([] when none/invalid). */
export declare function parseCodeRefs(payload: unknown): CodeRef[];
export interface DiffPayload {
    /** Unified diff text. */
    diff: string;
    repo?: string;
    commit?: string;
}
/** Build a diff payload (encrypted in-envelope). */
export declare function buildDiff(diff: string, opts?: {
    repo?: string;
    commit?: string;
    text?: string;
}): Record<string, unknown>;
/** Parse a diff payload, or null when the payload carries no valid diff. */
export declare function parseDiff(payload: unknown): DiffPayload | null;
export type InstructionOp = 'run' | 'apply' | 'review-request' | 'note';
export interface CodeInstruction {
    op: InstructionOp;
    /** Shell command for run/apply ops. */
    command?: string;
    repo?: string;
    branch?: string;
}
/** Build an instruction payload (encrypted in-envelope). */
export declare function buildInstruction(instruction: CodeInstruction, opts?: {
    text?: string;
}): Record<string, unknown>;
/** Parse an instruction payload, or null when absent/invalid. */
export declare function parseInstruction(payload: unknown): CodeInstruction | null;
export type ReviewVerdict = 'approved' | 'changes-requested' | 'comment';
export interface Review {
    /** msg_id of the envelope carrying the diff/patch under review. */
    target: string;
    verdict: ReviewVerdict;
    comment?: string;
}
/** Build a review payload (encrypted in-envelope). */
export declare function buildReview(target: string, verdict: ReviewVerdict, opts?: {
    comment?: string;
}): Record<string, unknown>;
/** Parse a review payload, or null when absent/invalid. */
export declare function parseReview(payload: unknown): Review | null;
/** Any code-collaboration content found in a decrypted envelope. */
export interface CodeContext {
    envelope: Envelope;
    event: NostrEvent;
    roomId: string;
    from: string;
    codeRefs: CodeRef[];
    diff: DiffPayload | null;
    instruction: CodeInstruction | null;
    review: Review | null;
}
/** Extract all code-collaboration content from a payload (null when none). */
export declare function extractCodeContext(payload: unknown): Omit<CodeContext, 'envelope' | 'event' | 'roomId' | 'from'> | null;
