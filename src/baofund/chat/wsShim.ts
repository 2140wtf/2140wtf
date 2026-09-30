/**
 * Browser shim for the node-only `ws` package - vite alias target.
 * Adapts the DOM WebSocket (addEventListener) to the node-ws surface that
 * @/baofund/community/index.js's WsRelayConn uses: .on('open'|'error'|'message'|'close'),
 * .readyState, .send(), .close(), and the static OPEN constant.
 * (Mirrors the community client's ws-shim.js.)
 */
type Handler = (...args: unknown[]) => void;

class BrowserWebSocket {
  static OPEN = 1;

  private _handlers: Record<string, Handler[]> = {};
  private _inner: WebSocket;

  constructor(url: string) {
    this._inner = new globalThis.WebSocket(url);
    this._inner.addEventListener('open', () => this._fire('open'));
    this._inner.addEventListener('error', (e) => this._fire('error', e));
    this._inner.addEventListener('close', () => this._fire('close'));
    this._inner.addEventListener('message', (e) => this._fire('message', e.data));
  }

  on(event: string, cb: Handler): this {
    (this._handlers[event] ??= []).push(cb);
    return this;
  }

  private _fire(event: string, ...args: unknown[]): void {
    for (const cb of this._handlers[event] ?? []) cb(...args);
  }

  get readyState(): number {
    return this._inner.readyState;
  }

  send(data: string): void {
    this._inner.send(data);
  }

  close(): void {
    this._inner.close();
  }
}

export default BrowserWebSocket;
