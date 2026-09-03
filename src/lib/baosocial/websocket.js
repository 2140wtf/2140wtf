/** INFRA-01: cap on a single inbound WS frame (browser/global path — no
 *  maxPayload option exists here, so we guard in onmessage). */
const MAX_WS_FRAME_BYTES = 1 << 20;
/** INFRA-01: cap on one query's in-flight accumulation (mirror of wsConn). */
const MAX_PENDING_EVENTS = 1_000;
export class WebRelayConn {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.pending = new Map();
        this.liveSubs = new Map();
        this.okWaiters = new Map();
        this.counter = 0;
        this.openPromise = null;
        this.openReject = null;
        this.closedByUser = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.keepaliveTimer = null;
    }
    /** Send only when the CURRENT socket is open (never throws — browser
     *  WebSocket.send throws INVALID_STATE_ERR while CONNECTING). */
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
            sock.binaryType = 'arraybuffer';
            sock.onopen = () => {
                if (sock !== this.ws)
                    return; // stale socket — ignore
                this.reconnectAttempts = 0;
                // Reconnect must not go deaf — resubscribe every live sub.
                for (const [subId, sub] of this.liveSubs) {
                    this.safeSend(sock, JSON.stringify(['REQ', subId, sub.filter]));
                }
                this.startKeepalive(sock);
                resolve();
            };
            sock.onerror = () => {
                if (sock !== this.ws)
                    return; // stale socket — ignore
                this.openPromise = null;
                reject(new Error('relay websocket error'));
                this.scheduleReconnect();
            };
            sock.onclose = () => {
                if (sock !== this.ws)
                    return; // stale socket — replacement owns state
                this.onClose();
            };
            sock.onmessage = (event) => {
                if (sock !== this.ws)
                    return; // stale socket — drop late frames
                this.onMessage(String(event.data));
            };
        });
        return this.openPromise;
    }
    /**
     * Keepalive for hostile middleboxes: Cloudflare proxies idle WebSockets
     * ~100 s, mobile NATs are tighter still, nginx caps at proxy_read_timeout.
     * Re-issuing live-sub REQs is idempotent on the relay (same subId just
     * re-subscribes) and resets every idle timer — no protocol junk, no
     * publishes. 55 s sits safely under CF's floor.
     */
    startKeepalive(sock) {
        if (this.keepaliveTimer !== null)
            clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = setInterval(() => {
            if (sock !== this.ws || sock.readyState !== WebSocket.OPEN) {
                clearInterval(this.keepaliveTimer);
                this.keepaliveTimer = null;
                return;
            }
            for (const [subId, sub] of this.liveSubs) {
                this.safeSend(sock, JSON.stringify(['REQ', subId, sub.filter]));
            }
        }, 55_000);
        // Node (RelaySim tests): never hold the process open for a timer.
        this.keepaliveTimer.unref?.();
    }
    onClose() {
        this.ws = null;
        this.openPromise = null;
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
        if (this.closedByUser || this.reconnectTimer)
            return;
        if (this.liveSubs.size === 0 && this.okWaiters.size === 0 && this.pending.size === 0)
            return;
        const backoff = Math.min(30_000, 500 * 2 ** this.reconnectAttempts++);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.closedByUser)
                void this.connect().catch(() => this.scheduleReconnect());
        }, backoff);
        // Mirror wsConn: in Node (≥21 global WebSocket) the backoff timer must
        // not keep the process alive; in browsers it's a no-op.
        this.reconnectTimer.unref?.();
    }
    onMessage(raw) {
        // INFRA-01: never JSON.parse a frame over the cap.
        if (raw.length > MAX_WS_FRAME_BYTES)
            return;
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
            if (pending) {
                // INFRA-01: flood a query past the cap → finish it (like EOSE).
                if (pending.events.length >= MAX_PENDING_EVENTS) {
                    pending.resolve(pending.events);
                }
                else {
                    pending.events.push(ev);
                }
            }
            this.liveSubs.get(subId)?.onEvent(ev);
        }
        else if (msg[0] === 'EOSE') {
            const pending = this.pending.get(String(msg[1]));
            if (pending)
                pending.resolve(pending.events);
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
        this.assertNotClosed();
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
        this.assertNotClosed();
        await this.connect();
        return new Promise((resolve) => {
            const subId = this.nextSubId();
            const finish = (events) => {
                const p = this.pending.get(subId);
                if (!p)
                    return;
                clearTimeout(p.timer);
                this.pending.delete(subId);
                // Queries are one-shot — CLOSE immediately so interest filters don't
                // linger on the relay (post-audit).
                this.safeSend(this.ws, JSON.stringify(['CLOSE', subId]));
                resolve(events);
            };
            const timer = setTimeout(() => finish(this.pending.get(subId)?.events ?? []), timeoutMs);
            this.pending.set(subId, { resolve: finish, events: [], timer });
            if (!this.safeSend(this.ws, JSON.stringify(['REQ', subId, filter])))
                finish([]);
        });
    }
    subscribe(filter, onEvent) {
        this.assertNotClosed(); // REL-02b: never silently reopen a user-closed conn
        const subId = this.nextSubId();
        this.liveSubs.set(subId, { filter, onEvent });
        // Fire-and-forget BUT rejection-safe (audit R1): a failed first connect
        // must not become an unhandledRejection. The resubscribe-on-reopen loop
        // re-sends the REQ when the socket comes up.
        void this.connect()
            .then(() => {
            this.safeSend(this.ws, JSON.stringify(['REQ', subId, filter]));
        })
            .catch(() => {
            /* scheduleReconnect already armed by the failed connect */
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
        if (this.keepaliveTimer !== null) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        // REL-02a: close() cannot rely on the socket's onclose to settle waiters
        // — it fires AFTER this.ws = null, and the stale-socket guard (sock !==
        // this.ws) then swallows it. Fail every in-flight publish/query NOW so
        // nothing hangs on a socket that will never answer, and settle a
        // CONNECTING openPromise so a mid-dial publish/query rejects fast.
        const pendingOpen = this.openPromise;
        this.ws?.close();
        this.ws = null;
        this.openPromise = null;
        if (pendingOpen)
            this.openReject?.(new Error('relay connection closed by user'));
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
        // Live subs belong to the closed socket — drop them so no late reconnect
        // (or caller bookkeeping) can resurrect interest on a dead connection.
        this.liveSubs.clear();
    }
    /** REL-02b: after close(), every op must throw instead of re-dialing. */
    assertNotClosed() {
        if (this.closedByUser)
            throw new Error('relay connection closed by user');
    }
}
