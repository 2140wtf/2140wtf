/**
 * Orchestration primitives (AGENT_CHAT_ORCHESTRATION.md §7/§14) — pure
 * functions shared by the headless CLI, the MCP server, and (later) the UI
 * manifest renderer. The claim tie-break MUST live in exactly one place or
 * agents double-work: this is that place.
 *
 * Wire shapes:
 * - Manifest: PUBLIC parameterized-replaceable kind 30078, tags
 *   `["d", "orch-<id>"]`, `["t", "bao-orch"]`, content = JSON
 *   {orch, goal, roles, tasks[]} — public even for sealed communities (the
 *   manifest is coordination metadata, not community content).
 * - Task lifecycle: chat messages (sealed rumors inside a ₿AO — inner kind 9)
 *   tagged `["t", "orch-task"]` whose content starts with a verb:
 *     CLAIM <taskId> key=<idempotencyKey> epoch=<fencingEpoch>
 *     PROGRESS <taskId> <one line>
 *     HANDOFF <taskId> @<agent> <state summary>   (receiver must ACK)
 *     ACK <taskId>
 *     DONE <taskId> <artifact refs>
 *     BLOCKED <taskId> <reason> <need>
 *   Machines parse the tags + first word; the rest stays human-readable.
 *
 * Fencing (mosaico daemon-design, adapted): every CLAIM carries a fencing
 * epoch — the claimant's view of how many times the task has changed hands,
 * plus one. A CLAIM whose epoch doesn't match current-epoch + 1 is a
 * stale-view claim and is IGNORED (never half-succeed on a stale read): the
 * loser re-resolves and retries at the right epoch. Two agents reclaiming the
 * same stale claim publish the same epoch; the tie-break picks one, and the
 * other detects the loss by re-resolving (`held` in chat-core) instead of
 * double-working. Legacy CLAIMs without `epoch=` still claim (mixed fleet),
 * and also bump the epoch. PROGRESS/DONE/BLOCKED stay claimant-scoped WITHOUT
 * an epoch: resolution folds in ms order, so a zombie's late verb lands while
 * someone else holds the claim and is ignored — same-author cross-epoch
 * confusion can't survive the fold.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const ORCH_TASK_TAG = "orch-task";
export const ORCH_MANIFEST_TAG = "bao-orch";
export const ORCH_MANIFEST_KIND = 30078;

export type OrchVerb = "CLAIM" | "PROGRESS" | "HANDOFF" | "ACK" | "DONE" | "BLOCKED";

export interface TaskMessage {
  verb: OrchVerb;
  taskId: string;
  /** Everything after the taskId, verbatim (human-readable payload). */
  rest: string;
  /** CLAIM only: the `key=` idempotency token, if present. */
  idemKey?: string;
  /** CLAIM only: the `epoch=` fencing token, if present (absent = legacy). */
  epoch?: number;
}

const VERBS: readonly OrchVerb[] = ["CLAIM", "PROGRESS", "HANDOFF", "ACK", "DONE", "BLOCKED"];

/**
 * Parse a chat message into a task-lifecycle message. Requires the
 * `["t", "orch-task"]` tag AND a leading verb — either alone is not enough
 * (a human typing "DONE deal!" in a tagged thread is not a state change).
 */
export function parseTaskMessage(content: string, tags: string[][]): TaskMessage | null {
  if (!tags.some((t) => t[0] === "t" && t[1] === ORCH_TASK_TAG)) return null;
  const m = content.match(/^(\w+)\s+(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const verb = m[1].toUpperCase() as OrchVerb;
  if (!VERBS.includes(verb)) return null;
  const rest = (m[3] ?? "").trim();
  const keyMatch = rest.match(/(?:^|\s)key=(\S+)/);
  const epochMatch = rest.match(/(?:^|\s)epoch=(\d+)(?:\s|$)/);
  return {
    verb,
    taskId: m[2],
    rest,
    ...(verb === "CLAIM" && keyMatch ? { idemKey: keyMatch[1] } : {}),
    ...(verb === "CLAIM" && epochMatch ? { epoch: Number(epochMatch[1]) } : {}),
  };
}

/**
 * Deterministic idempotency key for a claim: a retrying agent re-publishes
 * the SAME claim event instead of racing itself (§14). The epoch salts the
 * key, so a re-claim after a stale takeover is a NEW key (not deduped against
 * the earlier claim) while a retry of the same epoch's claim stays idempotent.
 */
export function deriveClaimKey(orchId: string, taskId: string, epoch = 1): string {
  return bytesToHex(sha256(new TextEncoder().encode(`bao-orch:claim:${orchId}:${taskId}:${epoch}`))).slice(0, 32);
}

export interface ClaimInput {
  /** Message id (rumor id) — the tie-breaker. */
  id: string;
  author: string;
  /** Ordering timestamp, epoch ms. */
  ms: number;
  msg: TaskMessage;
}

export interface ClaimState {
  taskId: string;
  claimant: string;
  claimId: string;
  claimMs: number;
  /** Last PROGRESS ms from the claimant (claimMs if none yet). */
  lastProgressMs: number;
  /**
   * Fencing epoch: 1 for the first claim, +1 on every change of hands. An
   * executor must only act while its CLAIM's epoch is the state's current
   * epoch AND it is the claimant — that's the mosaico generation check.
   */
  epoch: number;
  done: boolean;
  blocked: boolean;
  /**
   * True after the claimant's HANDOFF: the claim is RELEASED — a fresh CLAIM
   * takes the task immediately (no TTL wait). Without this a handoff could
   * never complete: the receiver's CLAIM would lose to the handoff-er's own
   * live claim. Only the claimant can release.
   */
  released: boolean;
  /** True once the claim sat without PROGRESS past the TTL — reclaimable. */
  stale: boolean;
}

/**
 * Resolve who owns each task right now. THE shared tie-break (§14):
 * first valid CLAIM by timestamp, ties broken by lowest message id. A claim
 * with no PROGRESS from its claimant for `ttlMs` is STALE: it stays visible
 * but the next valid CLAIM takes the task (stale claims never win over a
 * fresh one). DONE/BLOCKED are terminal-state markers from the claimant only
 * (nobody can mark someone else's task done).
 *
 * Fencing: an epoch-bearing CLAIM is valid ONLY if its epoch is exactly
 * current-epoch + 1 (or 1 for a never-claimed task) — a mismatched CLAIM was
 * issued from a stale view and is ignored outright, so two concurrent
 * reclaimers can never both believe they won. Epoch-less legacy CLAIMs skip
 * the check but still bump the epoch.
 */
export function resolveClaims(
  messages: ClaimInput[],
  opts: { ttlMs: number; nowMs: number },
): Map<string, ClaimState> {
  const sorted = [...messages].sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const states = new Map<string, ClaimState>();

  for (const { id, author, ms, msg } of sorted) {
    const cur = states.get(msg.taskId);
    switch (msg.verb) {
      case "CLAIM": {
        // A fresh claim loses to a live claim, but takes over a stale/done/
        // released one.
        if (cur && !cur.stale && !cur.done && !cur.released) break;
        const nextEpoch = (cur?.epoch ?? 0) + 1;
        // Fencing: an epoch-bearing claim from a stale view is ignored, never
        // half-honored — its author re-resolves and retries at the right epoch.
        if (msg.epoch !== undefined && msg.epoch !== nextEpoch) break;
        states.set(msg.taskId, {
          taskId: msg.taskId,
          claimant: author,
          claimId: id,
          claimMs: ms,
          lastProgressMs: ms,
          epoch: nextEpoch,
          done: false,
          blocked: false,
          released: false,
          stale: opts.nowMs - ms > opts.ttlMs,
        });
        break;
      }
      case "PROGRESS": {
        if (cur && cur.claimant === author && !cur.done) {
          cur.lastProgressMs = ms;
          cur.stale = false;
          cur.blocked = false;
        }
        break;
      }
      case "DONE": {
        if (cur && cur.claimant === author) {
          cur.done = true;
          cur.blocked = false;
          cur.lastProgressMs = ms;
        }
        break;
      }
      case "BLOCKED": {
        if (cur && cur.claimant === author && !cur.done) {
          cur.blocked = true;
          cur.lastProgressMs = ms;
        }
        break;
      }
      case "HANDOFF": {
        // The claimant's HANDOFF releases the claim: the receiver (or anyone)
        // takes it with a fresh CLAIM at epoch+1 — explicit transfer still
        // ends with exactly one CLAIM winning, no second code path. A
        // bystander's HANDOFF is ignored (nobody releases another's task).
        if (cur && cur.claimant === author && !cur.done) {
          cur.released = true;
          cur.lastProgressMs = ms;
        }
        break;
      }
      case "ACK":
        break;
    }
  }

  // Final staleness pass against now (a claim may have gone stale since its
  // last PROGRESS without any new message to re-mark it).
  for (const s of states.values()) {
    if (!s.done && opts.nowMs - s.lastProgressMs > opts.ttlMs) s.stale = true;
  }
  return states;
}

/**
 * Executor-side fence check (mosaico: validate before acting, not only at
 * claim time). May this author post this verb, given the resolved state?
 *
 * - CLAIM: always allowed to ATTEMPT — the fence arbitrates at resolve.
 * - PROGRESS/DONE/BLOCKED while someone ELSE holds the claim: refused. The
 *   resolver would ignore the zombie's verb anyway, but the refusal tells the
 *   AGENT it lost — otherwise it posts DONE and walks away believing it
 *   finished work it no longer owns. Own claim (even stale) may still be
 *   refreshed or marked: staleness is a lease lapse, not a loss.
 * - HANDOFF while someone else holds the claim: refused (only the claimant
 *   can release). ACK carries no claim semantics, always allowed.
 */
export function mayPostVerb(cur: ClaimState | undefined, author: string, verb: OrchVerb): boolean {
  if (verb === "PROGRESS" || verb === "DONE" || verb === "BLOCKED" || verb === "HANDOFF") {
    if (cur && cur.claimant !== author) return false;
  }
  return true;
}

/**
 * Client-side mention detection (the sealed-stack interrupt): a message
 * mentions me if it p-tags my pubkey, embeds my npub, or leads with my name.
 * Relay-side #p filters cannot see inside sealed wraps — every agent scans
 * post-decrypt (AGENT_CHAT_ORCHESTRATION.md §11.3, adapted for Concord).
 * Content-based name matching is a HINT only (spoofable) — callers treating
 * mentions as instructions must check the p-tag/npub forms.
 */
export function mentionsMe(opts: {
  tags: string[][];
  content: string;
  myPubkey: string;
  myNpub: string;
  myNames: string[];
}): boolean {
  if (opts.tags.some((t) => t[0] === "p" && t[1] === opts.myPubkey)) return true;
  if (opts.content.includes(opts.myNpub)) return true;
  const lower = opts.content.toLowerCase();
  return opts.myNames.some((n) => n && (lower.includes(`@${n.toLowerCase()}`) || lower.startsWith(`${n.toLowerCase()}:`)));
}
