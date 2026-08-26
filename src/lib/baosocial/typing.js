const MAX_TYPING_BYTES = 64;
/** Build a typing payload (encrypted in-envelope). */
export function buildTyping(active) {
    return { typing: active };
}
/** Parse a typing payload, or null when the payload is not a typing signal. */
export function parseTyping(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const t = payload.typing;
    if (typeof t !== 'boolean' && t !== undefined)
        return null;
    if (t === undefined)
        return null;
    if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_TYPING_BYTES)
        return null;
    return { active: t };
}
/**
 * Client-side typing etiquette. Wrap a RoomSession-shaped object (needs
 * post() and subscribeLive()) without importing it — keeps this module
 * dependency-light and testable against stubs.
 */
export class TypingSignal {
    constructor(room, opts = {}) {
        this.lastSentAt = -Infinity;
        this.lastActiveSent = false;
        this.stopTimer = null;
        this.stopped = false;
        this.stopAfterMs = opts.stopAfterMs ?? 4000;
        this.resendMs = opts.resendMs ?? 2500;
        this.nowFn = opts.now ?? (() => Date.now());
        this.post = (payload) => room.post(payload);
    }
    /**
     * Call on every keystroke. Debounced: sends `typing:true` at most once
     * per resendMs while typing continues; schedules the auto-stop.
     */
    async keystroke() {
        if (this.stopped)
            return;
        const now = this.nowFn();
        if (!this.lastActiveSent || now - this.lastSentAt >= this.resendMs) {
            await this.post(buildTyping(true));
            this.lastSentAt = now;
            this.lastActiveSent = true;
        }
        if (this.stopTimer)
            clearTimeout(this.stopTimer);
        // Auto-stop: silence beyond stopAfterMs cancels the indicator. The
        // timer only fires the POST — state bookkeeping happens in finish().
        this.stopTimer = setTimeout(() => {
            void this.finish().catch(() => { });
        }, this.stopAfterMs);
        this.stopTimer.unref?.();
    }
    /** Explicit stop (send button pressed, composer cleared). */
    async finish() {
        if (this.stopTimer) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
        if (this.lastActiveSent) {
            try {
                await this.post(buildTyping(false));
            }
            finally {
                this.lastActiveSent = false;
            }
        }
    }
    /** Permanently stop (room closed). Cancels pending timers. */
    dispose() {
        this.stopped = true;
        if (this.stopTimer) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
    }
}
