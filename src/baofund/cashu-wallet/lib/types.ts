export interface Nip60Signer {
  pubkey: string;
  getPublicKey(): Promise<string>;
  signEvent(template: any): Promise<any>;
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}
export interface Nip60EventTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}
