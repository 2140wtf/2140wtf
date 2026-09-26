import type { RoomSession } from '@/baofund/community/client.js';
import type { MergeResult } from '@/baofund/community/merge.js';
import type { Envelope } from '@/baofund/community/envelope.js';

const POLL_MS = 2_000;
const RESEND_MS = 45_000;
/** Default receipt budget (interactive UI posts). Agent/IPC callers pass a
 *  shorter `deadlineMs`: the boundary serializes requests, so a 180s poll
 *  starves every other verb for three minutes. */
export const DEFAULT_RECEIPT_DEADLINE_MS = 180_000;
const MAX_RESENDS = 3;
class ReceiptTimeout extends Error {}

/** Stop waiting without leaving abort listeners or unhandled late rejections.
 * The library has no I/O cancellation API; the room owner closes its socket. */
function interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Relay acceptance is pending. Only a decoded merged scroll containing the
 *  same author AND message id confirms storage. No synthetic censorship verdict.
 *  Poll sequentially, resend the original envelope at most three times, and
 *  bound the entire operation (including slow I/O) to `deadlineMs` (default
 *  DEFAULT_RECEIPT_DEADLINE_MS). */
export async function postWithReceipt(
  session: Pick<RoomSession, 'post' | 'read' | 'republish'>,
  payload: unknown,
  opts: { signal: AbortSignal; onPublished: (envelope: Envelope) => void; deadlineMs?: number },
): Promise<{ envelope: Envelope; state: 'confirmed'; scroll: MergeResult } | { envelope: Envelope; state: 'timeout' }> {
  opts.signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(opts.signal.reason);
  opts.signal.addEventListener('abort', abort, { once: true });
  const deadlineMs = opts.deadlineMs ?? DEFAULT_RECEIPT_DEADLINE_MS;
  const timeout = setTimeout(() => controller.abort(new ReceiptTimeout('receipt deadline exceeded')), deadlineMs);
  const signal = controller.signal;
  let envelope: Envelope | undefined;
  try {
    envelope = await interruptible(session.post(payload), signal);
    signal.throwIfAborted();
    opts.onPublished(envelope);
    let nextResend = Date.now() + RESEND_MS;
    let resends = 0;
    for (;;) {
      await pause(POLL_MS, signal);
      signal.throwIfAborted();
      const result = await interruptible(session.read(), signal);
      signal.throwIfAborted();
      if (result.messages.some(m => m.envelope.author === envelope!.author && m.envelope.msg_id === envelope!.msg_id)) {
        return { envelope, state: 'confirmed', scroll: result };
      }
      if (resends < MAX_RESENDS && Date.now() >= nextResend) {
        await interruptible(session.republish(envelope), signal);
        signal.throwIfAborted();
        resends++;
        nextResend = Date.now() + RESEND_MS;
      }
    }
  } catch (err) {
    if (err instanceof ReceiptTimeout && envelope) return { envelope, state: 'timeout' };
    throw err;
  } finally {
    clearTimeout(timeout);
    opts.signal.removeEventListener('abort', abort);
  }
}
