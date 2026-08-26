/**
 * In-process NIP-01 relay simulator over `ws` — §17 test harness.
 *
 * - EVENT/REQ/CLOSE/EOSE/OK
 * - Ephemeral kinds (20000–29999) broadcast but NEVER stored
 * - Parameterized-replaceable semantics: latest (created_at, id) per
 *   (pubkey, kind, d) wins; older replacements are DROPPED — this is what
 *   makes the §17 redaction-staleness regression test real
 * - NIP-09 kind-5: same-author deletion (e-tags + a-tags with created_at rules)
 * - Full ingress frame tap (every raw frame, both directions)
 * - Fault injection: drop/delay events matching a filter
 * - Deterministic clock injection (affects expiration handling)
 */
import { WebSocketServer, WebSocket } from 'ws';
import { verifyEvent } from '../crypto.js';
import { isEphemeralKind, isAddressableKind } from '../kinds.js';
export class RelaySim {
    constructor(opts = {}) {
        this.wss = null;
        this.port = 0;
        this.wsPath = '';
        /** Regular-kind storage by id; addressable by (pubkey:kind:d). */
        this.byId = new Map();
        this.addrIndex = new Map(); // coord → id
        this.subs = new Map();
        this.clients = new Set();
        this.taps = [];
        this.faults = [];
        this.nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
        this.maxFutureSec = opts.maxFutureSec ?? 900;
    }
    async start(opts = {}) {
        if (opts.httpServer) {
            // Attached mode: the HTTP server must already be listening so its
            // address() yields the port; ws handles the 'upgrade' events itself.
            this.wsPath = opts.path ?? '/ws';
            this.wss = new WebSocketServer({ server: opts.httpServer, path: this.wsPath });
        }
        else {
            this.wsPath = '';
            await new Promise((resolve) => {
                this.wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 }, () => resolve());
            });
        }
        const addr = opts.httpServer ? opts.httpServer.address() : this.wss.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        this.wss.on('connection', (ws) => this.onConnection(ws));
        return this.url;
    }
    get url() {
        return `ws://127.0.0.1:${this.port}${this.wsPath}`;
    }
    async stop() {
        for (const ws of this.clients) {
            try {
                ws.terminate();
            }
            catch { /* ignore */ }
        }
        await new Promise((resolve) => this.wss?.close(() => resolve()));
        this.wss = null;
    }
    addFault(rule) {
        this.faults.push(rule);
    }
    clearFaults() {
        this.faults = [];
    }
    /** All stored (non-deleted) events matching a filter. Test introspection. */
    query(filters) {
        return [...this.byId.values()]
            .filter((s) => !s.deleted)
            .map((s) => s.event)
            .filter((ev) => filters.some((f) => this.matches(ev, f)));
    }
    storedCount() {
        return [...this.byId.values()].filter((s) => !s.deleted).length;
    }
    tap(direction, raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch { /* keep raw only */ }
        this.taps.push({ direction, raw, parsed });
    }
    onConnection(ws) {
        this.clients.add(ws);
        this.subs.set(ws, new Map());
        ws.on('message', (data) => {
            const raw = data.toString();
            this.tap('in', raw);
            let msg;
            try {
                msg = JSON.parse(raw);
            }
            catch {
                return;
            }
            if (!Array.isArray(msg))
                return;
            switch (msg[0]) {
                case 'EVENT':
                    this.onEvent(ws, msg[1]);
                    break;
                case 'REQ':
                    this.onReq(ws, String(msg[1]), msg.slice(2));
                    break;
                case 'CLOSE':
                    this.subs.get(ws)?.delete(String(msg[1]));
                    break;
                default:
                    break;
            }
        });
        ws.on('close', () => {
            this.clients.delete(ws);
            this.subs.delete(ws);
        });
        ws.on('error', () => { });
    }
    send(ws, frame) {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        const raw = JSON.stringify(frame);
        this.tap('out', raw);
        ws.send(raw);
    }
    onEvent(ws, ev) {
        const ok = (accepted, message = '') => this.send(ws, ['OK', ev?.id ?? '', accepted, message]);
        try {
            if (!ev || typeof ev.id !== 'string' || !verifyEvent(ev)) {
                return ok(false, 'invalid: bad event or signature');
            }
            if (ev.created_at > this.nowSec() + this.maxFutureSec) {
                return ok(false, 'invalid: created_at too far in the future');
            }
            if (ev.kind === 5) {
                this.applyDeletion(ev);
                return ok(true);
            }
            // NIP-40 expiration: already-expired events are not stored.
            const exp = ev.tags.find((t) => t[0] === 'expiration')?.[1];
            if (exp && Number(exp) <= this.nowSec())
                return ok(true);
            for (const fault of this.faults) {
                if (fault.match(ev)) {
                    if (fault.action === 'drop')
                        return ok(true); // accepted, never delivered
                    setTimeout(() => this.storeAndBroadcast(ev), fault.delayMs ?? 100);
                    return ok(true);
                }
            }
            this.storeAndBroadcast(ev);
            return ok(true);
        }
        catch (err) {
            return ok(false, `error: ${err.message}`);
        }
    }
    storeAndBroadcast(ev) {
        if (isEphemeralKind(ev.kind)) {
            // Ephemeral: broadcast to live subscribers, NEVER store (NIP-01).
            this.broadcast(ev);
            return;
        }
        if (isAddressableKind(ev.kind)) {
            const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
            const coord = `${ev.kind}:${ev.pubkey}:${d}`;
            const existingId = this.addrIndex.get(coord);
            if (existingId) {
                const existing = this.byId.get(existingId);
                if (existing && !existing.deleted) {
                    // Latest created_at wins; NIP-01 tie-break: on equal created_at
                    // the LOWEST id is considered newer. Stale replacement is dropped.
                    const newer = ev.created_at > existing.event.created_at ||
                        (ev.created_at === existing.event.created_at && ev.id < existing.event.id);
                    if (!newer)
                        return; // dropped — no broadcast, no store
                    existing.deleted = true;
                }
            }
            this.byId.set(ev.id, { event: ev, deleted: false });
            this.addrIndex.set(coord, ev.id);
            this.broadcast(ev);
            return;
        }
        // Regular kinds: plain store.
        this.byId.set(ev.id, { event: ev, deleted: false });
        this.broadcast(ev);
    }
    applyDeletion(del) {
        // NIP-09: only same-author; addressable a-tags require the deletion to be
        // newer than the target; e-tags mark deleted regardless of arrival order.
        for (const tag of del.tags) {
            if (tag[0] === 'e') {
                const target = this.byId.get(tag[1]);
                if (target && target.event.pubkey === del.pubkey)
                    target.deleted = true;
            }
            else if (tag[0] === 'a') {
                // a-tag value = kind:pubkey:d — the d itself may CONTAIN colons
                // (bao-scroll:<room>:<seg>), so split on the first two only.
                const v = String(tag[1]);
                const i1 = v.indexOf(':');
                const i2 = v.indexOf(':', i1 + 1);
                const kindStr = v.slice(0, i1);
                const pubkey = v.slice(i1 + 1, i2);
                const d = i2 === -1 ? '' : v.slice(i2 + 1);
                const coord = `${kindStr}:${pubkey}:${d}`;
                if (pubkey !== del.pubkey)
                    continue;
                const targetId = this.addrIndex.get(coord);
                const target = targetId ? this.byId.get(targetId) : undefined;
                if (target && target.event.created_at <= del.created_at)
                    target.deleted = true;
            }
        }
    }
    broadcast(ev) {
        for (const [ws, subs] of this.subs) {
            for (const [subId, filters] of subs) {
                if (filters.some((f) => this.matches(ev, f)))
                    this.send(ws, ['EVENT', subId, ev]);
            }
        }
    }
    onReq(ws, subId, filters) {
        // Register the live subscription FIRST so events arriving during the
        // stored replay aren't missed (NIP-01: REQ = replay + live stream).
        this.subs.get(ws)?.set(subId, filters);
        for (const stored of this.byId.values()) {
            if (stored.deleted)
                continue;
            if (this.isExpired(stored.event))
                continue; // NIP-40: expired events are not served
            if (filters.some((f) => this.matches(stored.event, f))) {
                this.send(ws, ['EVENT', subId, stored.event]);
            }
        }
        this.send(ws, ['EOSE', subId]);
    }
    isExpired(ev) {
        const exp = ev.tags.find((t) => t[0] === 'expiration')?.[1];
        return exp !== undefined && Number(exp) <= this.nowSec();
    }
    matches(ev, filter) {
        if (filter.ids && !filter.ids.some((id) => ev.id.startsWith(id)))
            return false;
        if (filter.authors && !filter.authors.some((a) => ev.pubkey.startsWith(a)))
            return false;
        if (filter.kinds && !filter.kinds.includes(ev.kind))
            return false;
        for (const key of Object.keys(filter)) {
            if (key.startsWith('#')) {
                const tagName = key.slice(1);
                const wanted = filter[key];
                const values = ev.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
                if (!wanted.some((w) => values.includes(w)))
                    return false;
            }
        }
        if (typeof filter.since === 'number' && ev.created_at < filter.since)
            return false;
        if (typeof filter.until === 'number' && ev.created_at > filter.until)
            return false;
        return true;
    }
}
