/**
 * messageSpeech — read a chat message aloud with the browser's built-in
 * speech synthesis (Web Speech API). Local-only: zero download, no network,
 * no audio leaves the device.
 *
 * Phase-2 groundwork ("hear the text in the chat"): any message — notably an
 * agent's text reply — can be spoken with one tap; stop/replay by tapping
 * again. One utterance at a time; a new speak cancels the previous one.
 */

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** How many system voices the browser currently exposes (0 = silent engine). */
export function speechVoiceCount(): number {
  if (!speechSupported()) return 0;
  try {
    return typeof window.speechSynthesis.getVoices === 'function'
      ? window.speechSynthesis.getVoices().length
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Some browsers populate voices asynchronously; asking once at start plus a
 * `voiceschanged` refresh makes the first click behave after a cold start.
 */
export function primeSpeechVoices(): void {
  if (!speechSupported()) return;
  try {
    void window.speechSynthesis.getVoices();
  } catch { /* none */ }
}

/** Collapse a chat message into speakable prose. */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ') // fenced code is not read aloud
    .replace(/`([^`]+)`/g, '$1') // inline code keeps its words
    .replace(/https?:\/\/\S+/g, ' a link ') // URLs read as noise
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

let current: SpeechSynthesisUtterance | null = null;

export function stopSpeech(): void {
  if (!speechSupported()) return;
  if (current === null) return; // nothing playing — never touch the engine
  window.speechSynthesis.cancel();
  current = null;
}

/**
 * Speak `text`; cancels any current utterance first. Returns false when the
 * browser has no speech synthesis (caller should not flip its UI state).
 */
export function speakText(text: string, onEnd?: () => void): boolean {
  if (!speechSupported() || text.trim() === '') return false;
  if (current !== null) window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  try {
    utterance.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  } catch { /* keep engine default */ }
  utterance.onend = () => {
    if (current === utterance) current = null;
    onEnd?.();
  };
  utterance.onerror = () => {
    if (current === utterance) current = null;
    onEnd?.();
  };
  current = utterance;
  window.speechSynthesis.speak(utterance);
  // Chrome can be left paused after a cancel; a stuck pause = silent nothing.
  try {
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  } catch { /* none */ }
  return true;
}
