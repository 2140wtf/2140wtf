// Ambient types for blake3-bao's UMD browser bundle (dist/blake3-bao.min.js).
// The package ships types only for its exports-map entries; the dist
// specifier is not exported, so this ambient declaration (consumed via the
// vite/vitest aliases in blake3BaoBrowser.ts) provides the shapes.
declare module 'blake3-bao/dist/blake3-bao.min.js' {
  interface Blake3BaoLib {
    baoEncode(data: Uint8Array, outboard?: boolean): { encoded: Uint8Array; hash: Uint8Array };
    baoDecode(encoded: Uint8Array, hash: Uint8Array, outboardData?: Uint8Array): Uint8Array;
    baoSlice(encoded: Uint8Array, start: number, length: number, outboardData?: Uint8Array): Uint8Array;
    baoDecodeSlice(slice: Uint8Array, hash: Uint8Array, start: number, length: number): Uint8Array;
    toHex(bytes: Uint8Array): string;
  }
  const blake3Bao: Blake3BaoLib;
  export default blake3Bao;
}
