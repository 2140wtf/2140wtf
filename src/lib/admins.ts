import { nip19 } from "nostr-tools";

/**
 * The 2140.wtf operator identities. The first (and currently only) entry is
 * the 2140wtf npub: the only identity the bao relay's write policy honors for
 * admin-moderated NIP-09 deletion of Concord-family events (wraps, bundles,
 * vaults) authored by ANYONE — see docs/BAO_RELAY_ADMIN_DELETION.md.
 */
export const ADMIN_NPUBS = ["npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j"] as const;

/** Hex pubkeys of {@link ADMIN_NPUBS} (decoded once at module load). */
export const ADMIN_PUBKEYS: string[] = ADMIN_NPUBS.map((npub) => {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub") throw new Error("ADMIN_NPUBS must contain npub identifiers");
  return decoded.data;
});

/** Whether the pubkey belongs to a 2140.wtf operator. */
export function isAdminPubkey(pubkey: string | undefined): boolean {
  return Boolean(pubkey) && ADMIN_PUBKEYS.includes(pubkey!);
}
