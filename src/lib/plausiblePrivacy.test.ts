import { describe, expect, it } from 'vitest';
import { containsPrivateRoute, sanitizePlausibleRequest, type AnalyticsRequest } from './plausiblePrivacy';

function payload(url: string): AnalyticsRequest {
  return {
    n: 'pageview',
    u: url,
    d: '2140.wtf',
    r: 'https://example.com/private-source?member=alice',
  };
}

describe('sanitizePlausibleRequest', () => {
  it.each([
    'https://2140.wtf/bao/c/community-id',
    'https://2140.wtf/bao/c/community-id/channel-id',
    'https://2140.wtf/bao/invite/naddr1secret#bearer-token',
    'https://2140.wtf/invite/naddr1secret#bearer-token',
    'https://2140.wtf/BAO/C/community-id/channel-id/thread/message-id',
    'https://2140.wtf/Bao/Invite/naddr1secret',
    'https://2140.wtf/Invite/naddr1secret',
  ])('suppresses analytics on private Concord routes: %s', (url) => {
    expect(sanitizePlausibleRequest(payload(url))).toBeNull();
  });

  it('removes query, fragment, and referrer data from public routes', () => {
    expect(sanitizePlausibleRequest(payload('https://2140.wtf/market?campaign=secret#section'))).toEqual({
      n: 'pageview',
      u: 'https://2140.wtf/market',
      d: '2140.wtf',
      r: null,
    });
  });

  it('drops malformed analytics URLs', () => {
    expect(sanitizePlausibleRequest(payload('not a URL'))).toBeNull();
  });

  it('detects private routes nested inside diagnostic payloads', () => {
    expect(containsPrivateRoute({ breadcrumbs: [{ data: { url: '/BAO/C/community/channel' } }] })).toBe(true);
    expect(containsPrivateRoute({ exception: { message: 'GET https://2140.wtf/bao/c/SECRET failed' } })).toBe(true);
    expect(containsPrivateRoute({ breadcrumbs: [{ message: 'Navigated to /bao/invite/naddr1secret' }] })).toBe(true);
    expect(containsPrivateRoute({ spans: [{ description: 'route=https%3A%2F%2F2140.wtf%2Finvite%2Fnaddr1secret' }] })).toBe(true);
    expect(containsPrivateRoute({ transaction: '/market', request: { url: 'https://2140.wtf/market' } })).toBe(false);
  });
});
