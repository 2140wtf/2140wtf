import { describe, expect, it } from 'vitest';
import { createJoinLink } from '@/baofund/community/client.js';
import { validateRoomInvite } from './roomInvite';

const link = (opts: Parameters<typeof createJoinLink>[3] = {}) => createJoinLink('example.invalid', 'ab'.repeat(32), 'room', {
  relay: 'wss://relay.example', welcomerPub: 'cd'.repeat(32), routingId: 'ef'.repeat(32), ...opts,
});
describe('shared browser and agent invite validation', () => {
  it.each(['agent', 'human'] as const)('admits the same link shape for %s audience', audience => {
    expect(validateRoomInvite(link({ audience }), 100).audience).toBe(audience);
  });
  it('preserves shield and routing fields without resolving or executing instructions', () => {
    const parts = validateRoomInvite(link({ shield: '12'.repeat(32), label: 'test' }), 100);
    expect(parts.routingId).toBe('ef'.repeat(32));
    expect(parts.shield).toBe('12'.repeat(32));
  });
  it.each(['https://relay.example', 'wss://user:secret@relay.example', 'wss://relay.example/#secret'])('rejects unsafe relay %s', relay => {
    expect(() => validateRoomInvite(link({ relay }), 100)).toThrow('Invalid, incomplete or expired room invite');
  });
  it('rejects expiry at the exact boundary and incomplete routing', () => {
    expect(() => validateRoomInvite(link({ expiresAt: 100 }), 100)).toThrow();
    expect(validateRoomInvite(link({ expiresAt: 101 }), 100).expiresAt).toBe(101);
    expect(() => validateRoomInvite(link({ welcomerPub: undefined }), 100)).toThrow();
  });
  it('does not expose malformed input in errors', () => {
    const secret = 'malformed-bearer-material';
    try { validateRoomInvite(secret); expect.unreachable(); } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
