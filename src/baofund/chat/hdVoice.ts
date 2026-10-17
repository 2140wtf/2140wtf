/**
 * hdVoice — on-device neural TTS for the read-aloud feature.
 *
 * Uses Kokoro-82M (Apache-2.0) via kokoro-js: a modern, human-sounding voice
 * with NO server and NO upload — the 82M model is fetched once (~90 MB q8)
 * and cached by the browser; message text never leaves the device. This is
 * the same model family the voice-agent worker will speak with.
 *
 * Everything here is lazily imported: the default read-aloud path (system
 * speech synthesis) stays instant; this module only loads when HD is on.
 *
 * Preference is per browser (localStorage). Fail-safe: any error falls back
 * to the caller's system-voice path.
 */

const HD_PREF_KEY = 'bao-chat-hd-voice';
const HD_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const HD_VOICE = 'af_heart';

interface RawAudioLike {
  toBlob?: () => Blob;
  toWav?: () => ArrayBuffer;
}

interface TtsLike {
  generate: (text: string, opts?: { voice?: string; speed?: number }) => Promise<RawAudioLike>;
}

let enginePromise: Promise<TtsLike> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function hdVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(HD_PREF_KEY) === '1';
  } catch {
    return false; // private mode: keep the system voice
  }
}

export function setHdVoiceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HD_PREF_KEY, enabled ? '1' : '0');
  } catch { /* private mode: preference simply does not persist */ }
}

/**
 * Load (and cache) the on-device engine. Reports download/synthesis status
 * through `onStatus` ('' clears it). Returns false when HD cannot run here
 * (no WebAssembly/WebGPU, offline first use, import failure).
 */
export async function prepareHdVoice(onStatus?: (status: string) => void): Promise<boolean> {
  if (enginePromise) {
    try {
      await enginePromise;
      return true;
    } catch {
      return false;
    }
  }
  onStatus?.('Preparing HD voice — first use downloads the model once (~90 MB)…');
  enginePromise = (async () => {
    const mod = await import('kokoro-js');
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    const tts = (await mod.KokoroTTS.from_pretrained(HD_MODEL, {
      dtype: 'q8',
      device,
    })) as unknown as TtsLike;
    onStatus?.('');
    return tts;
  })();
  try {
    await enginePromise;
    return true;
  } catch {
    enginePromise = null;
    onStatus?.('');
    return false;
  }
}

/** Stop HD playback and release the object URL. */
export function stopHd(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch { /* already stopped */ }
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/**
 * Synthesize `text` on-device and play it. Returns false when HD is
 * unavailable (caller falls back to the system voice).
 */
export async function speakHd(
  text: string,
  opts?: { onEnd?: () => void; onStatus?: (status: string) => void },
): Promise<boolean> {
  stopHd();
  const ready = await prepareHdVoice(opts?.onStatus);
  if (!ready || !enginePromise) return false;
  try {
    const tts = await enginePromise;
    opts?.onStatus?.('Synthesizing…');
    const raw = await tts.generate(text, { voice: HD_VOICE });
    opts?.onStatus?.('');
    const blob =
      typeof raw.toBlob === 'function'
        ? raw.toBlob()
        : new Blob([raw.toWav!()], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentUrl = url;
    currentAudio = audio;
    audio.onended = () => {
      stopHd();
      opts?.onEnd?.();
    };
    audio.onerror = () => {
      stopHd();
      opts?.onEnd?.();
    };
    await audio.play();
    return true;
  } catch {
    opts?.onStatus?.('');
    stopHd();
    return false;
  }
}
