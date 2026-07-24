import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";

/**
 * Android hardware/gesture "back" handling.
 *
 * On Android, system gesture navigation reserves both screen edges, so an
 * in-WebView left-edge swipe is intercepted by the OS before our pointer
 * handlers see it (it triggers WebView history back/forward). The robust,
 * platform-native way to drive "go back one level" — e.g. slide the chat away
 * to reveal the channel list — is to listen for the system back event itself
 * (`@capacitor/app`'s `backButton`, which fires for both the gesture and the
 * 3-button back) and run our own handler instead of letting the WebView walk
 * its history.
 *
 * Handlers are a LIFO stack: the most recently mounted view (the screen the
 * user is actually looking at) gets first crack at the back event. A handler
 * returns `true` if it consumed the event (back stops there) or `false` to let
 * the next handler / default behavior run. When no handler consumes it we fall
 * back to history navigation, and at the history root we minimize the app
 * (Android's expected behavior) rather than killing it.
 */

type BackHandler = () => boolean;

const stack: BackHandler[] = [];
let listenerInstalled = false;

function handleBack() {
  // Walk the stack top-down; the first handler that consumes the event wins.
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return;
    } catch {
      // A throwing handler shouldn't trap the user — fall through to the next.
    }
  }
  // Nobody consumed it: behave like a normal back press. If there's app
  // history, walk it; otherwise we're at the root, so minimize the app (the
  // expected Android gesture, vs. exitApp which fully kills the process).
  if (window.history.length > 1) {
    window.history.back();
  } else {
    void App.minimizeApp().catch(() => undefined);
  }
}

export function ensureAndroidBackListener() {
  ensureListener();
}

function ensureListener() {
  if (listenerInstalled || !Capacitor.isNativePlatform()) return;
  listenerInstalled = true;
  // capacitor's backButton fires for the gesture-nav back swipe and the
  // 3-button back. We always handle it ourselves (never let the WebView
  // auto-navigate), which is why MainActivity doesn't override onBackPressed.
  void App.addListener("backButton", () => handleBack());
}

/**
 * Register a handler for the Android system back gesture/button while the
 * calling component is mounted and `active` is true. The handler should return
 * `true` if it handled the back (e.g. it closed a panel or revealed the list)
 * or `false` to defer to handlers registered lower in the stack / the default.
 *
 * No-op outside the native runtime (web/PWA keep the browser's own back).
 */
export function useAndroidBack(handler: BackHandler, active = true): void {
  // Keep the latest handler closure in a ref so we register a single stable
  // entry on the stack (and don't churn it every render).
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return;
    ensureListener();
    const entry: BackHandler = () => ref.current();
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
