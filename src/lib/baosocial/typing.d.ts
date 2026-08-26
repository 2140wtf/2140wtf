/**
 * typing — live typing indicators (§7 payload convention, NO wire change).
 *
 * A typing indicator is an ORDINARY ephemeral envelope whose payload is
 * `{ typing: true }` (or `{ typing: false }` to cancel). It rides the room's
 * encrypted ephemeral stream like every §7 structure — the relay learns
 * nothing new (same kind, same routing tag, same padding bucket), and it
 * NEVER lands in the scroll (pure ephemeral; scribes ignore payloads they
 * fold, and clients exclude typing from every view).
 *
 * Etiquette is enforced client-side by TypingSignal:
 *  - debounce: at most one `typing:true` per window while keys keep flowing;
 *  - auto-stop: silence longer than the stop-after window emits `typing:false`;
 *  - close(): final cancel + unsubscribe.
 */
import type { Envelope, NostrEvent } from './index.js';
/** Build a typing payload (encrypted in-envelope). */
export declare function buildTyping(active: boolean): Record<string, unknown>;
/** Parse a typing payload, or null when the payload is not a typing signal. */
export declare function parseTyping(payload: unknown): {
    active: boolean;
} | null;
/** One decrypted typing signal delivered by a subscription. */
export interface TypingEvent {
    /** Envelope author key (per-room session key of the typer). */
    from: string;
    active: boolean;
    envelope: Envelope;
    event: NostrEvent;
}
/**
 * Client-side typing etiquette. Wrap a RoomSession-shaped object (needs
 * post() and subscribeLive()) without importing it — keeps this module
 * dependency-light and testable against stubs.
 */
export declare class TypingSignal {
    private readonly stopAfterMs;
    private readonly resendMs;
    private readonly post;
    private readonly nowFn;
    private lastSentAt;
    private lastActiveSent;
    private stopTimer;
    private stopped;
    constructor(room: {
        post: (payload: unknown) => Promise<unknown>;
    }, opts?: {
        stopAfterMs?: number;
        resendMs?: number;
        now?: () => number;
        sleep?: (ms: number) => Promise<void>;
    });
    /**
     * Call on every keystroke. Debounced: sends `typing:true` at most once
     * per resendMs while typing continues; schedules the auto-stop.
     */
    keystroke(): Promise<void>;
    /** Explicit stop (send button pressed, composer cleared). */
    finish(): Promise<void>;
    /** Permanently stop (room closed). Cancels pending timers. */
    dispose(): void;
}
