import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Native-notification bridge — STUB (phase 1).
 *
 * Armada ships an Android background notification service
 * (`ArmadaNotificationPlugin.java`) that holds a persistent relay REQ and
 * feeds the wire's ingest from native code. That plugin does not exist in
 * this client; this stub preserves the exact call surface the wire's APK
 * bridge uses so the code typechecks and no-ops everywhere. Every entry point
 * is additionally guarded by {@link isNativeRuntime}, so on web none of this
 * ever runs; on a native shell without the plugin the calls reject and the
 * callers' catch-all keeps the web socket funnel working.
 */

/** True only inside the Capacitor native runtime, not web/PWA. */
export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

/** The slice of Armada's plugin interface the wire's APK bridge consumes. */
export interface BaoNotificationPlugin {
  /**
   * Drain raw outer wire events the background service received. Reads a page
   * of service-received rows after the persisted drain cursor; the JS layer
   * routes each through wire ingest, then calls `ackDrain` with the returned
   * cursor so the page isn't replayed.
   */
  drainEvents(): Promise<{ events: string[]; cursor: number }>;
  /** Advance the persisted drain cursor after a drained page was ingested. */
  ackDrain(options: { cursor: number }): Promise<void>;
  /**
   * Tell the background service which room(s) the WebView is currently
   * showing, so it can suppress redundant notifications for that room.
   */
  setActiveRooms(options: { roomKeys: string[] }): Promise<void>;
  /** Live relay-event feed from the background service. */
  addListener(
    eventName: "relayEvent",
    listenerFunc: (data: { event: string }) => void,
  ): Promise<{ remove: () => void }>;
}

function unavailable(): never {
  throw new Error("BaoNotification native plugin is not available in this build");
}

/**
 * Stub bridge: `registerPlugin` returns a web proxy when the native plugin is
 * absent, whose methods reject — but we don't rely on that; every method is
 * explicitly implemented to reject so behavior is identical on all runtimes.
 */
const plugin = (() => {
  try {
    return registerPlugin<BaoNotificationPlugin>("BaoNotification");
  } catch {
    return undefined;
  }
})();

export const BaoNotification: BaoNotificationPlugin = {
  drainEvents: () => (plugin ? plugin.drainEvents().catch(() => ({ events: [], cursor: 0 })) : Promise.resolve({ events: [], cursor: 0 })),
  ackDrain: (options) => (plugin ? plugin.ackDrain(options).catch(() => undefined) : Promise.resolve()),
  setActiveRooms: (_options) => Promise.resolve(),
  addListener: (_eventName, _listenerFunc) =>
    plugin
      ? plugin.addListener("relayEvent", _listenerFunc).catch(unavailable)
      : Promise.reject(new Error("BaoNotification native plugin is not available in this build")),
};
