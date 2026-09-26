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
import { systemClock } from './crypto.js';
import { evaluateInvite } from './invite.js';
import { freshJoinProvisioned, InviteUseLedger, TtlKeySet, WRAP_TTL_SEC } from './welcomer-core.js';
export class WelcomerJoinState {
    constructor(opts) {
        this.ratchetChain = Promise.resolve();
        /** In-flight publishJoinWrap calls, awaited (bounded) by quiesce(). */
        this.inFlight = new Set();
        this.stopped = false;
        this.roomId = opts.roomId;
        this.invites = opts.invites;
        this.roomHistory = opts.roomHistory;
        this.clock = opts.clock ?? systemClock;
        this.ledger = opts.ledger ?? new InviteUseLedger();
        // Dedup TTL = the wrap TTL: while the wrap can still be on the relay the
        // durable d-tag check covers restarts, and within this window a replay of
        // one captured join must never ratchet twice.
        this.ratcheted = opts.ratcheted ?? new TtlKeySet(WRAP_TTL_SEC * 1000, 4096);
        this.epochScopeRef = opts.scope ?? { epoch: opts.epoch, chainKey: opts.chainKey, encKey: opts.encKey };
    }
    get epoch() {
        return this.epochScopeRef.epoch;
    }
    get chainKey() {
        return this.epochScopeRef.chainKey;
    }
    get encKey() {
        return this.epochScopeRef.encKey;
    }
    /** The live (possibly shared) epoch scope object — the daemon carries this
     *  by reference into a replacement runner on hot reload. */
    get epochScope() {
        return this.epochScopeRef;
    }
    /** The per-room ratchet dedup set — likewise carried by reference so a
     *  replacement runner cannot double-ratchet a burner. */
    get ratchetDedup() {
        return this.ratcheted;
    }
    /** Consumed uses for a lid (introspection/tests). */
    uses(lid) {
        return this.ledger.count(lid);
    }
    /**
     * ATOMIC invite-v2 gate: evaluate the lid and reserve a use in one
     * synchronous step. Callers must invoke this BEFORE the first await of the
     * join handler and `releaseJoin(lid)` on any later rejection (including the
     * cap-pow challenge-issue return — the retry must not burn a second use).
     */
    beginJoin(ctx) {
        const nowSec = ctx.nowSec ?? this.clock.nowSec();
        const gate = evaluateInvite(this.invites, {
            ...(ctx.lid !== undefined ? { lid: ctx.lid } : {}),
            uses: ctx.lid !== undefined ? this.ledger.count(ctx.lid) : 0,
            nowSec,
        });
        if (gate.verdict !== 'admit')
            return gate;
        // 'no-invite-v2' means the room has no per-link config: the base
        // inviteSecret gate governs and there is nothing to consume.
        if (gate.reason !== 'ok' || ctx.lid === undefined)
            return gate;
        const spec = this.invites[ctx.lid];
        if (!spec || !this.ledger.reserve(ctx.lid, spec.maxUses)) {
            // Unreachable without an interleaving await (there is none), but fail
            // closed if a future refactor introduces one.
            return { verdict: 'reject', reason: 'exhausted' };
        }
        return gate;
    }
    /** Release a reservation after a later gate rejects (no-op when unknown). */
    releaseJoin(lid) {
        if (lid !== undefined)
            this.ledger.release(lid);
    }
    /** Commit a reservation BEFORE the wrap publish (durable ledgers persist
     *  here and throw InviteLedgerWriteError on failure — fail closed). No-op
     *  when the lid has no reservation. */
    commitJoin(lid) {
        if (lid !== undefined)
            this.ledger.commit(lid);
    }
    /** Undo a commit whose wrap publish failed, so the retry can admit.
     *  Durable ledgers roll the persisted count back; a failed rollback write
     *  keeps the use consumed (fail closed). No-op when the lid was never
     *  committed. */
    rollbackJoin(lid) {
        if (lid !== undefined)
            this.ledger.rollbackCommit(lid);
    }
    /**
     * Mark this room stopped (hot-reload removal or replacement). In-flight
     * joins abort before publishing and queued ratchets never start, so a
     * removed room never receives new wraps. Idempotent; irreversible.
     */
    stop() {
        this.stopped = true;
    }
    get isStopped() {
        return this.stopped;
    }
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
    async quiesce(opts = {}) {
        const timeoutMs = opts.timeoutMs ?? 5_000;
        return new Promise((resolve) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done)
                    return;
                done = true;
                resolve(false);
            }, timeoutMs);
            void Promise.allSettled([this.ratchetChain, ...this.inFlight]).then(() => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                resolve(true);
            });
        });
    }
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
    async publishJoinWrap(plan) {
        const run = this.publishJoinWrapInner(plan);
        // Track for quiesce(): a stop during an in-flight publish (commit done,
        // relay write pending) must be awaited before the daemon replaces the
        // runner, or the late publish/rollback races the replacement's state.
        this.inFlight.add(run);
        try {
            return await run;
        }
        finally {
            this.inFlight.delete(run);
        }
    }
    async publishJoinWrapInner(plan) {
        if (this.stopped) {
            this.releaseJoin(plan.lid);
            return 'stopped';
        }
        const jitterMs = plan.jitterMs ?? 0;
        if (jitterMs > 0) {
            const sleep = plan.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
            await sleep(jitterMs);
        }
        // Re-check AFTER the window: stopRoom during the jitter must never
        // publish a wrap for a removed room (deterministic d-tags make a late
        // wrap idempotent, but the room must not receive new wraps).
        if (this.stopped) {
            this.releaseJoin(plan.lid);
            return 'stopped';
        }
        try {
            this.commitJoin(plan.lid);
        }
        catch {
            // Durable commit failed: admit nothing. The commit implementation left
            // the in-memory state uncommitted, so dropping the reservation restores
            // the pre-join count; after the filesystem recovers the same join can
            // be retried and will admit exactly once.
            this.releaseJoin(plan.lid);
            return 'ledger-error';
        }
        try {
            await plan.publish();
        }
        catch {
            this.rollbackJoin(plan.lid);
            return 'error';
        }
        return 'published';
    }
    /** JOIN-02: does the room or this lid provision fresh-join ratchets? */
    freshProvisioned(lid) {
        const inviteHistory = lid !== undefined ? this.invites[lid]?.history : undefined;
        return freshJoinProvisioned(this.roomHistory, inviteHistory);
    }
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
    async runFreshJoin(burner, req, perform) {
        if (req.history !== 'fresh')
            return 'not-requested';
        if (!this.freshProvisioned(req.lid))
            return 'not-provisioned';
        if (this.stopped)
            return 'stopped';
        const run = this.ratchetChain.then(async () => {
            // A ratchet queued before the stop must not start after removal: no
            // post-removal epoch advance, notice publish, or rooms-file write.
            if (this.stopped)
                return 'stopped';
            // Re-check the chain key inside the serialized section: a prior
            // ratchet may have cleared it? (Never — chainKey is monotonic — but
            // keep the guard local to the state read.)
            const chainKey = this.epochScopeRef.chainKey;
            if (!chainKey)
                return 'no-chain';
            // checkAndAdd is synchronous: no await may separate the check from the
            // insert, or two copies of one captured join could both ratchet.
            if (!this.ratcheted.checkAndAdd(burner))
                return 'deduped';
            try {
                const result = await perform({
                    epoch: this.epochScopeRef.epoch,
                    chainKey,
                    encKey: this.epochScopeRef.encKey ?? '',
                });
                if (result === 'already-wrapped')
                    return 'already-wrapped';
                // Monotonic guard: the scope may be SHARED with a replacement runner
                // (hot reload). A ratchet that settles late computed its result from
                // an older epoch; applying it would roll the live scope backwards.
                // Only ever advance.
                if (result.epoch > this.epochScopeRef.epoch) {
                    this.epochScopeRef.epoch = result.epoch;
                    this.epochScopeRef.chainKey = result.chainKey;
                    this.epochScopeRef.encKey = result.encKey;
                }
                return 'ratcheted';
            }
            catch {
                // perform published nothing and advanced nothing: release the dedup
                // slot so the client's retry can actually ratchet. Keeping it wedged
                // the burner at 'deduped' for the TTL, and the daemon admitted the
                // fresh join into the OLD epoch (pre-join history) instead.
                this.ratcheted.delete(burner);
                return 'error';
            }
        });
        // Keep the chain alive across a failed run (an outcome, not a rejection).
        this.ratchetChain = run.then(() => undefined, () => undefined);
        return run;
    }
}
