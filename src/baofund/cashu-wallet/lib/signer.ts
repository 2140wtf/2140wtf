import type { Nip60Signer } from './types';
export function createNip60Signer(opts: any): Nip60Signer {
  return { pubkey: '', getPublicKey: async () => '', signEvent: async () => ({} as any), nip44Encrypt: async () => '', nip44Decrypt: async () => '' };
}
