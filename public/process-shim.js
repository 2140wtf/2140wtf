// Browser compatibility for @ngraveio/bc-ur's bundled Node util.debuglog.
// Keep this immutable and minimal: the application does not otherwise expose
// or emulate Node's process API.
if (!("process" in globalThis)) {
  const env = Object.freeze({ NODE_DEBUG: "" });
  Object.defineProperty(globalThis, "process", {
    value: Object.freeze({ env, pid: 0 }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
}
