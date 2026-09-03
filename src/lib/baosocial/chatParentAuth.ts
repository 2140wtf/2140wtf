/**
 * Parent-side half of the 2140 Community Chat embedded-auth handshake.
 *
 * The hosted chat origin (2140.social) serves a server-side auth gate to any
 * request without a valid `bao_auth` session cookie. Inside an iframe that
 * cookie is third-party partitioned/blocked, so manual gate login can loop
 * forever. The deployed gate therefore implements a parent bridge
 * (`enableParentAuthentication` in gate-bundle.js) that lets 2140.wtf
 * authenticate the iframe with the SAME identity the user is already logged
 * in with here:
 *
 *   parent → iframe : { type: CHAT_AUTH_OFFER,  pubkey }
 *   iframe → parent : { type: CHAT_AUTH_REQUEST, requestId, challenge }
 *   parent → iframe : { type: CHAT_AUTH_RESPONSE, requestId, event }  // signed kind-22242
 *
 * The iframe verifies the signature server-side, sets its session, and
 * location.reload()s into the real chat. Message types and field shapes here
 * must stay byte-compatible with the gate bundle; only `BAO_HOSTED_ORIGIN`
 * and `https://(www.)2140.wtf` are accepted by the gate on the other side.
 */

import { BAO_HOSTED_ORIGIN, BAO_HOSTED_RELAY } from './relayPolicy';

export const CHAT_AUTH_OFFER = '2140-chat-auth-offer';
export const CHAT_AUTH_REQUEST = '2140-chat-auth-request';
export const CHAT_AUTH_RESPONSE = '2140-chat-auth-response';

/** The gate accepts auth offers only from these parent origins. */
export const CHAT_PARENT_ORIGINS = ['https://2140.wtf', 'https://www.2140.wtf'] as const;

export interface ChatAuthOffer {
  type: typeof CHAT_AUTH_OFFER;
  pubkey: string;
}

export interface ChatAuthRequest {
  type: typeof CHAT_AUTH_REQUEST;
  requestId: string;
  /** 32-hex-char challenge issued by the chat server. */
  challenge: string;
}

export interface ChatAuthResponse {
  type: typeof CHAT_AUTH_RESPONSE;
  requestId: string;
  event?: {
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    id: string;
    sig: string;
  };
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrow a postMessage payload to a chat-auth request coming from the chat iframe. */
export function isChatAuthRequest(data: unknown): data is ChatAuthRequest {
  return (
    isRecord(data) &&
    data.type === CHAT_AUTH_REQUEST &&
    typeof data.requestId === 'string' &&
    typeof data.challenge === 'string' &&
    /^[0-9a-f]{32}$/.test(data.challenge)
  );
}

/**
 * The unsigned NIP-42-style auth event the chat server expects: kind 22242
 * binding the challenge and the dedicated relay, signed by the offered pubkey.
 */
export function buildChatAuthTemplate(challenge: string): {
  kind: 22242;
  created_at: number;
  tags: string[][];
  content: string;
} {
  return {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['challenge', challenge],
      ['relay', BAO_HOSTED_RELAY],
    ],
    content: '',
  };
}

export function buildChatAuthOffer(pubkey: string): ChatAuthOffer {
  return { type: CHAT_AUTH_OFFER, pubkey };
}

export function buildChatAuthResponse(
  requestId: string,
  event: ChatAuthResponse['event'],
): ChatAuthResponse {
  return { type: CHAT_AUTH_RESPONSE, requestId, event };
}

export function buildChatAuthErrorResponse(requestId: string, error: string): ChatAuthResponse {
  return { type: CHAT_AUTH_RESPONSE, requestId, error };
}

/** Target origin for messages toward the chat iframe. */
export const CHAT_TARGET_ORIGIN = BAO_HOSTED_ORIGIN;
