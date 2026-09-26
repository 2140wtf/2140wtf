/**
 * mainnetMarker - legacy compatibility signal for the real-money rail.
 *
 * The fundraiser API carries a first-class `network` field ('testnet' |
 * 'mainnet'); the feed is authoritative from that field. This marker is the
 * fallback for older records created before the field existed: a mainnet
 * campaign may also carry the machine-readable tag in its description. The
 * feed/card/pledge layers detect either signal, badge the card REAL, and
 * route funding through the donor's mainnet Cashu wallet.
 */

export const MAINNET_CASHU_MARKER = '[rail:mainnet-cashu]';

/** Append the mainnet-cashu marker to a description (idempotent). */
export function markMainnetCashu(description: string): string {
  const clean = stripMainnetMarker(description).trim();
  return clean ? `${clean}\n\n${MAINNET_CASHU_MARKER}` : MAINNET_CASHU_MARKER;
}

/** True when the description carries the mainnet-cashu marker. */
export function isMainnetCashu(description: string | null | undefined): boolean {
  return typeof description === 'string' && description.includes(MAINNET_CASHU_MARKER);
}

/** Remove the marker (and surrounding whitespace) for display. */
export function stripMainnetMarker(description: string): string {
  return description.replace(MAINNET_CASHU_MARKER, '').replace(/\n{3,}/g, '\n\n').trim();
}
