/**
 * Welcomer join state — the STATEFUL half of the join gate, shared by the
 * welcomer daemon (daemons/bao-chat-welcomer.mjs) and unit tests.
 *
 * The daemon owns relay I/O and gate wiring; everything that must be atomic
 * across concurrent join handlers lives here:
 *
 *  1. **Invite-v2 consumption (§7, P5).** `beginJoin` evaluates the lid and
 *     consumes a use in ONE synchronous step (InviteLedger.reserve). The
 *     old daemon pattern — read `uses` at the gate, increment after the
 *     menu/ratchet/challenge awaits — let two concurrent joins both pass the
 *     `uses >= maxUses` bound. `publishJoinWrap` then COMMITS BEFORE THE
 *     PUBLISH: the wrap is the admission, so a durable commit that fails
 *     must not be discovered after the joiner was admitted (a restart would
 *     reopen the use — the residual this closes). A commit failure releases
 *     the reservation and returns the typed retryable `'ledger-error'`
 *     outcome; nothing is published. A publish failure after a successful
 *     commit rolls the commit back (durably for FileInviteUseLedger) so the
 *     retry still admits; if that rollback write also fails, the use stays
 *     consumed — fail closed. The ledger is pluggable: the in-memory
 *     default, or FileInviteUseLedger (durable across restarts).
 *
 *  2. **Fresh-join ratchet (§8 JOIN-02/JOIN-07).** `runFreshJoin` honors a
 *     join request's `history:'fresh'` claim ONLY when the room config OR the
 *     matched invite lid provisions it (`freshJoinProvisioned`); otherwise the
 *     join degrades to the current epoch and can never force a room-wide
 *     ratchet on its own. Dedup is per burner with TtlKeySet — per-key TTL
 *     eviction, never the old bulk `clear()` that let a replay re-ratchet
 *     after 4096 distinct burners. A failed ratchet releases its dedup slot
 *     so the retry can ratchet instead of being admitted into the old epoch.
 *     Ratchets are SERIALIZED per room, so two concurrent fresh joins cannot
 *     both compute from a stale epoch (epoch regression) or double-apply one
 *     step.
 *
 *  3. **Hot-reload stop guard + runner quiescence.** `stop()` marks a
 *     removed/replaced room: in-flight joins release their reservation and
 *     never publish, and queued ratchets never start — a stopped room
 *     receives no new wraps. A ratchet that was ALREADY past its stop check
 *     keeps running and advances the room epoch; `quiesce(timeoutMs)` lets
 *     the daemon wait (bounded) for it before starting a replacement runner.
 *     The epoch scope object (`JoinEpochScope`) and the ratchet dedup set can
 *     be CARRIED into the replacement by reference, so even a ratchet that
 *     settles after a quiesce timeout lands on the live scope (monotonic
 *     guard: never a regression) and the burner that ratcheted cannot
 *     re-ratchet through the replacement. A replacement therefore serves the
 *     post-advance epoch, never a stale one.
 */
import { type Clock } from './crypto.js';
import { type InviteAdmissionResult, type InviteConfig } from './invite.js';
import { TtlKeySet, type InviteLedger } from './welcomer-core.js';
/**
 * The room's live epoch scope. The daemon owns ONE instance per room and
 * passes the SAME object to a replacement runner on hot reload, so a ratchet
 * that settles after the swap is still visible to the new runner (and a
 * late straggler can never regress it — see the monotonic guard in
 * runFreshJoin).
 */
export interface JoinEpochScope {
    epoch: number;
    /** No chainKey → P1 room: no ratchet. */
    chainKey?: string;
    encKey?: string;
}
export interface WelcomerJoinStateOptions {
    roomId: string;
    /** Provisioned invite-v2 config (rooms file `invites`). */
    invites: InviteConfig;
    /** Room-level history provisioning (rooms file `history`). */
    roomHistory?: string;
    /** Current epoch + chain scope (hex). No chainKey → P1 room: no ratchet. */
    epoch: number;
    chainKey?: string;
    encKey?: string;
    /** Shared live scope. When supplied it WINS over epoch/chainKey/encKey and
     *  is read+written by reference (hot-reload runner carry-over). */
    scope?: JoinEpochScope;
    clock?: Clock;
    /** Injectable ledger (tests / durable FileInviteUseLedger). */
    ledger?: InviteLedger;
    /** Shared ratchet dedup set (hot-reload carry-over): the replacement
     *  runner must not re-ratchet a burner the old runner already ratcheted. */
    ratcheted?: TtlKeySet;
}
export interface RatchetScope {
    epoch: number;
    chainKey: string;
    encKey: string;
}
export type FreshJoinOutcome = 'ratcheted' | 'already-wrapped' | 'deduped' | 'not-requested' | 'not-provisioned' | 'no-chain' | 'stopped' | 'error';
/** Outcome of the jittered wrap-publish step (see publishJoinWrap). */
export type JoinPublishOutcome = 'published' | 'stopped' | 'ledger-error' | 'error';
export interface JoinPublishPlan {
    /** Invite reservation to commit on success / release on abort. */
    lid?: string;
    /** Jitter window (ms) before publishing (§5.2 correlation defense). */
    jitterMs?: number;
    /** Publishes the already-built wrap; rejects on relay failure. */
    publish: () => Promise<void>;
    /** Injectable timer (tests). Default: real setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}
export declare class WelcomerJoinState {
    readonly roomId: string;
    readonly invites: InviteConfig;
    private readonly roomHistory;
    private readonly clock;
    private readonly ledger;
    private readonly ratcheted;
    private readonly epochScopeRef;
    private ratchetChain;
    /** In-flight publishJoinWrap calls, awaited (bounded) by quiesce(). */
    private readonly inFlight;
    private stopped;
    constructor(opts: WelcomerJoinStateOptions);
    get epoch(): number;
    get chainKey(): string | undefined;
    get encKey(): string | undefined;
    /** The live (possibly shared) epoch scope object — the daemon carries this
     *  by reference into a replacement runner on hot reload. */
    get epochScope(): JoinEpochScope;
    /** The per-room ratchet dedup set — likewise carried by reference so a
     *  replacement runner cannot double-ratchet a burner. */
    get ratchetDedup(): TtlKeySet;
    /** Consumed uses for a lid (introspection/tests). */
    uses(lid: string): number;
    /**
     * ATOMIC invite-v2 gate: evaluate the lid and reserve a use in one
     * synchronous step. Callers must invoke this BEFORE the first await of the
     * join handler and `releaseJoin(lid)` on any later rejection (including the
     * cap-pow challenge-issue return — the retry must not burn a second use).
     */
    beginJoin(ctx: {
        lid?: string;
        nowSec?: number;
    }): InviteAdmissionResult;
    /** Release a reservation after a later gate rejects (no-op when unknown). */
    releaseJoin(lid?: string): void;
    /** Commit a reservation BEFORE the wrap publish (durable ledgers persist
     *  here and throw InviteLedgerWriteError on failure — fail closed). No-op
     *  when the lid has no reservation. */
    commitJoin(lid?: string): void;
    /** Undo a commit whose wrap publish failed, so the retry can admit.
     *  Durable ledgers roll the persisted count back; a failed rollback write
     *  keeps the use consumed (fail closed). No-op when the lid was never
     *  committed. */
    rollbackJoin(lid?: string): void;
    /**
     * Mark this room stopped (hot-reload removal or replacement). In-flight
     * joins abort before publishing and queued ratchets never start, so a
     * removed room never receives new wraps. Idempotent; irreversible.
     */
    stop(): void;
    get isStopped(): boolean;
    /**
     * Wait (bounded) for every in-flight join/ratchet to settle. Call AFTER
     * `stop()`: the stop checks are synchronous, so no new work enters after
     * that point and one pass over the current tail is sufficient.
     *
     * A ratchet that was already past its stop check keeps its epoch advance —
     * this is what makes that advance visible before the replacement runner
     * starts. Returns true when everything settled, false when `timeoutMs`
     * expired first (the caller may still start the replacement; the shared
     * scope makes a later settle land on the live state instead of being lost).
     */
    quiesce(opts?: {
        timeoutMs?: number;
    }): Promise<boolean>;
    /**
     * Publish the join wrap inside the invite-reservation window, in the only
     * safe (fail-closed) order:
     *
     *   stopped?              → release, never publish
     *   wait the jitter window
     *   stopped?              → release (the room was removed mid-window)
     *   commit() throws       → release, publish NOTHING, return the typed
     *                           retryable 'ledger-error': a use that cannot be
     *                           persisted must never be admitted (the wrap is
     *                           the admission; after a restart the unpersisted
     *                           use would reopen)
     *   publish() rejects     → rollbackCommit: nothing is on the relay, the
     *                           retry can still admit. Durable ledgers decrement
     *                           the persisted count; a failed rollback write
     *                           keeps the use consumed (fail closed)
     *   publish() resolves    → committed + on the relay: final
     *
     * COMMIT BEFORE PUBLISH is the residual fix: the round-3 order
     * (publish-then-commit) admitted the join first, so a durable write failure
     * was only discoverable after admission and a restart reopened the use.
     * The rollback preserves the round-3 availability invariant (a failed
     * PUBLISH never burns a use) without reopening the persistence hole.
     */
    publishJoinWrap(plan: JoinPublishPlan): Promise<JoinPublishOutcome>;
    private publishJoinWrapInner;
    /** JOIN-02: does the room or this lid provision fresh-join ratchets? */
    freshProvisioned(lid?: string): boolean;
    /**
     * Run the fresh-join ratchet for one burner, serialized per room.
     *
     * `perform` receives the CURRENT scope and must publish the epochAdvance
     * notice, returning the next scope — or 'already-wrapped' when the relay
     * already holds this burner's wrap (durable cross-restart check). The state
     * advances only after `perform` resolves, and only one `perform` per room
     * runs at a time: concurrent fresh joins apply in order instead of both
     * ratcheting from the same stale epoch.
     */
    runFreshJoin(burner: string, req: {
        history?: string;
        lid?: string;
    }, perform: (current: RatchetScope) => Promise<RatchetScope | 'already-wrapped'>): Promise<FreshJoinOutcome>;
}
