import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Envelope } from '@/baofund/community/envelope.js';
import type { RoomSession } from '@/baofund/community/client.js';
import { postWithReceipt } from './postWithReceipt';

const envelope = { msg_id: 'message-id', author: 'author-a', payload: { text: 'hello' } } as Envelope;
function scroll(messages: Envelope[] = []) {
  return { messages: messages.map(envelope => ({ envelope, redacted: false, scribes: [] })), coverage: new Map(), rejected: [], chainWarnings: [] } as Awaited<ReturnType<RoomSession['read']>>;
}
function setup() {
  const session = { post: vi.fn(async () => envelope), read: vi.fn(async () => scroll()), republish: vi.fn(async () => {}) };
  const controller = new AbortController();
  const onPublished = vi.fn();
  return { session, controller, onPublished, start: () => postWithReceipt(session, { text: 'hello' }, { signal: controller.signal, onPublished }) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
it('checks at two seconds and confirms without waiting 45 seconds', async () => {
  const t = setup(); t.session.read.mockResolvedValue(scroll([envelope]));
  const result = t.start();
  await vi.advanceTimersByTimeAsync(1_999);
  expect(t.onPublished).toHaveBeenCalledWith(envelope);
  expect(t.session.read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ envelope, state: 'confirmed', scroll: scroll([envelope]) });
  expect(t.session.republish).not.toHaveBeenCalled();
});
it('does not confirm another author with the same message id', async () => {
  const t = setup(); t.session.read.mockResolvedValue(scroll([{ ...envelope, author: 'another-author' }]));
  const result = t.start();
  await vi.advanceTimersByTimeAsync(180_000);
  await expect(result).resolves.toEqual({ envelope, state: 'timeout' });
  expect(t.session.republish).toHaveBeenCalledTimes(3);
  for (const [resent] of t.session.republish.mock.calls as unknown as [Envelope][]) expect(resent).toBe(envelope);
});
it('keeps relay acceptance pending when no scribes confirm it', async () => {
  const t = setup(); const result = t.start();
  await vi.advanceTimersByTimeAsync(44_000);
  expect(t.session.republish).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(t.session.republish).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(134_000);
  await expect(result).resolves.toEqual({ envelope, state: 'timeout' });
  expect(t.session.republish).toHaveBeenCalledTimes(3);
});
it('bounds a hung scroll read and never overlaps reads', async () => {
  const t = setup(); t.session.read.mockReturnValue(new Promise(() => {}));
  const result = t.start();
  await vi.advanceTimersByTimeAsync(180_000);
  await expect(result).resolves.toEqual({ envelope, state: 'timeout' });
  expect(t.session.read).toHaveBeenCalledTimes(1);
  expect(t.session.republish).not.toHaveBeenCalled();
});
it('bounds a hung initial publish without reporting a receipt', async () => {
  const t = setup(); t.session.post.mockReturnValue(new Promise(() => {}));
  const result = expect(t.start()).rejects.toThrow('receipt deadline exceeded');
  await vi.advanceTimersByTimeAsync(180_000); await result;
  expect(t.onPublished).not.toHaveBeenCalled();
});
it.each(['publish', 'sleep', 'read'])('cancels during %s without retries or late callbacks', async phase => {
  const t = setup(); let resolvePublish!: (e: Envelope) => void;
  if (phase === 'publish') t.session.post.mockReturnValue(new Promise(resolve => { resolvePublish = resolve; }));
  if (phase === 'read') t.session.read.mockReturnValue(new Promise(() => {}));
  const result = expect(t.start()).rejects.toThrow('room closed');
  await vi.advanceTimersByTimeAsync(phase === 'read' ? 2_000 : 0);
  t.controller.abort(new Error('room closed'));
  await result;
  if (resolvePublish) resolvePublish(envelope);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(t.session.republish).not.toHaveBeenCalled();
  if (phase === 'publish') expect(t.onPublished).not.toHaveBeenCalled();
});
it('never publishes with an already cancelled signal', async () => {
  const t = setup(); t.controller.abort(new Error('closed'));
  await expect(t.start()).rejects.toThrow('closed');
  expect(t.session.post).not.toHaveBeenCalled();
});
it('propagates a relay rejection immediately', async () => {
  const t = setup(); t.session.post.mockRejectedValue(new Error('relay rejected event'));
  await expect(t.start()).rejects.toThrow('relay rejected event');
  expect(t.session.read).not.toHaveBeenCalled();
  expect(t.onPublished).not.toHaveBeenCalled();
});
it('confirms a later scroll after resending the original envelope', async () => {
  const t = setup(); const result = t.start();
  await vi.advanceTimersByTimeAsync(46_000);
  expect(t.session.republish).toHaveBeenCalledTimes(1);
  t.session.read.mockResolvedValue(scroll([envelope]));
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(result).resolves.toEqual({ envelope, state: 'confirmed', scroll: scroll([envelope]) });
  expect(t.session.post).toHaveBeenCalledTimes(1);
});
it('surfaces a failed resend and clears the deadline', async () => {
  const t = setup(); t.session.republish.mockRejectedValue(new Error('relay rejected resend'));
  const result = expect(t.start()).rejects.toThrow('relay rejected resend');
  await vi.advanceTimersByTimeAsync(46_000); await result;
});
