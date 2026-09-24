import type { Nip60Signer } from './types';
export interface Nip60SyncApi { restoreCrossAppWallet(signer: any, relays: string[]): Promise<any>; restoreWallet(signer: any, relays: string[]): Promise<any>; publishTokenEvent(signer: any, token: any): Promise<any>; publishConfigEvent(signer: any, config: any): Promise<any>; fetchEvents(filter: any): Promise<any[]>; }
export interface Nip60WalletConfig { mintUrl: string; relays: string[]; version: number; }
export async function syncNip60Wallet(signer: Nip60Signer, relays: string[]): Promise<any> { return []; }
export function getNip60State(): any { return {}; }
export function applyNip60Event(event: any): void {}
export async function restoreCrossAppNip60Wallet(signer: any, relays: string[]): Promise<any> { return { events: [], state: {} }; }
export async function restoreNip60Wallet(signer: any, relays: string[]): Promise<any> { return { events: [], state: {} }; }
export function buildTokenEvent(token: any, signer: any): any { return {}; }
export function buildWalletConfigEvent(config: Nip60WalletConfig, signer: any): any { return {}; }
export function normalizeMintUrl(url: string): string { return url; }
