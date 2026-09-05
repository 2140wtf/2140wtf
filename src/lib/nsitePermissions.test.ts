import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearNsitePermissions,
  getNsiteAllowance,
  getNsitePermission,
  setNsitePermission,
} from './nsitePermissions';

const userPubkey = 'a'.repeat(64);
const siteId = 'site.example';

function key(value: unknown): void {
  localStorage.setItem('nostr:nsite-permissions', JSON.stringify(value));
}

describe('nsite permission persistence', () => {
  beforeEach(() => localStorage.clear());

  it('fails closed when stored JSON is malformed or has invalid permission shapes', () => {
    key([{ siteId, siteName: 'Site', userPubkey, permissions: [{ type: 'signEvent', kind: 'not-a-number', allowed: true }], createdAt: Date.now() }]);
    expect(getNsitePermission(siteId, userPubkey, 'signEvent', 1)).toBe('ask');
    expect(getNsiteAllowance(siteId, userPubkey)).toBeUndefined();

    key('{not-json');
    expect(getNsitePermission(siteId, userPubkey, 'nip44.encrypt')).toBe('ask');
  });

  it('accepts scoped valid decisions and replaces the same operation', () => {
    setNsitePermission(siteId, userPubkey, 'Site', 'signEvent', 1, true);
    setNsitePermission(siteId, userPubkey, 'Site', 'signEvent', 1, false);

    expect(getNsitePermission(siteId, userPubkey, 'signEvent', 1)).toBe('deny');
    expect(getNsitePermission(siteId, 'b'.repeat(64), 'signEvent', 1)).toBe('ask');
    expect(getNsiteAllowance(siteId, userPubkey)?.permissions).toHaveLength(1);
  });

  it('ignores invalid writes without creating an allowance', () => {
    setNsitePermission(siteId, 'not-a-pubkey', 'Site', 'signEvent', 1, true);
    setNsitePermission('', userPubkey, 'Site', 'signEvent', 1, true);
    setNsitePermission(siteId, userPubkey, 'Site', 'signEvent', -1, true);

    expect(localStorage.getItem('nostr:nsite-permissions')).toBeNull();
  });

  it('clears only the selected user and site scope', () => {
    setNsitePermission(siteId, userPubkey, 'Site', 'nip44.encrypt', null, true);
    setNsitePermission(siteId, 'b'.repeat(64), 'Site', 'nip44.encrypt', null, true);

    clearNsitePermissions(siteId, userPubkey);
    expect(getNsitePermission(siteId, userPubkey, 'nip44.encrypt')).toBe('ask');
    expect(getNsitePermission(siteId, 'b'.repeat(64), 'nip44.encrypt')).toBe('allow');
  });
});
