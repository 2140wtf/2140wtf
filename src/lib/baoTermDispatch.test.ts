/**
 * Tests for the in-page agent terminal's pure logic — the parser and the
 * dispatcher's JSON-envelope contract. We do NOT exercise the relay I/O
 * (that requires a live relay and NPool); we cover what an agent sees
 * without a relay handy: the command grammar, the failure envelopes, and
 * the help / identities surface.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { dispatchBaoTerm, parseCommandLine } from '@/lib/baoTermDispatch';
import {
  deleteIdentity,
  getIdentity,
  listIdentities,
  PROTOCOL_VERSION,
  saveIdentity,
  setActiveIdentity,
  validateIdentityName,
} from '@/lib/baoTermStore';

// localStorage is provided by the test setup (jsdom). Clear our keys so each
// test starts with an empty roster.
const KEYS_TO_CLEAR = ['2140:bao-term:roster', '2140:bao-term:active'];

beforeEach(() => {
  for (const k of KEYS_TO_CLEAR) localStorage.removeItem(k);
});

describe('parseCommandLine', () => {
  it('parses a bare command', () => {
    const out = parseCommandLine('help');
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.command).toBe('help');
    expect(out.args).toEqual({});
  });

  it('handles empty', () => {
    expect(parseCommandLine('')).toEqual({ error: 'empty' });
  });

  it('handles unterminated quote', () => {
    expect(parseCommandLine('say "hello')).toEqual({ error: 'unterminated quote' });
  });

  it('parses --flag value and --flag=value', () => {
    const out = parseCommandLine('create --name "hangout" --relays=wss://a,wss://b');
    if ('error' in out) throw new Error('expected parse');
    expect(out.command).toBe('create');
    expect(out.args.name).toBe('hangout');
    expect(out.args.relays).toBe('wss://a,wss://b');
  });

  it('parses boolean flags', () => {
    const out = parseCommandLine('create --name x --agent-only');
    if ('error' in out) throw new Error('expected parse');
    expect(out.args.agentOnly).toBe(true);
  });

  it('joins positional args into say text', () => {
    const out = parseCommandLine('say hello world --channel general');
    if ('error' in out) throw new Error('expected parse');
    expect(out.command).toBe('say');
    expect(out.args.text).toBe('hello world');
    expect(out.args.channel).toBe('general');
  });

  it('takes a bare invite URL as positional for join', () => {
    const out = parseCommandLine('join https://2140.wtf/invite/naddr1xyz#token');
    if ('error' in out) throw new Error('expected parse');
    expect(out.command).toBe('join');
    expect(out.args.inviteUrl).toBe('https://2140.wtf/invite/naddr1xyz#token');
  });

  it('takes the first positional for use', () => {
    const out = parseCommandLine('use alice');
    if ('error' in out) throw new Error('expected parse');
    expect(out.command).toBe('use');
    expect(out.args.name).toBe('alice');
  });
});

describe('dispatchBaoTerm — envelopes', () => {
  it('rejects unknown commands with the JSON envelope', async () => {
    const r = await dispatchBaoTerm('bogus');
    expect(r).toEqual({ ok: false, error: 'Unknown command: bogus. Run help.' });
  });

  it('help returns the command catalog', async () => {
    const r = await dispatchBaoTerm('help');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = (r.result as { commands: { cmd: string }[] }).commands.map((c) => c.cmd);
    expect(names).toEqual([
      'create', 'invite', 'join', 'say', 'read',
      'whoami', 'identities', 'use', 'remove', 'help',
    ]);
  });

  it('identities is empty on a clean browser', async () => {
    const r = await dispatchBaoTerm('identities');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({ identities: [], active: null });
  });

  it('whoami returns an envelope error when no identity is set', async () => {
    const r = await dispatchBaoTerm('whoami');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/No active identity/);
  });

  it('use refuses when the identity is unknown', async () => {
    const r = await dispatchBaoTerm('use', { name: 'ghost' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/No identity "ghost"/);
  });
});

describe('baoTermStore — schema stamp', () => {
  it('exposes a PROTOCOL_VERSION constant', () => {
    expect(typeof PROTOCOL_VERSION).toBe('number');
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('validateIdentityName rejects tricksy inputs', () => {
    expect(() => validateIdentityName('')).toThrow();
    expect(() => validateIdentityName('  ')).toThrow();
    expect(() => validateIdentityName('foo bar')).toThrow();
    expect(() => validateIdentityName('../../etc')).toThrow();
    expect(validateIdentityName('alice')).toBe('alice');
    expect(validateIdentityName('agent.1')).toBe('agent.1');
    expect(validateIdentityName('a-b_c.d')).toBe('a-b_c.d');
  });

  it('listIdentities reflects save + delete', () => {
    expect(listIdentities()).toEqual([]);
    saveIdentity({
      sk: '0'.repeat(64),
      role: 'member',
      name: 'test',
      identity_name: 'test',
      registry_version: 0,
      invites: [],
      private_channels: [],
      community: {
        id: '1'.repeat(32),
        owner: '2'.repeat(32),
        owner_salt: '3'.repeat(32),
        community_root: '4'.repeat(32),
        root_epoch: 0,
        name: 'test',
        relays: ['wss://example.com'],
      },
    });
    expect(listIdentities()).toEqual(['test']);
    deleteIdentity('test');
    expect(listIdentities()).toEqual([]);
  });

  it('persists a protocol-version stamp on disk', () => {
    saveIdentity({
      sk: 'f'.repeat(64),
      role: 'member',
      name: 'p',
      identity_name: 'p',
      registry_version: 0,
      invites: [],
      private_channels: [],
      community: {
        id: 'a'.repeat(32), owner: 'b'.repeat(32), owner_salt: 'c'.repeat(32),
        community_root: 'd'.repeat(32), root_epoch: 0, name: 'p', relays: ['wss://e'],
      },
    });
    const raw = JSON.parse(localStorage.getItem('2140:bao-term:roster') || '{}') as Record<string, { protocol_version?: number }>;
    expect(raw.p?.protocol_version).toBe(PROTOCOL_VERSION);
    // The identity read back is still the in-memory shape (no protocol_version leak).
    const id = getIdentity('p');
    expect(id).toBeDefined();
    expect((id as { protocol_version?: number }).protocol_version).toBeUndefined();
    deleteIdentity('p');
  });

  it('refuses identities stamped by a newer binary', () => {
    localStorage.setItem(
      '2140:bao-term:roster',
      JSON.stringify({
        future: {
          sk: '0'.repeat(64), role: 'member', name: 'future', identity_name: 'future',
          registry_version: 0, invites: [], private_channels: [],
          community: {
            id: 'a'.repeat(32), owner: 'b'.repeat(32), owner_salt: 'c'.repeat(32),
            community_root: 'd'.repeat(32), root_epoch: 0, name: 'future', relays: ['wss://e'],
          },
          protocol_version: PROTOCOL_VERSION + 1,
        },
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(listIdentities()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatch(/written by protocol v\d+ but this build speaks v\d+/);
    warn.mockRestore();
  });

  it('drops corrupt entries without failing the whole roster', () => {
    localStorage.setItem('2140:bao-term:roster', JSON.stringify({
      broken: 'this is not an object that matches BaoTermIdentity',
      also_broken: { random: 'junk' },
    }));
    saveIdentity({
      sk: '0'.repeat(64), role: 'member', name: 'legit', identity_name: 'legit',
      registry_version: 0, invites: [], private_channels: [],
      community: {
        id: 'a'.repeat(32), owner: 'b'.repeat(32), owner_salt: 'c'.repeat(32),
        community_root: 'd'.repeat(32), root_epoch: 0, name: 'legit', relays: ['wss://e'],
      },
    });
    expect(listIdentities()).toEqual(['legit']);
    deleteIdentity('legit');
  });

  it('setActiveIdentity is a no-op selector when there are no identities', () => {
    expect(() => setActiveIdentity('ghost')).toThrow(/No identity "ghost"/);
  });
});
