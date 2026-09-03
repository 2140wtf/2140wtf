export const BAO_HOSTED_ORIGIN = 'https://2140.social';
export const BAO_HOSTED_RELAY = 'wss://2140.social/ws';

/** Fail closed before constructing a socket from invite-derived data. */
export function assertBaoHostedRelay(relay: string | undefined): asserts relay is string {
  if (relay !== BAO_HOSTED_RELAY) {
    throw new Error('Hosted ₿AO Chat invite has an unexpected relay');
  }
}
