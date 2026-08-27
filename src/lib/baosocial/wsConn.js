/**
 * Real WS RelayConn implementation (production daemons) — minimal, no deps
 * beyond `ws`. Kept separate from client.ts so the client stays transport-
 * agnostic for the in-process testkit.
 *
 * Final-boss hardening (runtime audit R1/R2):
 *  - every handler captures its OWN socket and ignores events from a stale
 *    one (an old socket's trailing close must never tear down a healthy
 *    replacement's waiters);
 *  - sends guard on readyState — node-ws THROWS synchronously while
 *    CONNECTING, and an unhandled rejection from subscribe()'s fire-and-
 *    forget connect could kill daemons (Node ≥15 default);
 *  - reconnect resubscribes all live subs, so a lost initial REQ self-heals.
 */
import WebSocket from 'ws';
import { createLadder } from './reconnect.js';
export class WsRelayConn {
    constructor(url, opts = {}) {
        this.url = url;
        this.opts = opts;
        this.ws = null;
        this.pending = new Map();
        this.liveSubs = new Map();
        this.okWaiters = new Map();
        this.counter = 0;
        this.openPromise = null;
        this.closedByUser = false;
        this.ladder = createLadder();
        this.gaveUp = false;
        this.draining = false;
        this.openReject = null;
        this.reconnectTimer = null;
    }
    /** Send only when the CURRENT socket is actually open (never throws). */
    safeSend(sock, data) {
        if (sock && sock === this.ws && sock.readyState === WebSocket.OPEN) {
            try {
                sock.send(data);
                return true;
            }
            catch {
                return false; // raced close — reconnect/resubscribe path recovers
            }
        }
        return false;
    }
    connect() {
        if (this.openPromise)
            return this.openPromise;
        const sock = new WebSocket(this.url);
        this.ws = sock;
        this.openPromise = new Promise((resolve, reject) => {
            this.openReject = reject;
            sock.on('open', () => {
                if (sock !== this.ws)
                    return; // stale socket — ignore
                this.draining = false;
                const reconnected = this.ladder.attempts > 0;
                this.ladder.reset();
                if (reconnected)
                    this.opts.onReconnect?.();
                // Resubscribe every live sub — a reconnect must not go deaf
                // (post-audit: daemons previously died silently on disconnect).
                for (const [subId, sub] of this.liveSubs) {
                    this.safeSend(sock, JSON.stringify(['REQ', subId, sub.filter]));
                }
                resolve();
            });
            sock.on('error', () => {
                if (sock !== this.ws)
                    return; // stale socket — ignore
                // Clear so a later connect() dials again instead of returning this
                // rejected promise forever.
                this.openPromise = null;
                reject(new Error('relay websocket error'));
                this.scheduleReconnect();
            });
            sock.on('close', () => {
                if (sock !== this.ws)
                    return; // stale socket — the replacement owns state now
                this.onClose();
            });
            sock.on('message', (data) => {
                if (sock !== this.ws)
                    return; // stale socket — drop late frames
                this.onMessage(data.toString());
            });
        });
        return this.openPromise;
    }
    onClose() {
        this.ws = null;
        this.openPromise = null;
        this.opts.onDisconnect?.();
        // Fail pending publishes (callers retry per protocol), resolve queries
        // with what arrived.
        for (const [id, w] of this.okWaiters) {
            clearTimeout(w.timer);
            w.resolve(false);
            this.okWaiters.delete(id);
        }
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.resolve(p.events);
            this.pending.delete(id);
        }
        this.scheduleReconnect();
    }
    scheduleReconnect() {
        if (this.closedByUser || this.gaveUp || this.reconnectTimer)
            return;
        if (this.liveSubs.size === 0 && this.okWaiters.size === 0 && this.pending.size === 0)
            return;
        const delay = this.ladder.next();
        if (delay === null) {
            // Budget exhausted: either the caller handles it (daemons go loud and
            // exit for their supervisor) or we park at maxMs cadence forever (CLI).
            if (this.opts.onGiveUp) {
                this.gaveUp = true;
                this.opts.onGiveUp(`relay unreachable after ${this.ladder.attempts} attempts: ${this.url}`);
                return;
            }
            this.gaveUp = false;
            const parked = Math.min(this.opts.maxMs ?? 30_000, 30_000);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.ladder.reset();
                if (!this.closedByUser)
                    void this.connect().catch(() => this.scheduleReconnect());
            }, parked);
            this.reconnectTimer.unref?.();
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.closedByUser)
                void this.connect().catch(() => this.scheduleReconnect());
        }, delay);
        this.reconnectTimer.unref?.();
    }
    onMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (msg[0] === 'EVENT') {
            const subId = String(msg[1]);
            const ev = msg[2];
            const pending = this.pending.get(subId);
            if (pending)
                pending.events.push(ev);
            this.liveSubs.get(subId)?.onEvent(ev);
        }
        else if (msg[0] === 'EOSE') {
            const pending = this.pending.get(String(msg[1]));
            if (pending)
                pending.resolve(pending.events); // resolve=finish: cleans up + CLOSEs
        }
        else if (msg[0] === 'OK') {
            const waiter = this.okWaiters.get(String(msg[1]));
            if (waiter) {
                clearTimeout(waiter.timer);
                this.okWaiters.delete(String(msg[1]));
                waiter.resolve(Boolean(msg[2]));
            }
        }
    }
    nextSubId() {
        return `bao-${++this.counter}-${Math.random().toString(36).slice(2, 8)}`;
    }
    async publish(event) {
        await this.connect();
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.okWaiters.delete(event.id);
                reject(new Error('publish OK timeout'));
            }, 10_000);
            this.okWaiters.set(event.id, {
                resolve: (ok) => {
                    if (ok)
                        resolve();
                    else
                        reject(new Error('relay rejected event'));
                },
                timer,
            });
            if (!this.safeSend(this.ws, JSON.stringify(['EVENT', event]))) {
                clearTimeout(timer);
                this.okWaiters.delete(event.id);
                reject(new Error('relay websocket not open'));
            }
        });
    }
    async query(filter, timeoutMs = 10_000) {
        await this.connect();
        return new Promise((resolve) => {
            const subId = this.nextSubId();
            const finish = (events) => {
                const p = this.pending.get(subId);
                if (!p)
                    return;
                clearTimeout(p.timer);
                this.pending.delete(subId);
                // CLOSE the sub — a query is one-shot; leaving REQs open leaks the
                // client's interest filters and hoards relay state (post-audit).
                this.safeSend(this.ws, JSON.stringify(['CLOSE', subId]));
                resolve(events);
            };
            const timer = setTimeout(() => finish(this.pending.get(subId)?.events ?? []), timeoutMs);
            this.pending.set(subId, { resolve: finish, events: [], timer });
            if (!this.safeSend(this.ws, JSON.stringify(['REQ', subId, filter]))) {
                // Socket died between connect() and send — resolve empty; callers
                // retry per protocol. The pending entry stays until its timeout so
                // late frames can't orphan.
                finish([]);
            }
        });
    }
    subscribe(filter, onEvent) {
        const subId = this.nextSubId();
        this.liveSubs.set(subId, { filter, onEvent });
        const sockAtSubscribe = this.ws;
        // Fire-and-forget BUT rejection-safe (audit R1): a failed first connect
        // must not become an unhandledRejection that kills the daemon. The
        // resubscribe-on-reopen loop re-sends the REQ when the socket comes up.
        void this.connect()
            .then(() => {
            this.safeSend(this.ws, JSON.stringify(['REQ', subId, filter]));
        })
            .catch(() => {
            void sockAtSubscribe; // connect failed; scheduleReconnect already armed
        });
        return () => {
            this.liveSubs.delete(subId);
            this.safeSend(this.ws, JSON.stringify(['CLOSE', subId]));
        };
    }
    close() {
        this.closedByUser = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Audit FIX 3: a close() while CONNECTING used to strand the captured
        // openPromise forever (the error handler's stale-guard swallowed the
        // event), hanging every in-flight publish/query — daemons zombied
        // exactly when restarting during an outage. Settle it, then drain
        // pending waiters so nothing awaits a socket that will never open.
        const pending = this.openPromise;
        this.draining = true;
        this.ws?.close();
        this.ws = null;
        this.openPromise = null;
        if (pending)
            this.openReject?.(new Error('connection closed while connecting'));
        for (const [id, w] of this.okWaiters) {
            clearTimeout(w.timer);
            w.resolve(false);
            this.okWaiters.delete(id);
        }
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.resolve(p.events);
            this.pending.delete(id);
        }
    }
}
