/**
 * Ambient declaration for the optional `ws` package. It ships as a transitive
 * dependency (used by probe/test scripts) but is NOT a direct dependency: the
 * browser bundle always uses the global WebSocket. The dynamic import in
 * useProtocolChat.ts falls back to `globalThis.WebSocket` when `ws` is
 * unavailable (browser), so this declaration only needs the constructor shape.
 */
declare module 'ws' {
  const WebSocket: typeof globalThis.WebSocket;
  export default WebSocket;
}
