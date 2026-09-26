// src/lib/evidence/blake3BaoBrowser.ts
//
// Browser-safe entry for blake3-bao.
//
// The package's ESM entry (index.mjs) bootstraps itself with Node's
// createRequire, which cannot be bundled for the browser (rollup fails on
// 'module'), and the exports map shadows the package.json "browser" field.
// The published UMD dist (dist/blake3-bao.min.js - the vendor's browser
// build, wasm inlined) is self-contained, so this wrapper re-exports the
// functions this app uses as real ESM named exports. Vite aliases both
// 'blake3-bao' and the dist specifier here (vite.config.ts + vitest.config.ts)
// so the app and the test suites all exercise this exact code path. Ambient
// types for the dist specifier live in src/types/blake3-bao-umd.d.ts.
import blake3Bao from 'blake3-bao/dist/blake3-bao.min.js';

export const baoEncode = blake3Bao.baoEncode;
export const baoDecode = blake3Bao.baoDecode;
export const baoSlice = blake3Bao.baoSlice;
export const baoDecodeSlice = blake3Bao.baoDecodeSlice;
export const toHex = blake3Bao.toHex;
