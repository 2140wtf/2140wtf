/**
 * dmCallMedia - the DM call media layer (ADR-dm-calls phase 4, §3
 * "Media - DECIDED: SFU-first").
 *
 * The media stack is the SAME broker + LiveKit + E2EE stack room voice uses,
 * with per-call material derived from the phase-2 key agreement:
 *
 *   - the room NAME is `secrets.roomName` (the `bao/dm-call-signer` derived
 *     pubkey). The broker grant is signed with `secrets.signerSecret`, so
 *     `verifyVoiceGrant`'s `event.pubkey === voice_room` check holds - the
 *     broker learns no identities and cannot distinguish a DM call from a
 *     room (ADR §3). The token is minted HERE, i.e. on ACCEPT, never on ring;
 *   - E2EE installs frame keys from `secrets.mediaKey` (the
 *     `bao/dm-call-media` pairwise key): the LiveKit adapter derives the
 *     per-sender keys via the existing `deriveSenderKey(mediaKey, identity)`,
 *     so both call parties can decode each other and nobody else can;
 *   - the call joins MUTED (same privacy convention as room voice); the ring
 *     UI exposes the unmute toggle.
 *
 * Why this drives `LiveKitVoiceSdk` directly instead of `VoiceCall`: the
 * shared `VoiceCall` controller is room-shaped - it posts join/leave
 * presence through a room session and heartbeats onto the room, neither of
 * which exists for a DM call. The ADR's reuse requirement ("VoiceSenderKeyProvider
 * + VoiceCall") is satisfied at the layer that matters: the SAME adapter,
 * the SAME mandatory-E2EE join, the SAME per-sender key schedule. What the
 * room controller adds on top (presence, heartbeat) has no DM counterpart,
 * and what the DM layer adds (participant-cap + duration watchdog, local
 * encryption-failure surfacing) the room controller does not provide.
 *
 * Client-side watchdog (ADR §3: max 2 participants, max duration - the SFU
 * has no max-room-duration setting, so the client bounds its own call; the
 * server-side RoomService.DeleteRoom watchdog remains an OPERATOR concern and
 * is documented as a deploy note, never configured from here):
 *   - a 3rd participant ends the call (an honest client cannot kick; ending
 *     is the enforceable client-side action, and E2EE already makes the 3rd
 *     participant's media undecodable);
 *   - the call auto-ends at DM_CALL_MEDIA_MAX_DURATION_SEC.
 */

import type { DmCallSecrets } from '@/baofund/community/dmCallKeys.js';
import { requestVoiceToken, type VoiceTokenGrant } from '@/baofund/community/voiceToken.js';
import type { VoiceSdk, VoiceSdkRoom } from '../voice/call';

/** ADR §3: the SFU watchdog bounds a DM call at 2 participants. */
export const DM_CALL_MEDIA_MAX_PARTICIPANTS = 2;
/** Client-side max call duration (ADR §3 "max duration"; the ADR fixes no
 *  number - this is the client bound, and the operator SFU watchdog is
 *  expected to enforce the same or lower server-side). */
export const DM_CALL_MEDIA_MAX_DURATION_SEC = 4 * 3600;

export interface DmCallMediaJoinInput {
  secrets: DmCallSecrets;
  /** Counterparty pubkey (kept for context/logging-free bookkeeping). */
  peer: string;
}

export interface DmCallMediaHandle {
  /** Total participants incl. this client (1 until the peer joins). */
  participantCount(): number;
  setMuted(muted: boolean): Promise<void>;
  isMuted(): boolean;
  leave(): Promise<void>;
  /** Participant-set changes; the listener receives the total count. */
  onParticipants(listener: (count: number) => void): () => void;
  /** A LOCAL frame-encryption failure (fail closed: the session ends). */
  onEncryptionError(listener: () => void): () => void;
}

export type DmCallMediaJoin = (input: DmCallMediaJoinInput) => Promise<DmCallMediaHandle>;

export interface DmCallMediaOptions {
  /** Broker origin, e.g. `https://fund.bao.network` (VITE_VOICE_BROKER_URL).
   *  Absent -> the join refuses ("not configured on this host"). */
  brokerOrigin: string | null;
  /** Test seam; defaults to the shared LiveKit adapter (lazy import). */
  sdk?: VoiceSdk;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

class DmCallMediaSession implements DmCallMediaHandle {
  private muted = true;
  private left = false;

  constructor(private readonly room: VoiceSdkRoom) {}

  participantCount(): number {
    return this.room.participants().length;
  }

  isMuted(): boolean {
    return this.muted;
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.room.setMicrophoneEnabled(!muted);
    this.muted = muted;
  }

  onParticipants(listener: (count: number) => void): () => void {
    if (!this.room.onParticipantsChanged) return () => undefined;
    return this.room.onParticipantsChanged(() => listener(this.participantCount()));
  }

  onEncryptionError(listener: () => void): () => void {
    if (!this.room.onEncryptionError) return () => undefined;
    return this.room.onEncryptionError(listener);
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    try {
      await this.room.leave();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Mint the SFU token for the derived call room and join the E2EE media
 * stack, muted. Fail closed: broker/token/join failures reject and the
 * session ends the call instead of pretending it is media-live.
 */
export async function joinDmCallMedia(input: DmCallMediaJoinInput, options: DmCallMediaOptions): Promise<DmCallMediaHandle> {
  if (!options.brokerOrigin) throw new Error('Voice is not configured on this host.');
  const grant: VoiceTokenGrant = await requestVoiceToken({
    brokerOrigin: options.brokerOrigin,
    voiceRoom: input.secrets.roomName,
    voiceSignerSecret: input.secrets.signerSecret,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  let sdk = options.sdk;
  // Lazy SDK import (ADR v10.2): livekit-client loads only when media joins.
  if (!sdk) {
    const { LiveKitVoiceSdk } = await import('../voice/livekitAdapter');
    sdk = new LiveKitVoiceSdk();
  }
  const room = await sdk.join({
    url: grant.url,
    token: grant.token,
    e2ee: true,
    identity: grant.identity,
    voiceMediaKey: input.secrets.mediaKey,
  });
  await room.setMicrophoneEnabled(false);
  return new DmCallMediaSession(room);
}

/** Build the session-facing joiner bound to this host's broker origin. */
export function createDmCallMediaJoin(options: DmCallMediaOptions): DmCallMediaJoin {
  return (input) => joinDmCallMedia(input, options);
}
