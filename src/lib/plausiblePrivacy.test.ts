import { describe, expect, it } from 'vitest';
import { sanitizePlausibleRequest, type AnalyticsRequest } from './plausiblePrivacy';

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
});
