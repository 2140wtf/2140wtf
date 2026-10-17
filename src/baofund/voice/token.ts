/**
 * Voice broker client — re-exported from the canonical shared core in
 * `@/baofund/community/voiceToken.js` (ADR-voice-invisible-rooms v10.2).
 */
export {
  requestVoiceToken,
  buildVoiceGrantEvent,
  voiceBrokerPath,
  VoiceTokenError,
  type VoiceTokenGrant,
} from '@/baofund/community/voiceToken.js';
