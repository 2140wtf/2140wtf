/**
 * Voice key derivation — re-exported from the canonical shared core in
 * `@/baofund/community/voiceKeys.js` (ADR-voice-invisible-rooms v10.2).
 * The app-local path is kept so existing imports stay stable; the single
 * implementation lives in the library so every app embedding the chat
 * derives identical voice rooms.
 */
export {
  deriveVoiceChannelId,
  deriveVoiceKeys,
  deriveSenderKey,
  parseVoiceGeneration,
  serializeVoiceGeneration,
  assertRoomId,
  assertVoiceRoot,
  assertVoiceGeneration,
  assertVoiceIdentity,
  VOICE_CHANNEL_ID_LABEL,
  type VoiceKeys,
} from '@/baofund/community/voiceKeys.js';
