import type { Server } from 'node:http';
import type { NostrEvent } from '../crypto.js';
type Frame = unknown[];
export interface TappedFrame {
    direction: 'in' | 'out';
    raw: string;
    parsed?: Frame;
}
export interface FaultRule {
    /** Match against incoming events. */
    match: (ev: NostrEvent) => boolean;
    action: 'drop' | 'delay';
    delayMs?: number;
}
export interface RelaySimOptions {
    nowSec?: () => number;
    /** Reject events older than this many seconds in the future (strfry-like). */
    maxFutureSec?: number;
}
export interface RelaySimStartOptions {
    port?: number;
    /** Attach the relay websocket to an EXISTING HTTP server (same port) so a
     *  single-port proxy (preview/hosting) can reach it — the browser cannot
     *  open a second port. Default: standalone listener on 127.0.0.1. */
    httpServer?: Server;
    /** Upgrade path when attached (default '/ws'). */
    path?: string;
}
export declare class RelaySim {
    private wss;
    private port;
    private wsPath;
    /** Regular-kind storage by id; addressable by (pubkey:kind:d). */
    private readonly byId;
    private readonly addrIndex;
    private readonly subs;
    private readonly clients;
    readonly taps: TappedFrame[];
    private faults;
    private readonly nowSec;
    private readonly maxFutureSec;
    constructor(opts?: RelaySimOptions);
    start(opts?: RelaySimStartOptions): Promise<string>;
    get url(): string;
    stop(): Promise<void>;
    addFault(rule: FaultRule): void;
    clearFaults(): void;
    /** All stored (non-deleted) events matching a filter. Test introspection. */
    query(filters: Record<string, unknown>[]): NostrEvent[];
    storedCount(): number;
    private tap;
    private onConnection;
    private send;
    private onEvent;
    private storeAndBroadcast;
    private applyDeletion;
    private broadcast;
    private onReq;
    private isExpired;
    private matches;
}
export {};
