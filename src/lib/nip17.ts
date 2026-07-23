import { getEventHash, verifyEvent } from 'nostr-tools/pure';
import type { UnsignedEvent } from 'nostr-tools/pure';
import { createWrap } from 'nostr-tools/nip59';
import { GiftWrap, PrivateDirectMessage, Seal } from 'nostr-tools/kinds';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { isNostrId } from './nostrId';

/** Inner event kinds that 2140.wtf routes through the NIP-17 inbox. */
export const NIP17_DM_KIND = PrivateDirectMessage;
export const NIP17_ORDER_KIND = 16;
export const NIP17_RECEIPT_KIND = 17;
export const NIP17_INNER_KINDS = [NIP17_DM_KIND, NIP17_ORDER_KIND, NIP17_RECEIPT_KIND] as const;

export interface Nip17Message {
  id: string;
  wrapId: string;
  kind: number;
  sender: string;
  recipients: string[];
  content: string;
  tags: string[][];
  createdAt: number;
  replyTo?: string;
  subject?: string;
}

/** A NIP-59 rumor: an unsigned kind 14 event with a computed id. */
export type Rumor = UnsignedEvent & { id: string };

/** Two-day jitter used by NIP-59 seals and gift wraps. */
const TWO_DAYS = 2 * 24 * 60 * 60;

const MAX_DM_CONTENT_LENGTH = 16000;
const MAX_CLOCK_SKEW_SECONDS = 300;

function randomNow(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

/**
 * Build a NIP-17 private direct message rumor (kind 14).
 *
 * A "rumor" is an unsigned event template. It will be sealed and gift-wrapped
 * before publishing. This mirrors Snort's `EventPublisher.createUnsigned`.
 */
export async function createNip17Rumor(
  signer: NostrSigner,
  recipientPubkeys: string[],
  content: string,
  options?: {
    kind?: number;
    subject?: string;
    replyTo?: { eventId: string; relayUrl?: string };
    extraTags?: string[][];
  },
): Promise<Rumor> {
  const tags: string[][] = recipientPubkeys.map((pk) => ['p', pk]);
  if (options?.replyTo) {
    tags.push(['e', options.replyTo.eventId, options.replyTo.relayUrl ?? '', 'reply']);
  }
  if (options?.subject) {
    tags.push(['subject', options.subject]);
  }
  if (options?.extraTags) {
    tags.push(...options.extraTags);
  }

  const pubkey = await signer.getPublicKey();

  const rumor: UnsignedEvent = {
    kind: options?.kind ?? PrivateDirectMessage,
    content,
    tags,
    created_at: Math.ceil(Date.now() / 1000),
    pubkey,
  };

  return { ...rumor, id: getEventHash(rumor) };
}

/**
 * Seal a NIP-17 rumor (kind 13) for a recipient.
 *
 * The seal is signed by the sender and NIP-44-encrypted to the recipient.
 * This mirrors Snort's `EventPublisher.sealRumor` but uses a generic
 * NostrSigner instead of a raw secret key.
 */
export async function sealNip17Rumor(
  signer: NostrSigner,
  rumor: Rumor,
  recipientPubkey: string,
): Promise<NostrEvent> {
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 encryption');
  }

  const encryptedContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));

  return signer.signEvent({
    kind: Seal,
    content: encryptedContent,
    created_at: randomNow(),
    tags: [],
  });
}

/**
 * Gift-wrap a NIP-17 seal (kind 1059) for a recipient.
 *
 * The gift wrap is signed by a fresh ephemeral key and NIP-44-encrypted to
 * the recipient. Uses nostr-tools/nip59 `createWrap`.
 */
export function giftWrapNip17Seal(seal: NostrEvent, recipientPubkey: string): NostrEvent {
  return createWrap(seal, recipientPubkey);
}

/**
 * Build a complete NIP-17 gift wrap (kind 1059) from a rumor for a recipient.
 *
 * Convenience helper that chains `sealNip17Rumor` + `giftWrapNip17Seal`.
 */
export async function buildNip17GiftWrap(
  signer: NostrSigner,
  recipientPubkey: string,
  rumor: Rumor,
): Promise<NostrEvent> {
  const seal = await sealNip17Rumor(signer, rumor, recipientPubkey);
  return giftWrapNip17Seal(seal, recipientPubkey);
}

/**
 * Build and return gift wraps for every recipient plus a self-copy.
 *
 * Senders cannot decrypt messages encrypted to others, so we encrypt a copy
 * to ourselves using the same rumor. This mirrors Snort's DM send loop.
 */
export async function buildNip17GiftWraps(
  signer: NostrSigner,
  recipientPubkeys: string[],
  content: string,
  options?: {
    kind?: number;
    subject?: string;
    replyTo?: { eventId: string; relayUrl?: string };
    extraTags?: string[][];
  },
): Promise<{ rumor: Rumor; wraps: NostrEvent[] }> {
  const senderPubkey = await signer.getPublicKey();
  const allRecipients = new Set([...recipientPubkeys, senderPubkey]);

  const rumor = await createNip17Rumor(signer, recipientPubkeys, content, options);
  const wraps: NostrEvent[] = [];

  for (const recipient of allRecipients) {
    wraps.push(await buildNip17GiftWrap(signer, recipient, rumor));
  }

  return { rumor, wraps };
}

/**
 * Unwrap a kind 1059 gift wrap event addressed to the recipient.
 *
 * Returns the inner kind 13 seal event, or null if decryption fails.
 * Mirrors Snort's `EventPublisher.unwrapGift`.
 */
function verifyEventHashAndSig(event: NostrEvent): boolean {
  try {
    return getEventHash(event) === event.id && verifyEvent(event);
  } catch {
    return false;
  }
}

export async function unwrapNip17GiftWrap(
  wrap: NostrEvent,
  signer: NostrSigner,
): Promise<NostrEvent | null> {
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 encryption');
  }

  if (wrap.kind !== GiftWrap) return null;
  if (!verifyEventHashAndSig(wrap)) return null;

  try {
    const plaintext = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
    const seal = JSON.parse(plaintext) as NostrEvent;
    if (!verifyEventHashAndSig(seal)) return null;
    return seal;
  } catch {
    return null;
  }
}

/**
 * Unseal a kind 13 seal event.
 *
 * Returns the inner kind 14 rumor, or null if decryption fails.
 * Verifies that the seal author matches the rumor author (NIP-17 auth check).
 * Mirrors Snort's `EventPublisher.unsealRumor`.
 */
function isStringArrayArray(value: unknown): value is string[][] {
  return (
    Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every((x) => typeof x === 'string'))
  );
}

function hasValidRumorShape(rumor: Rumor): boolean {
  return (
    typeof rumor.id === 'string' &&
    typeof rumor.pubkey === 'string' &&
    typeof rumor.content === 'string' &&
    typeof rumor.created_at === 'number' &&
    Number.isFinite(rumor.created_at) &&
    typeof rumor.kind === 'number' &&
    isStringArrayArray(rumor.tags)
  );
}

export async function unsealNip17Rumor(
  seal: NostrEvent,
  signer: NostrSigner,
): Promise<Rumor | null> {
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 encryption');
  }

  if (seal.kind !== Seal) return null;

  try {
    const plaintext = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const rumor = JSON.parse(plaintext) as Rumor;

    // NIP-17: seal author MUST match rumor author, otherwise anyone can
    // impersonate another sender by changing the pubkey in the rumor.
    if (rumor.pubkey !== seal.pubkey) return null;
    if (!hasValidRumorShape(rumor)) return null;
    if (getEventHash(rumor) !== rumor.id) return null;

    return rumor;
  } catch {
    return null;
  }
}

/**
 * Fully unwrap a kind 1059 gift wrap to a Nip17Message.
 *
 * Returns null if any layer fails or the inner event is not a supported DM kind.
 */
export async function unwrapNip17Message(
  wrap: NostrEvent,
  signer: NostrSigner,
): Promise<Nip17Message | null> {
  const seal = await unwrapNip17GiftWrap(wrap, signer);
  if (!seal) return null;

  const rumor = await unsealNip17Rumor(seal, signer);
  if (!rumor) return null;

  return parseNip17Rumor(rumor, wrap.id);
}

/**
 * Parse a decrypted NIP-17 rumor into a Nip17Message.
 *
 * The optional `wrapId` is the id of the kind 1059 gift wrap that contained
 * this rumor, used for deduplication.
 */
export function parseNip17Rumor(
  rumor: NostrEvent | Rumor,
  wrapId?: string,
): Nip17Message | null {
  if (!NIP17_INNER_KINDS.includes(rumor.kind as typeof NIP17_INNER_KINDS[number])) return null;
  if (!hasValidRumorShape(rumor)) return null;
  if (!isNostrId(rumor.pubkey)) return null;
  if (getEventHash(rumor) !== rumor.id) return null;
  if (rumor.content.length > MAX_DM_CONTENT_LENGTH) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (rumor.created_at > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null;

  const recipients = rumor.tags
    .filter(([name]) => name === 'p')
    .map(([, pubkey]) => pubkey)
    .filter((pubkey): pubkey is string => typeof pubkey === 'string' && isNostrId(pubkey));

  const replyTo = rumor.tags.find(([name]) => name === 'e')?.[1];
  const subject = rumor.tags.find(([name]) => name === 'subject')?.[1];

  return {
    id: rumor.id,
    wrapId: wrapId ?? rumor.id,
    kind: rumor.kind,
    sender: rumor.pubkey,
    recipients,
    content: rumor.content,
    tags: rumor.tags,
    createdAt: rumor.created_at,
    ...(replyTo ? { replyTo } : {}),
    ...(subject ? { subject } : {}),
  };
}

/**
 * Generate a deterministic conversation id from sorted participant pubkeys.
 *
 * Mirrors Snort's `computeChatId` format: a stable identifier that changes
 * only when the participant set changes.
 */
export function computeNip17ConversationId(participants: string[]): string {
  const sorted = [...new Set(participants)].sort();
  return `nip17:${sorted.join(',')}`;
}

/**
 * Extract the participant list for a conversation from a message.
 *
 * Returns the sorted list of pubkeys excluding the viewer.
 */
export function getNip17Participants(message: Nip17Message, viewerPubkey: string): string[] {
  const all = [message.sender, ...message.recipients].filter((pk) => pk !== viewerPubkey);
  return [...new Set(all)].sort();
}

/** Extract DM relay URLs from a kind 10050 Direct Message Relays event. */
export function getNip17DmRelays(event: NostrEvent): string[] {
  if (event.kind !== 10050) return [];
  const relays = event.tags
    .filter(([name, url]) => name === 'relay' && typeof url === 'string')
    .map(([, url]) => url as string)
    .filter((url) => /^wss?:\/\//.test(url));
  return [...new Set(relays)];
}
