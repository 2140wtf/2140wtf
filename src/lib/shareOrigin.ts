/**
 * The origin shareable links are built on (#44).
 *
 * In the browser the page's own origin is correct: the link resolves back to
 * this deployment (including localhost/LAN quickstart installs, whose links
 * are meant to stay on that deployment). In the Capacitor APK, however,
 * `window.location.origin` is the WebView's local server (`https://localhost`)
 * — invite/share links built from it are dead on arrival for everyone they're
 * sent to.
 *
 * Native builds therefore use the public web deployment, which doubles as the
 * app's verified App Links domain (see `client/android/.../AndroidManifest.xml`
 * and `lib/deepLinkUrl.ts`): recipients WITH the app open it directly, and
 * recipients without it land on the hosted web client. Operators can override
 * at build time with `VITE_PUBLIC_WEB_ORIGIN`.
 */

import { Capacitor } from "@capacitor/core";

/** The hosted web client's origin, used as the base for native-built links. */
export const PUBLIC_WEB_ORIGIN: string =
  import.meta.env.VITE_PUBLIC_WEB_ORIGIN || "https://armada.buzz";

/**
 * The origin to build shareable links on: the page's own origin on the web,
 * the public deployment on native (where the runtime origin is the WebView's
 * own local server, which nobody else can reach).
 */
export function shareOrigin(): string {
  if (Capacitor.isNativePlatform()) return PUBLIC_WEB_ORIGIN;
  return typeof window !== "undefined" ? window.location.origin : "";
}
