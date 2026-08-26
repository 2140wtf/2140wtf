import type { NostrEvent } from './crypto.js';
import type { RelayConn } from './client.js';
import { type LadderOptions } from './reconnect.js';
export interface WsRelayConnOptions extends LadderOptions {
    /** Fired when the socket drops (before backoff scheduling). */
    onDisconnect?: () => void;
    /** Fired when a dropped socket reopens. */
    onReconnect?: () => void;
    /**
     * Fired when maxAttempts is exhausted. When PROVIDED, retrying STOPS —
     * daemons use this to go loud and exit for their supervisor. Absent
     * (default): retry forever at maxMs cadence (CLI posture).
     */
    onGiveUp?: (reason: string) => void;
}
export declare class WsRelayConn implements RelayConn {
    private readonly url;
    private readonly opts;
    private ws;
    private readonly pending;
    private readonly liveSubs;
    private readonly okWaiters;
    private counter;
    private openPromise;
    private closedByUser;
    private ladder;
    private gaveUp;
    private draining;
    private openReject;
    private reconnectTimer;
    constructor(url: string, opts?: WsRelayConnOptions);
    /** Send only when the CURRENT socket is actually open (never throws). */
    private safeSend;
    private connect;
    private onClose;
    private scheduleReconnect;
    private onMessage;
    private nextSubId;
    publish(event: NostrEvent): Promise<void>;
    query(filter: Record<string, unknown>, timeoutMs?: number): Promise<NostrEvent[]>;
    subscribe(filter: Record<string, unknown>, onEvent: (ev: NostrEvent) => void): () => void;
    close(): void;
}
