/**
 * Browser-native WebRelayConn — RelayConn over the browser's WebSocket.
 *
 * Same NIP-01 semantics as WsRelayConn (publish/query/subscribe/close,
 * OK-wait for publishes, EOSE resolve-then-delete with CLOSE, live-sub
 * resubscribe on reconnect) but uses the platform WebSocket so apps can
 * consume @bao/community without a bundler alias shimming 'ws'.
 *
 * Runs under Node ≥21 too (global WebSocket), which keeps it testable
 * against the RelaySim in vitest.
 */
import type { NostrEvent } from './crypto.js';
import type { RelayConn } from './client.js';
export declare class WebRelayConn implements RelayConn {
    private readonly url;
    private ws;
    private readonly pending;
    private readonly liveSubs;
    private readonly okWaiters;
    private counter;
    private openPromise;
    private openReject;
    private closedByUser;
    private reconnectAttempts;
    private reconnectTimer;
    private keepaliveTimer;
    constructor(url: string);
    /** Send only when the CURRENT socket is open (never throws — browser
     *  WebSocket.send throws INVALID_STATE_ERR while CONNECTING). */
    private safeSend;
    private connect;
    /**
     * Keepalive for hostile middleboxes: Cloudflare proxies idle WebSockets
     * ~100 s, mobile NATs are tighter still, nginx caps at proxy_read_timeout.
     * Re-issuing live-sub REQs is idempotent on the relay (same subId just
     * re-subscribes) and resets every idle timer — no protocol junk, no
     * publishes. 55 s sits safely under CF's floor.
     */
    private startKeepalive;
    private onClose;
    private scheduleReconnect;
    private onMessage;
    private nextSubId;
    publish(event: NostrEvent): Promise<void>;
    query(filter: Record<string, unknown>, timeoutMs?: number): Promise<NostrEvent[]>;
    subscribe(filter: Record<string, unknown>, onEvent: (ev: NostrEvent) => void): () => void;
    close(): void;
    /** REL-02b: after close(), every op must throw instead of re-dialing. */
    private assertNotClosed;
}
