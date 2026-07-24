import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";

/**
 * Read text from the system clipboard, working on both the web build and the
 * Capacitor (Android) build.
 *
 * `navigator.clipboard.readText()` is unimplemented in Android's system WebView,
 * so on native we go through the `@capacitor/clipboard` plugin instead; on the
 * web we use the standard async Clipboard API. Throws if the clipboard can't be
 * read (e.g. permission denied, or no clipboard at all) so callers can surface
 * a "paste failed, try manually" message.
 */
export async function readClipboardText(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const result = await Clipboard.read();
    return result.value ?? "";
  }
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard read is not available.");
  }
  return await navigator.clipboard.readText();
}

/**
 * Write text to the system clipboard, working on both the web build and the
 * Capacitor (Android) build. Uses the `@capacitor/clipboard` plugin on native
 * (the WebView's `navigator.clipboard.writeText` is unreliable there) and the
 * standard async Clipboard API on the web. Throws if the write fails.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Clipboard.write({ string: text });
    return;
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard write is not available.");
  }
  await navigator.clipboard.writeText(text);
}
