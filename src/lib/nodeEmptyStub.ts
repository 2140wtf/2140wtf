/**
 * Empty stand-in for Node-only module specifiers that the browser bundle must
 * not evaluate.
 *
 * Used by `vite.config.ts` as the `fs/promises` alias. `kokoro-js` (the
 * on-device HD voice engine, lazily imported by the chat) statically imports
 * `fs/promises` for its Node voice-file branch:
 *
 *   if (fs && Object.hasOwn(fs, 'readFile')) { ...read local .bin... }
 *
 * In the browser that branch must be false so the engine fetches its voice
 * from the Hugging Face cache/fetch path instead. `vite-plugin-node-polyfills`
 * maps `fs` itself to a *file* mock (`node-stdlib-browser/esm/mock/empty.js`),
 * so the `fs/promises` subpath resolved to `empty.js/promises` and the build
 * failed with UNLOADABLE_DEPENDENCY. This module gives that one specifier a
 * real module: no `readFile`, so the browser path is taken.
 */
const emptyStub = {};
export default emptyStub;
