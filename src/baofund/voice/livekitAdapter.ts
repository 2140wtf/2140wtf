/**
 * LiveKit adapter — re-exported from the shared library module
 * `@/baofund/community/voiceLivekit.js` (ADR-voice-invisible-rooms v10.2).
 * `livekit-client` remains an app dependency (the library declares it an
 * optional peer so text-only consumers never load it). One adapter, shared
 * by every app that embeds the BAO chat.
 */
export {
  LiveKitVoiceSdk,
  VoiceSenderKeyProvider,
  type LiveKitVoiceSdkOptions,
  type VoiceE2EEWorker,
  type VoiceImportedCryptoKey,
} from '@/baofund/community/voiceLivekit.js';
