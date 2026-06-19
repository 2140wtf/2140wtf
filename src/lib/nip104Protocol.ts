/**
 * NIP-104 (NIP-EE) Protocol Implementation
 *
 * E2EE group messaging using a Group Ratchet fallback.
 *
 * Event Kinds:
 *   - 443: KeyPackage Event (not used in Group Ratchet mode, but reserved)
 *   - 444: Welcome Event - Invites new members (gift-wrapped via NIP-59)
 *   - 445: Group Event - All encrypted group messages
 *   - 10051: KeyPackage Relays List (reserved)
 *
 * This implementation uses Group Ratchet instead of real MLS. It is
 * wire-compatible with Bao Chat's fallback mode for these event kinds.
 */

import {
  getPublicKey,
  generateSecretKey,
  finalizeEvent,
  verifyEvent,
  nip44,
} from 'nostr-tools';
import { isNostrId } from './nostrId';
import type { UnsignedEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(digest);
}

/**
 * secp256k1 curve order (n). A valid private key must satisfy 0 < k < n.
 */
const SECP256K1_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

const TWO_DAYS = 2 * 24 * 60 * 60;

function randomNow(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

/**
 * Derive a valid secp256k1 private key from an opaque exporter secret.
 * The raw exporter secret is not guaranteed to be a valid secp256k1 private key,
 * so we hash it with a domain tag and counter until the result is in range.
 */
export async function deriveEncryptionPrivkey(exporterSecret: string): Promise<string> {
  const input = hexToBytes(exporterSecret);
  const domainTag = new TextEncoder().encode('ditto-grp-nip44-key');

  for (let counter = 0; counter < 256; counter++) {
    const counterByte = new Uint8Array([counter]);
    const combined = new Uint8Array(domainTag.length + input.length + counterByte.length);
    combined.set(domainTag);
    combined.set(input, domainTag.length);
    combined.set(counterByte, domainTag.length + input.length);
    const hash = await sha256(combined);
    const hashHex = bytesToHex(hash);
    const keyValue = BigInt(`0x${hashHex}`);
    if (keyValue > 0n && keyValue < SECP256K1_ORDER) {
      return hashHex;
    }
  }
  throw new Error('Failed to derive valid secp256k1 key after 256 attempts');
}

export const KIND_KEYPACKAGE = 443;
export const KIND_WELCOME = 444;
export const KIND_GROUP = 445;
export const KIND_KEYPACKAGE_RELAYS = 10051;
export const KIND_GIFT_WRAP = 1059;

export const MLS_PROTOCOL_VERSION = '1.0';
export const DEFAULT_CIPHERSUITE = '0x0001';

export interface NostrGroupData {
  nostrGroupId: string;
  name: string;
  description?: string;
  adminPubkeys: string[];
  relays: string[];
}

export interface MLSGroupState {
  nostrGroupId: string;
  mlsGroupId: string;
  epoch: number;
  metadata: NostrGroupData;
  members: string[];
  exporterSecret: string;
  rootSecret?: string;
  lastEventId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MLSApplicationMessage {
  id: string;
  kind: number;
  senderPubkey: string;
  content: string;
  createdAt: number;
  tags?: string[][];
}

function validateRelayUrls(urls: unknown[]): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((r): r is string => typeof r === 'string' && /^wss?:\/\//.test(r));
}

export function createNostrGroupDataExtension(data: NostrGroupData): string {
  return JSON.stringify(data);
}

export function parseNostrGroupDataExtension(json: unknown): NostrGroupData | null {
  if (typeof json !== 'string') return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.nostrGroupId !== 'string' ||
      typeof p.name !== 'string' ||
      !Array.isArray(p.adminPubkeys) ||
      !Array.isArray(p.relays)
    ) {
      return null;
    }
    return {
      nostrGroupId: p.nostrGroupId,
      name: p.name,
      description: typeof p.description === 'string' ? p.description : undefined,
      adminPubkeys: p.adminPubkeys.filter((k): k is string => typeof k === 'string' && isNostrId(k)),
      relays: validateRelayUrls(p.relays),
    };
  } catch {
    return null;
  }
}

export function createKeyPackageEvent(
  userPubkey: string,
  relays: string[],
): NostrEvent {
  const template: UnsignedEvent = {
    pubkey: userPubkey,
    created_at: randomNow(),
    kind: KIND_KEYPACKAGE,
    tags: [
      ['mls_protocol_version', MLS_PROTOCOL_VERSION],
      ['ciphersuite', DEFAULT_CIPHERSUITE],
      ['extensions', ''],
      ['relays', ...relays],
      ['-'],
    ],
    content: '',
  };
  return finalizeEvent(template, generateSecretKey()) as unknown as NostrEvent;
}

export function createWelcomeEvent(
  senderPrivkey: Uint8Array,
  welcomeData: string,
  keyPackageEventId: string,
  groupRelays: string[],
  epoch: number,
): NostrEvent {
  const template: UnsignedEvent = {
    pubkey: getPublicKey(senderPrivkey),
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_WELCOME,
    tags: [
      ['e', keyPackageEventId],
      ['relays', ...groupRelays],
      ['epoch', String(epoch)],
    ],
    content: welcomeData,
  };
  return finalizeEvent(template, senderPrivkey) as unknown as NostrEvent;
}

export async function wrapWelcomeEvent(
  welcomeEvent: NostrEvent,
  recipientPubkey: string,
): Promise<NostrEvent> {
  const ephemeralPrivkey = generateSecretKey();
  const innerJson = JSON.stringify(welcomeEvent);
  const conversationKey = nip44.getConversationKey(ephemeralPrivkey, recipientPubkey);
  const encryptedContent = nip44.encrypt(innerJson, conversationKey);

  const randomBytes = crypto.getRandomValues(new Uint8Array(4));
  const randomValue = new DataView(randomBytes.buffer, randomBytes.byteOffset, 4).getUint32(
    0,
    true,
  );
  const jitter = randomValue % 300;

  const template: UnsignedEvent = {
    created_at: Math.max(0, Math.floor(Date.now() / 1000) - jitter),
    kind: KIND_GIFT_WRAP,
    tags: [['p', recipientPubkey]],
    content: encryptedContent,
    pubkey: getPublicKey(ephemeralPrivkey),
  };

  return finalizeEvent(template, ephemeralPrivkey) as unknown as NostrEvent;
}

export async function unwrapWelcomeEvent(
  giftWrapEvent: NostrEvent,
  recipientPrivkey: Uint8Array,
): Promise<NostrEvent | null> {
  if (giftWrapEvent.kind !== KIND_GIFT_WRAP) return null;

  let sigValid = false;
  try {
    sigValid = verifyEvent(giftWrapEvent as Parameters<typeof verifyEvent>[0]);
  } catch {
    sigValid = false;
  }
  if (!sigValid) {
    console.warn('[NIP104] Dropping gift wrap with invalid signature');
    return null;
  }

  try {
    const conversationKey = nip44.getConversationKey(recipientPrivkey, giftWrapEvent.pubkey);
    const decryptedJson = nip44.decrypt(giftWrapEvent.content, conversationKey);
    const innerEvent = JSON.parse(decryptedJson) as unknown;

    if (typeof innerEvent !== 'object' || innerEvent === null) return null;
    const ev = innerEvent as NostrEvent;
    if (ev.kind !== KIND_WELCOME) return null;

    let innerSigValid = false;
    try {
      innerSigValid = verifyEvent(ev as Parameters<typeof verifyEvent>[0]);
    } catch {
      innerSigValid = false;
    }
    if (!innerSigValid) {
      console.warn('[NIP104] Dropping Welcome event with invalid inner signature');
      return null;
    }

    if (
      typeof ev.content !== 'string' ||
      typeof ev.pubkey !== 'string' ||
      !isStringArrayArray(ev.tags)
    ) {
      return null;
    }

    return ev;
  } catch (decryptErr) {
    console.debug('[NIP104] Welcome unwrap failed:', decryptErr);
    return null;
  }
}

export function createApplicationMessage(
  senderPubkey: string,
  senderPrivkey: Uint8Array,
  content: string,
  groupId: string,
  epoch: number,
): string {
  const rumor: UnsignedEvent = {
    kind: 9,
    content,
    tags: [
      ['h', groupId],
      ['epoch', String(epoch)],
    ],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: senderPubkey,
  };
  const event = finalizeEvent(rumor, senderPrivkey);
  return JSON.stringify(event);
}

export function parseApplicationMessage(json: string): MLSApplicationMessage | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const ev = parsed as NostrEvent;
    if (
      typeof ev.kind !== 'number' ||
      typeof ev.pubkey !== 'string' ||
      typeof ev.content !== 'string' ||
      typeof ev.created_at !== 'number' ||
      typeof ev.id !== 'string' ||
      typeof ev.sig !== 'string' ||
      !isStringArrayArray(ev.tags)
    ) {
      return null;
    }
    if (ev.kind !== 9) return null;

    let sigValid = false;
    try {
      sigValid = verifyEvent(ev as Parameters<typeof verifyEvent>[0]);
    } catch {
      sigValid = false;
    }
    if (!sigValid) return null;

    return {
      id: ev.id,
      kind: ev.kind,
      senderPubkey: ev.pubkey,
      content: ev.content,
      createdAt: ev.created_at,
      tags: ev.tags,
    };
  } catch {
    return null;
  }
}

function isStringArrayArray(value: unknown): value is string[][] {
  return (
    Array.isArray(value) && value.every((item) => Array.isArray(item) && item.every((x) => typeof x === 'string'))
  );
}

export async function createGroupEvent(
  nostrGroupId: string,
  mlsMessage: string,
  exporterSecret: string,
  epoch: number,
): Promise<NostrEvent> {
  const ephemeralPrivkey = generateSecretKey();
  const derivedPrivkey = await deriveEncryptionPrivkey(exporterSecret);
  const derivedPubkey = getPublicKey(hexToBytes(derivedPrivkey));

  const conversationKey = nip44.getConversationKey(
    hexToBytes(derivedPrivkey),
    derivedPubkey,
  );
  const encryptedContent = nip44.encrypt(mlsMessage, conversationKey);

  const template: UnsignedEvent = {
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_GROUP,
    tags: [
      ['h', nostrGroupId],
      ['epoch', String(epoch)],
    ],
    content: encryptedContent,
    pubkey: getPublicKey(ephemeralPrivkey),
  };

  return finalizeEvent(template, ephemeralPrivkey) as unknown as NostrEvent;
}

export async function decryptGroupEvent(
  event: NostrEvent,
  exporterSecret: string,
): Promise<string | null> {
  try {
    const derivedPrivkey = await deriveEncryptionPrivkey(exporterSecret);
    const derivedPubkey = getPublicKey(hexToBytes(derivedPrivkey));
    const conversationKey = nip44.getConversationKey(
      hexToBytes(derivedPrivkey),
      derivedPubkey,
    );
    return nip44.decrypt(event.content, conversationKey);
  } catch {
    return null;
  }
}

export function isValidGroupId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}
