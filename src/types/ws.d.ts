/**
 * Minimal `ws` type surface used by 2140's node-environment tests (the local
 * relay publish regression and the WebSocket global polyfill). `ws` ships no
 * types and @types/ws resolves to a default-only shape under the bundler
 * module resolution used here, so declare exactly what these call sites use.
 */
declare module 'ws' {
  import type { EventEmitter } from 'node:events';

  class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;
    constructor(address: string | URL, protocols?: string | string[], options?: unknown);
    close(code?: number, data?: string | Buffer): void;
    send(data: unknown): void;
    readyState: number;
  }

  interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }

  class WebSocketServer extends EventEmitter {
    constructor(options?: { host?: string; port?: number; [key: string]: unknown });
    address(): AddressInfo | string | null;
    close(callback?: () => void): void;
  }

  export { WebSocket, WebSocketServer, AddressInfo };
  export default WebSocket;
}
